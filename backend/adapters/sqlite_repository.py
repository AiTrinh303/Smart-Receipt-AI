import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from decimal import Decimal
from pathlib import Path

from domain.models import ReceiptData, SavedReceipt, SavedUpload


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

    def save_upload(
        self,
        receipt_id: str,
        original_filename: str | None,
        stored_filename: str,
        content_type: str | None,
    ) -> None:
        with self._connect() as conn:
            conn.execute(
                """
                INSERT INTO uploads (
                    receipt_id, original_filename, stored_filename, content_type, created_at
                )
                VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(receipt_id) DO UPDATE SET
                    original_filename = excluded.original_filename,
                    stored_filename = excluded.stored_filename,
                    content_type = excluded.content_type
                """,
                (receipt_id, original_filename, stored_filename, content_type, _utc_now_iso()),
            )

    def get_upload(self, receipt_id: str) -> SavedUpload | None:
        with self._connect() as conn:
            row = conn.execute(
                """
                SELECT receipt_id, original_filename, stored_filename, content_type, created_at
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
        )

    def save_receipt(self, receipt_id: str, data: ReceiptData) -> None:
        now = _utc_now_iso()
        extracted_json = data.model_dump_json()
        # No edit feature exists yet, so the "AI result" and the displayed
        # data are identical today; ai_result_json is kept as a separate,
        # never-mutated copy so a later edit feature can offer "reset to AI
        # result" without needing a schema change.
        ai_result_json = extracted_json
        total_str = _to_decimal_string(data.total)

        with self._connect() as conn:
            existing = conn.execute(
                "SELECT created_at FROM receipts WHERE receipt_id = ?",
                (receipt_id,),
            ).fetchone()
            created_at = existing[0] if existing is not None else now

            conn.execute(
                """
                INSERT INTO receipts (
                    receipt_id, store_name, purchase_date, currency, total,
                    extracted_json, ai_result_json, created_at, updated_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(receipt_id) DO UPDATE SET
                    store_name = excluded.store_name,
                    purchase_date = excluded.purchase_date,
                    currency = excluded.currency,
                    total = excluded.total,
                    extracted_json = excluded.extracted_json,
                    ai_result_json = excluded.ai_result_json,
                    updated_at = excluded.updated_at
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
                ),
            )

    def get_receipt(self, receipt_id: str) -> SavedReceipt | None:
        with self._connect() as conn:
            row = conn.execute(
                """
                SELECT r.receipt_id, r.extracted_json, r.created_at, r.updated_at,
                       u.original_filename, u.content_type
                FROM receipts r
                LEFT JOIN uploads u ON u.receipt_id = r.receipt_id
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

        return SavedReceipt(
            receipt_id=row[0],
            original_filename=row[4],
            content_type=row[5],
            created_at=row[2],
            updated_at=row[3],
            store_name=extracted.store_name,
            purchase_date=extracted.purchase_date,
            currency=extracted.currency,
            items=extracted.items,
            discounts=extracted.discounts,
            taxes=extracted.taxes,
            total=extracted.total,
        )
