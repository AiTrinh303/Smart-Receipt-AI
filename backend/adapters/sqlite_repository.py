import logging
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from decimal import Decimal
from pathlib import Path

from domain.models import (
    Apartment,
    ApartmentFacet,
    DEFAULT_APARTMENTS,
    Discount,
    LineItem,
    ReceiptData,
    ReceiptFacets,
    ReceiptStatus,
    ReceiptSummary,
    ReceiptUpdate,
    SavedReceipt,
    SavedUpload,
    Tax,
)
from domain.rules import DEFAULT_RECEIPT_SORT, normalize_purchase_date, sort_receipts

logger = logging.getLogger(__name__)


def _display_purchase_date(raw: str | None) -> str | None:
    """purchase_date as shown in a response: normalized to ISO via the shared
    domain rule when it can be, else the raw stored text unchanged (so a date
    the AI read wrong stays visible). Display only -- the stored row is never
    rewritten."""
    normalized = normalize_purchase_date(raw)
    return normalized if normalized is not None else raw


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _to_decimal_string(value: float | None) -> str | None:
    # Decimal(str(value)) avoids binary-float imprecision (e.g. Decimal(19.99)
    # directly would expand to 19.98999999999999999...); money is never stored
    # as a float, and amounts are never scaled to integer minor units because
    # the currency (and therefore its minor-unit convention) may be unknown.
    if value is None:
        return None
    return str(Decimal(str(value)))


class SqliteReceiptRepository:
    def __init__(self, database_path: Path):
        self._database_path = Path(database_path)
        self._database_path.parent.mkdir(parents=True, exist_ok=True)
        self._create_schema()

    @contextmanager
    def _connect(self):
        conn = sqlite3.connect(self._database_path)
        try:
            yield conn
            conn.commit()
        finally:
            conn.close()

    def _create_schema(self) -> None:
        with self._connect() as conn:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS uploads (
                    receipt_id TEXT PRIMARY KEY,
                    original_filename TEXT,
                    stored_filename TEXT,
                    content_type TEXT,
                    created_at TEXT
                )
                """
            )
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS receipts (
                    receipt_id TEXT PRIMARY KEY,
                    store_name TEXT NULL,
                    purchase_date TEXT NULL,
                    currency TEXT NULL,
                    total TEXT NULL,
                    extracted_json TEXT NOT NULL,
                    ai_result_json TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                )
                """
            )
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS apartments (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    sort_order INTEGER NOT NULL,
                    active INTEGER NOT NULL DEFAULT 1
                )
                """
            )
            # Safe, additive migration for databases created before these
            # columns existed: never drops or recreates a table, so existing
            # rows are always kept. No migration framework -- just a
            # column-exists check before ALTER TABLE, run once per
            # repository construction.
            receipts_columns = {row[1] for row in conn.execute("PRAGMA table_info(receipts)")}
            if "edited_at" not in receipts_columns:
                conn.execute("ALTER TABLE receipts ADD COLUMN edited_at TEXT NULL")
            if "apartment_id" not in receipts_columns:
                conn.execute("ALTER TABLE receipts ADD COLUMN apartment_id TEXT NULL")
            if "status" not in receipts_columns:
                # The NOT NULL DEFAULT applies to existing rows too, so every
                # receipt that predates this column still gets 'needs_review'.
                conn.execute(
                    f"ALTER TABLE receipts ADD COLUMN status TEXT NOT NULL DEFAULT '{ReceiptStatus.NEEDS_REVIEW}'"
                )

            uploads_columns = {row[1] for row in conn.execute("PRAGMA table_info(uploads)")}
            if "apartment_id" not in uploads_columns:
                conn.execute("ALTER TABLE uploads ADD COLUMN apartment_id TEXT NULL")
            if "content_sha256" not in uploads_columns:
                conn.execute("ALTER TABLE uploads ADD COLUMN content_sha256 TEXT NULL")
            # Non-unique: allow_duplicate lets more than one upload share a
            # hash on purpose, so this only speeds up the lookup, never
            # constrains it.
            conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_uploads_content_sha256 ON uploads(content_sha256)"
            )

            # Idempotent: INSERT OR IGNORE never touches a row that already
            # exists (e.g. one a user later deactivated), so this is safe to
            # run on every construction, not just the first.
            for apartment in DEFAULT_APARTMENTS:
                conn.execute(
                    "INSERT OR IGNORE INTO apartments (id, name, sort_order, active) VALUES (?, ?, ?, ?)",
                    (apartment.id, apartment.name, apartment.sort_order, int(apartment.active)),
                )

    def save_upload(
        self,
        receipt_id: str,
        original_filename: str | None,
        stored_filename: str,
        content_type: str | None,
        apartment_id: str | None = None,
        content_sha256: str | None = None,
    ) -> None:
        with self._connect() as conn:
            conn.execute(
                """
                INSERT INTO uploads (
                    receipt_id, original_filename, stored_filename, content_type, created_at,
                    apartment_id, content_sha256
                )
                VALUES (?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(receipt_id) DO UPDATE SET
                    original_filename = excluded.original_filename,
                    stored_filename = excluded.stored_filename,
                    content_type = excluded.content_type,
                    apartment_id = excluded.apartment_id,
                    content_sha256 = excluded.content_sha256
                """,
                (
                    receipt_id,
                    original_filename,
                    stored_filename,
                    content_type,
                    _utc_now_iso(),
                    apartment_id,
                    content_sha256,
                ),
            )

    def get_upload(self, receipt_id: str) -> SavedUpload | None:
        with self._connect() as conn:
            row = conn.execute(
                """
                SELECT receipt_id, original_filename, stored_filename, content_type, created_at,
                       apartment_id
                FROM uploads
                WHERE receipt_id = ?
                """,
                (receipt_id,),
            ).fetchone()

        if row is None:
            return None

        return SavedUpload(
            receipt_id=row[0],
            original_filename=row[1],
            stored_filename=row[2],
            content_type=row[3],
            created_at=row[4],
            apartment_id=row[5],
        )

    def set_upload_hash(self, receipt_id: str, content_sha256: str) -> None:
        """Used only by scripts/backfill_hashes.py, to fill in the hash for
        an uploads row that predates duplicate detection -- never touches
        any other column."""
        with self._connect() as conn:
            conn.execute(
                "UPDATE uploads SET content_sha256 = ? WHERE receipt_id = ?",
                (content_sha256, receipt_id),
            )

    def list_uploads_without_hash(self) -> list[SavedUpload]:
        """Every uploads row with no content_sha256 yet -- the backfill
        script's own worklist. Independent of whether a receipts row
        exists (the hash lives on uploads, regardless of extraction)."""
        with self._connect() as conn:
            rows = conn.execute(
                """
                SELECT receipt_id, original_filename, stored_filename, content_type, created_at,
                       apartment_id
                FROM uploads
                WHERE content_sha256 IS NULL
                ORDER BY created_at ASC, receipt_id ASC
                """
            ).fetchall()

        return [
            SavedUpload(
                receipt_id=row[0],
                original_filename=row[1],
                stored_filename=row[2],
                content_type=row[3],
                created_at=row[4],
                apartment_id=row[5],
            )
            for row in rows
        ]

    def count_uploads(self) -> int:
        with self._connect() as conn:
            return conn.execute("SELECT COUNT(*) FROM uploads").fetchone()[0]

    def _receipt_summary_from_hash_join_row(
        self,
        receipt_id: str,
        extracted_json: str,
        created_at: str,
        original_filename: str | None,
        apartment_id_value: str | None,
        apartment_name: str | None,
        status_value: str,
    ) -> ReceiptSummary | None:
        """Shared by find_saved_by_hashes/list_saved_hash_duplicate_groups:
        builds one ReceiptSummary from a receipts/uploads/apartments join
        row, normalizing purchase_date for display the same way
        get_receipt() does (never rewriting the stored row). Returns None
        (never raises) for a row whose extracted_json is unparseable --
        same "skip, log receipt_id only, keep going" rule as everywhere
        else in this file."""
        try:
            extracted = ReceiptData.model_validate_json(extracted_json)
        except Exception:
            logger.error("Skipping receipt with unparseable extracted_json: receipt_id=%s", receipt_id)
            return None

        display_date = _display_purchase_date(extracted.purchase_date)

        return ReceiptSummary(
            receipt_id=receipt_id,
            original_filename=original_filename,
            store_name=extracted.store_name,
            purchase_date=display_date,
            currency=extracted.currency,
            total=extracted.total,
            created_at=created_at,
            apartment_id=apartment_id_value,
            apartment_name=apartment_name,
            status=status_value,
        )

    def find_saved_by_hashes(self, hashes: list[str]) -> dict[str, ReceiptSummary]:
        """For each given hash, the SAVED receipt (a receipts row exists)
        whose upload carries that content_sha256 -- the OLDEST one (by
        receipts.created_at) when more than one upload shares the hash
        (e.g. via allow_duplicate). A hash with no saved receipt is simply
        absent from the result -- never a KeyError for the caller to
        guard against."""
        if not hashes:
            return {}

        chunk_size = 200  # keeps well under SQLite's default parameter limit
        results: dict[str, ReceiptSummary] = {}

        with self._connect() as conn:
            for start in range(0, len(hashes), chunk_size):
                chunk = hashes[start : start + chunk_size]
                placeholders = ",".join("?" for _ in chunk)
                rows = conn.execute(
                    f"""
                    SELECT u.content_sha256, r.receipt_id, r.extracted_json, r.created_at,
                           u.original_filename, r.apartment_id, ap.name, r.status
                    FROM uploads u
                    JOIN receipts r ON r.receipt_id = u.receipt_id
                    LEFT JOIN apartments ap ON ap.id = r.apartment_id
                    WHERE u.content_sha256 IN ({placeholders})
                    ORDER BY r.created_at ASC, r.receipt_id ASC
                    """,
                    chunk,
                ).fetchall()

                for (
                    content_sha256,
                    receipt_id,
                    extracted_json,
                    created_at,
                    original_filename,
                    apartment_id_value,
                    apartment_name,
                    status_value,
                ) in rows:
                    if content_sha256 in results:
                        continue  # already have the oldest, from the ASC order above

                    summary = self._receipt_summary_from_hash_join_row(
                        receipt_id,
                        extracted_json,
                        created_at,
                        original_filename,
                        apartment_id_value,
                        apartment_name,
                        status_value,
                    )
                    if summary is not None:
                        results[content_sha256] = summary

        return results

    def list_saved_hash_duplicate_groups(self) -> list[list[ReceiptSummary]]:
        """Groups of 2+ SAVED receipts (a receipts row exists) whose upload
        shares one content_sha256 -- used only by the backfill script's
        --report, never by any API route or the report's own duplicate
        groups (which match on apartment/date/store/total, a separate,
        unrelated notion of "duplicate"). Each group is ordered oldest
        first (receipts.created_at ASC); groups themselves are ordered by
        their own oldest member's created_at."""
        with self._connect() as conn:
            rows = conn.execute(
                """
                SELECT u.content_sha256, r.receipt_id, r.extracted_json, r.created_at,
                       u.original_filename, r.apartment_id, ap.name, r.status
                FROM uploads u
                JOIN receipts r ON r.receipt_id = u.receipt_id
                LEFT JOIN apartments ap ON ap.id = r.apartment_id
                WHERE u.content_sha256 IS NOT NULL
                ORDER BY u.content_sha256 ASC, r.created_at ASC, r.receipt_id ASC
                """
            ).fetchall()

        grouped: dict[str, list[ReceiptSummary]] = {}
        order: list[str] = []
        for (
            content_sha256,
            receipt_id,
            extracted_json,
            created_at,
            original_filename,
            apartment_id_value,
            apartment_name,
            status_value,
        ) in rows:
            summary = self._receipt_summary_from_hash_join_row(
                receipt_id,
                extracted_json,
                created_at,
                original_filename,
                apartment_id_value,
                apartment_name,
                status_value,
            )
            if summary is None:
                continue
            if content_sha256 not in grouped:
                grouped[content_sha256] = []
                order.append(content_sha256)
            grouped[content_sha256].append(summary)

        return [grouped[h] for h in order if len(grouped[h]) >= 2]

    def save_receipt(
        self, receipt_id: str, data: ReceiptData, apartment_id: str | None = None
    ) -> None:
        # ai_result_json is captured from the data exactly as the AI returned
        # it -- including a raw, unparseable date -- before any normalization,
        # so it stays byte-for-byte the original AI output and a later "reset
        # to AI result" stays possible.
        ai_result_json = data.model_dump_json()

        # Then normalize in place: a stray time suffix like "2025-06-26 11"
        # becomes "2025-06-26" in both the stored row and the caller's `data`
        # (so a route building its response from the same `data` object after
        # this call sees the normalized value too). If it can't be parsed,
        # the raw text is kept as-is so the user can see and correct it --
        # check_receipt's DATE_NOT_STANDARD warning flags it either way.
        normalized_date = normalize_purchase_date(data.purchase_date)
        if normalized_date is not None:
            data.purchase_date = normalized_date

        now = _utc_now_iso()
        extracted_json = data.model_dump_json()
        total_str = _to_decimal_string(data.total)

        with self._connect() as conn:
            existing = conn.execute(
                "SELECT created_at FROM receipts WHERE receipt_id = ?",
                (receipt_id,),
            ).fetchone()
            created_at = existing[0] if existing is not None else now

            # apartment_id is deliberately absent from the ON CONFLICT SET
            # clause: a first save (INSERT) stores the upload's apartment,
            # but a re-extract (the ON CONFLICT branch) leaves whatever is
            # already there untouched -- never overwritten, never nulled.
            # status, however, IS reset to 'needs_review' on every save
            # (first save relies on the column default; a re-extract
            # explicitly resets it) since the underlying data was just
            # replaced.
            conn.execute(
                f"""
                INSERT INTO receipts (
                    receipt_id, store_name, purchase_date, currency, total,
                    extracted_json, ai_result_json, created_at, updated_at, edited_at,
                    apartment_id, status
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, '{ReceiptStatus.NEEDS_REVIEW}')
                ON CONFLICT(receipt_id) DO UPDATE SET
                    store_name = excluded.store_name,
                    purchase_date = excluded.purchase_date,
                    currency = excluded.currency,
                    total = excluded.total,
                    extracted_json = excluded.extracted_json,
                    ai_result_json = excluded.ai_result_json,
                    updated_at = excluded.updated_at,
                    edited_at = NULL,
                    status = '{ReceiptStatus.NEEDS_REVIEW}'
                """,
                (
                    receipt_id,
                    data.store_name,
                    data.purchase_date,
                    data.currency,
                    total_str,
                    extracted_json,
                    ai_result_json,
                    created_at,
                    now,
                    apartment_id,
                ),
            )

    def get_receipt(self, receipt_id: str) -> SavedReceipt | None:
        with self._connect() as conn:
            row = conn.execute(
                """
                SELECT r.receipt_id, r.extracted_json, r.created_at, r.updated_at,
                       u.original_filename, u.content_type, r.edited_at,
                       r.apartment_id, ap.name, r.status
                FROM receipts r
                LEFT JOIN uploads u ON u.receipt_id = r.receipt_id
                LEFT JOIN apartments ap ON ap.id = r.apartment_id
                WHERE r.receipt_id = ?
                """,
                (receipt_id,),
            ).fetchone()

        if row is None:
            return None

        # extracted_json (not the decimal-string `total` column) is the
        # source of truth for display, so `total` here is read back as the
        # same float ReceiptData originally carried -- the decimal-string
        # column is purely an internal storage detail for future search and
        # summary tickets, and is never surfaced through this API.
        extracted = ReceiptData.model_validate_json(row[1])

        # A row saved before date normalization existed may still have a raw
        # value like "2025-06-26 11"; normalize it for display here (never
        # written back -- no migration of the stored data) so older receipts
        # show the clean date too.
        display_date = _display_purchase_date(extracted.purchase_date)

        edited_at = row[6]

        return SavedReceipt(
            receipt_id=row[0],
            original_filename=row[4],
            content_type=row[5],
            created_at=row[2],
            updated_at=row[3],
            store_name=extracted.store_name,
            purchase_date=display_date,
            currency=extracted.currency,
            items=extracted.items,
            discounts=extracted.discounts,
            taxes=extracted.taxes,
            total=extracted.total,
            edited=edited_at is not None,
            edited_at=edited_at,
            apartment_id=row[7],
            apartment_name=row[8],
            status=row[9],
        )

    def _filtered_receipt_rows(
        self,
        conn,
        apartment_id: str | None = None,
        year: int | None = None,
        undated: bool = False,
        status: str | None = None,
    ) -> list[tuple]:
        """Shared by list_receipts() and list_matching_receipts(): every
        receipt matching the given filters, each as a tuple of
        (receipt_id, parsed ReceiptData, created_at, updated_at,
        original_filename, content_type, edited_at, apartment_id,
        apartment_name, status), ordered
        `created_at DESC, receipt_id ASC`, with NO limit applied -- callers
        slice as needed. apartment_id/status are plain column
        equality, so they are filtered in SQL (parameterized); year/undated
        need normalize_purchase_date -- the same shared domain rule used
        everywhere else, never duplicated as a SQL date regex -- so those
        are filtered in Python on every row returned by the query."""
        where_clauses: list[str] = []
        params: list[str] = []
        if apartment_id is not None:
            where_clauses.append("r.apartment_id = ?")
            params.append(apartment_id)
        if status is not None:
            where_clauses.append("r.status = ?")
            params.append(status)

        where_sql = f"WHERE {' AND '.join(where_clauses)}" if where_clauses else ""

        rows = conn.execute(
            f"""
            SELECT r.receipt_id, r.extracted_json, r.created_at, r.updated_at,
                   u.original_filename, u.content_type, r.edited_at,
                   r.apartment_id, ap.name, r.status
            FROM receipts r
            LEFT JOIN uploads u ON u.receipt_id = r.receipt_id
            LEFT JOIN apartments ap ON ap.id = r.apartment_id
            {where_sql}
            ORDER BY r.created_at DESC, r.receipt_id ASC
            """,
            params,
        ).fetchall()

        results: list[tuple] = []
        for (
            receipt_id,
            extracted_json,
            created_at,
            updated_at,
            original_filename,
            content_type,
            edited_at,
            apartment_id_value,
            apartment_name,
            status_value,
        ) in rows:
            try:
                # Same source (extracted_json) as get_receipt(), so `total`
                # carries the same JSON type here as in the extract/GET
                # responses -- never the decimal-string column or a
                # recomputed float.
                extracted = ReceiptData.model_validate_json(extracted_json)
            except Exception:
                # One corrupted row must never break the whole list; skip it
                # and keep going, logging only the receipt_id.
                logger.error("Skipping receipt with unparseable extracted_json: receipt_id=%s", receipt_id)
                continue

            if year is not None or undated:
                normalized_date = normalize_purchase_date(extracted.purchase_date)
                is_undated = normalized_date is None
                if undated and not is_undated:
                    continue
                if year is not None and (is_undated or int(normalized_date[:4]) != year):
                    continue

            results.append(
                (
                    receipt_id,
                    extracted,
                    created_at,
                    updated_at,
                    original_filename,
                    content_type,
                    edited_at,
                    apartment_id_value,
                    apartment_name,
                    status_value,
                )
            )

        return results

    def list_receipts(
        self,
        limit: int,
        offset: int = 0,
        apartment_id: str | None = None,
        year: int | None = None,
        undated: bool = False,
        status: str | None = None,
        sort: str = DEFAULT_RECEIPT_SORT,
    ) -> tuple[list[ReceiptSummary], int]:
        """Returns (summaries, total): `total` is the count of every
        receipt matching the given filters -- ignoring `limit`/`offset`
        entirely. The rows arrive in the stable tie-break order
        (`created_at` DESC, `receipt_id` ASC) `_filtered_receipt_rows`
        applies, are then sorted by `sort` (`domain.rules.sort_receipts`,
        a stable sort, so ties keep that order), and only *then* sliced by
        `limit`/`offset` -- so "Show more" pages continue the same order. A row skipped there for unparseable
        `extracted_json` was never part of `rows` to begin with, so it is
        excluded from `total` the same way it has always been excluded
        from `count` -- consistent, not a new special case."""
        with self._connect() as conn:
            rows = self._filtered_receipt_rows(conn, apartment_id, year, undated, status)

        # Each row is (receipt_id, extracted, created_at, ...): the raw date
        # and total come from the parsed extracted_json (`extracted`).
        rows = sort_receipts(
            rows,
            sort,
            purchase_date=lambda row: row[1].purchase_date,
            total=lambda row: row[1].total,
        )

        total = len(rows)
        page = rows[offset : offset + limit]

        summaries: list[ReceiptSummary] = [
            ReceiptSummary(
                receipt_id=receipt_id,
                original_filename=original_filename,
                store_name=extracted.store_name,
                # Normalized for display, same as get_receipt() and the
                # duplicate-check summaries -- never written back.
                purchase_date=_display_purchase_date(extracted.purchase_date),
                currency=extracted.currency,
                total=extracted.total,
                created_at=created_at,
                apartment_id=apartment_id_value,
                apartment_name=apartment_name,
                status=status_value,
            )
            for (
                receipt_id,
                extracted,
                created_at,
                _updated_at,
                original_filename,
                _content_type,
                _edited_at,
                apartment_id_value,
                apartment_name,
                status_value,
            ) in page
        ]

        return summaries, total

    def list_matching_receipts(
        self,
        apartment_id: str | None = None,
        year: int | None = None,
        undated: bool = False,
        status: str | None = None,
    ) -> list[SavedReceipt]:
        """Every receipt matching the same filters list_receipts() accepts,
        with its full parsed data (items included) -- used by GET /items to
        flatten line items, reusing _filtered_receipt_rows() rather than
        duplicating its filter logic. Unlike list_receipts()'s summaries,
        purchase_date here is the raw, unnormalized value from
        extracted_json; domain.rules.flatten_line_items normalizes it for
        display, the same way get_receipt() does."""
        with self._connect() as conn:
            rows = self._filtered_receipt_rows(conn, apartment_id, year, undated, status)

        receipts: list[SavedReceipt] = []
        for (
            receipt_id,
            extracted,
            created_at,
            updated_at,
            original_filename,
            content_type,
            edited_at,
            apartment_id_value,
            apartment_name,
            status_value,
        ) in rows:
            receipts.append(
                SavedReceipt(
                    receipt_id=receipt_id,
                    original_filename=original_filename,
                    content_type=content_type,
                    created_at=created_at,
                    updated_at=updated_at,
                    store_name=extracted.store_name,
                    purchase_date=extracted.purchase_date,
                    currency=extracted.currency,
                    items=extracted.items,
                    discounts=extracted.discounts,
                    taxes=extracted.taxes,
                    total=extracted.total,
                    edited=edited_at is not None,
                    edited_at=edited_at,
                    apartment_id=apartment_id_value,
                    apartment_name=apartment_name,
                    status=status_value,
                )
            )

        return receipts

    def get_receipt_facets(self, apartment_id: str | None = None) -> ReceiptFacets:
        with self._connect() as conn:
            apartment_rows = conn.execute(
                """
                SELECT ap.id, ap.name, COUNT(r.receipt_id)
                FROM apartments ap
                LEFT JOIN receipts r ON r.apartment_id = ap.id
                GROUP BY ap.id
                ORDER BY ap.sort_order
                """
            ).fetchall()
            total = conn.execute("SELECT COUNT(*) FROM receipts").fetchone()[0]

            if apartment_id is not None:
                date_rows = conn.execute(
                    "SELECT extracted_json FROM receipts WHERE apartment_id = ?",
                    (apartment_id,),
                ).fetchall()
            else:
                date_rows = conn.execute("SELECT extracted_json FROM receipts").fetchall()

        years: set[int] = set()
        has_undated = False
        for (extracted_json,) in date_rows:
            try:
                extracted = ReceiptData.model_validate_json(extracted_json)
            except Exception:
                continue
            normalized_date = normalize_purchase_date(extracted.purchase_date)
            if normalized_date is None:
                has_undated = True
            else:
                years.add(int(normalized_date[:4]))

        return ReceiptFacets(
            apartments=[ApartmentFacet(id=row[0], name=row[1], count=row[2]) for row in apartment_rows],
            total=total,
            years=sorted(years, reverse=True),
            has_undated=has_undated,
        )

    def update_receipt(self, receipt_id: str, update: ReceiptUpdate) -> SavedReceipt | None:
        corrected = ReceiptData(
            store_name=update.store_name,
            purchase_date=update.purchase_date,
            currency=update.currency,
            items=[LineItem(**item.model_dump()) for item in update.items],
            discounts=[Discount(**d.model_dump()) for d in update.discounts],
            taxes=[Tax(**t.model_dump()) for t in update.taxes],
            total=update.total,
        )
        extracted_json = corrected.model_dump_json()
        total_str = _to_decimal_string(update.total)
        now = _utc_now_iso()

        with self._connect() as conn:
            existing = conn.execute(
                "SELECT 1 FROM receipts WHERE receipt_id = ?", (receipt_id,)
            ).fetchone()
            if existing is None:
                return None

            # A single UPDATE in this one transaction: created_at and
            # ai_result_json (the original, byte-for-byte AI output) are
            # never touched, so a later "reset to AI result" stays possible.
            # edited_at is set to now -- the user's edits replace the AI
            # output until a re-extract or reset clears it again.
            conn.execute(
                """
                UPDATE receipts
                SET store_name = ?, purchase_date = ?, currency = ?, total = ?,
                    extracted_json = ?, updated_at = ?, edited_at = ?
                WHERE receipt_id = ?
                """,
                (
                    update.store_name,
                    update.purchase_date,
                    update.currency,
                    total_str,
                    extracted_json,
                    now,
                    now,
                    receipt_id,
                ),
            )

        return self.get_receipt(receipt_id)

    def reset_receipt(self, receipt_id: str) -> SavedReceipt | None:
        with self._connect() as conn:
            row = conn.execute(
                "SELECT ai_result_json FROM receipts WHERE receipt_id = ?", (receipt_id,)
            ).fetchone()
            if row is None:
                return None

            # Parse with the same lenient model used for AI output, then
            # apply the same date normalization extraction does -- a reset
            # receipt should look exactly like a freshly extracted one.
            ai_result = ReceiptData.model_validate_json(row[0])
            normalized_date = normalize_purchase_date(ai_result.purchase_date)
            if normalized_date is not None:
                ai_result.purchase_date = normalized_date

            extracted_json = ai_result.model_dump_json()
            total_str = _to_decimal_string(ai_result.total)
            now = _utc_now_iso()

            # One transaction: extracted_json and the four denormalized
            # columns are refreshed from ai_result_json (itself untouched),
            # edited_at is cleared, updated_at refreshed, created_at kept.
            conn.execute(
                """
                UPDATE receipts
                SET store_name = ?, purchase_date = ?, currency = ?, total = ?,
                    extracted_json = ?, updated_at = ?, edited_at = NULL
                WHERE receipt_id = ?
                """,
                (
                    ai_result.store_name,
                    ai_result.purchase_date,
                    ai_result.currency,
                    total_str,
                    extracted_json,
                    now,
                    receipt_id,
                ),
            )

        return self.get_receipt(receipt_id)

    def list_apartments(self) -> list[Apartment]:
        with self._connect() as conn:
            rows = conn.execute(
                "SELECT id, name, sort_order, active FROM apartments WHERE active = 1 ORDER BY sort_order"
            ).fetchall()
        return [Apartment(id=row[0], name=row[1], sort_order=row[2], active=bool(row[3])) for row in rows]

    def get_apartment(self, apartment_id: str) -> Apartment | None:
        # Regardless of active -- the route distinguishes "unknown" from
        # "inactive" itself, and a receipt's own apartment_name must still
        # resolve even if that apartment is deactivated later.
        with self._connect() as conn:
            row = conn.execute(
                "SELECT id, name, sort_order, active FROM apartments WHERE id = ?", (apartment_id,)
            ).fetchone()
        if row is None:
            return None
        return Apartment(id=row[0], name=row[1], sort_order=row[2], active=bool(row[3]))

    def set_receipt_apartment(self, receipt_id: str, apartment_id: str) -> SavedReceipt | None:
        now = _utc_now_iso()
        with self._connect() as conn:
            existing = conn.execute(
                "SELECT 1 FROM receipts WHERE receipt_id = ?", (receipt_id,)
            ).fetchone()
            if existing is None:
                return None

            # One transaction: only apartment_id and updated_at change here --
            # this is a classification change, never an edit, so edited_at,
            # extracted_json, ai_result_json and created_at are all left
            # untouched. The uploads row (when one exists) is kept in sync too.
            conn.execute(
                "UPDATE receipts SET apartment_id = ?, updated_at = ? WHERE receipt_id = ?",
                (apartment_id, now, receipt_id),
            )
            conn.execute(
                "UPDATE uploads SET apartment_id = ? WHERE receipt_id = ?",
                (apartment_id, receipt_id),
            )

        return self.get_receipt(receipt_id)

    def set_receipt_status(self, receipt_id: str, status: str) -> SavedReceipt | None:
        now = _utc_now_iso()
        with self._connect() as conn:
            existing = conn.execute(
                "SELECT 1 FROM receipts WHERE receipt_id = ?", (receipt_id,)
            ).fetchone()
            if existing is None:
                return None

            # Classification change: only status and updated_at change here
            # -- edited_at, extracted_json, ai_result_json, created_at and
            # apartment_id are all left untouched.
            conn.execute(
                "UPDATE receipts SET status = ?, updated_at = ? WHERE receipt_id = ?",
                (status, now, receipt_id),
            )

        return self.get_receipt(receipt_id)

    def delete_receipt(self, receipt_id: str) -> bool:
        with self._connect() as conn:
            existing = conn.execute(
                "SELECT 1 FROM receipts WHERE receipt_id = ?", (receipt_id,)
            ).fetchone()
            existed = existing is not None

            # Both tables cleared in this one transaction, regardless of
            # whether a receipts row existed (an uploads-only row for this
            # id, if any, is cleaned up too).
            conn.execute("DELETE FROM receipts WHERE receipt_id = ?", (receipt_id,))
            conn.execute("DELETE FROM uploads WHERE receipt_id = ?", (receipt_id,))

        return existed
