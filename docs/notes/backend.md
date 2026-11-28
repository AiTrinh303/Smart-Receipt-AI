# Backend notes

Per-feature detail for `backend/`, moved verbatim from CLAUDE.md's former "Project structure" section. CLAUDE.md is the short index; this file is the detail.

- `backend/` — FastAPI app with a Python venv and
  `requirements.txt`/`requirements-dev.txt`, layered per
  [docs/adr/0001-layered-backend.md](docs/adr/0001-layered-backend.md):
  - `domain/` — `models.py` (`ReceiptData` and friends, plus `SavedUpload`,
    `SavedReceipt` — adds `edited: bool` / `edited_at: str | None` to
    `ReceiptData` (`edited` is just `edited_at is not None`, computed in the
    repository, not stored as its own column) — and `ReceiptSummary` — the
    last a small list-row model: receipt_id, original_filename, store_name,
    purchase_date, currency, total, created_at, plus apartment_id/
    apartment_name/status (below) — for persisted data (no
    `edited`/`warnings` here);
    `ReceiptWarning` — code/field/
    message/`details` (decimal strings, never floats), computed fresh on
    every response and never stored); `Apartment` (id/name/sort_order/
    active) and `DEFAULT_APARTMENTS` — the two seeded holiday apartments
    (exact ids `oberaudorf-bergblick`/`sankt-englmar-waldglueck`, exact
    names including "Waldglück"), seeded via `INSERT OR IGNORE` on every
    repository construction so it's idempotent and safe to re-run.
    `SavedUpload`, `SavedReceipt` and `ReceiptSummary` all carry flat
    `apartment_id`/`apartment_name` (`str | None`) — same key set and JSON
    types across upload/extract/GET/PUT/reset/list-item, see
    [docs/adr/0002-apartments-and-expense-ledger.md](docs/adr/0002-apartments-and-expense-ledger.md).
    `ReceiptStatus`
    — plain string constants `NEEDS_REVIEW`/`APPROVED` (not an Enum, so
    they serialize as plain strings) and `ALLOWED_RECEIPT_STATUSES`.
    `SavedReceipt` and `ReceiptSummary` additionally carry flat
    `status` (`str`,
    `"needs_review"` or `"approved"`) — same key and JSON type across
    extract/GET/PUT/reset/apartment-PUT/list-item, see
    [docs/adr/0003-category-and-review-status.md](docs/adr/0003-category-and-review-status.md)
    (an expense-category classification also lived here —
    `Category`/`DEFAULT_CATEGORIES`, `category_id`/`category_name` on
    `SavedReceipt`/`ReceiptSummary`/`LineItemRow` — until it was removed;
    see
    [docs/adr/0004-remove-categories.md](docs/adr/0004-remove-categories.md)
    for why, and how any old category data left in a database is kept
    dormant, never migrated).
    `LineItemRow` — one flattened `GET /items` row (`receipt_id`,
    `line_index`, `name`, `quantity`, `unit_price`, `line_total`,
    `currency`, `purchase_date`, `store_name`, `apartment_id`,
    `apartment_name`, `status`); never stored, built
    fresh per request by `rules.flatten_line_items()`.
    `rules.py` (allowed file
    types, size limit, `media_type_for_extension()` — a pure
    extension -> fixed media type map used by the file-serving endpoint, so
    `Content-Type` is never taken from client input — plus two more pure
    functions: `normalize_purchase_date(raw)` extracts a leading ISO date
    (`"2025-06-26 11"`/`"2025-06-26T11:04:00"` -> `"2025-06-26"`, via
    `_LEADING_ISO_DATE_PATTERN`) **or** a leading dotted German date,
    `D.M.YYYY`/`DD.MM.YYYY` (`"2.6.2026"`/`"02.06.2026"`/
    `"02.06.2026 11:04"` -> `"2026-06-02"`, via
    `_LEADING_DOTTED_DATE_PATTERN` — 1-2 digit day/month, exactly 4-digit
    year, dots only, optionally one trailing space/comma + arbitrary
    extra text) **or** a leading month-name date, `D[.]? Month YYYY`
    (`"02 Juni 2026"`/`"2. Dezember 2025"`/`"15 Mär 2026"`/
    `"1 March 2026"` -> `"2026-06-02"`/`"2025-12-02"`/`"2026-03-15"`/
    `"2026-03-01"`, via `_LEADING_MONTH_NAME_DATE_PATTERN` — 1-2 digit
    day, optional dot right after the day, one or more spaces, a German or
    English month name (full or abbreviated, case-insensitive via
    `.casefold()`, optional trailing dot on an abbreviation), exactly
    4-digit year, optionally one trailing space/comma + arbitrary extra
    text, same convention as the other two shapes). The month word is
    resolved against `MONTH_NAMES_BY_WORD`, a module-level constant
    mapping every accepted German and English spelling (full and
    abbreviated) to its month number — an unrecognized word simply fails
    that lookup, returning `None` — **or** a dotted date with a 2-digit
    year, `D.M.YY`/`DD.MM.YY`, read as `20YY` (`"27.06.26"`/`"27.06.26
    09:52"`/`"06.06.26 12:32:39"` -> `"2026-06-27"`/`"2026-06-27"`/
    `"2026-06-06"`, via `_SHORT_YEAR_DOTTED_DATE_PATTERN`): stricter than
    the other shapes on purpose — only the date alone or the date plus one
    well-formed `HH:MM`/`HH:MM:SS` time (hours 0-23, minutes/seconds 0-59)
    is accepted, nothing else after it (`"27.06.26 abc"` and `"27.06.26
    09:52 x"` stay unrecognized), since a short year is easier to confuse
    with other numbers. A time after any accepted shape is dropped (the
    4-digit dotted, ISO and month-name shapes already allowed trailing
    text, so `"06.06.2026 12:32:39"` worked before). It
    returns `None` for anything else (never guesses day/month order for
    `"26/06/2025"`, and deliberately never recognizes slash dates, or a
    2-digit year in a month-name date like `"02 Juni 26"` — still out of
    scope). Every
    shape is validated against a real calendar by constructing a
    `date(year, month, day)` and catching the `ValueError` it raises for
    an out-of-range day/month (e.g. `"31.04.2026"`, a non-leap-year
    `"29.02.2025"`, or `"31 Februar 2026"`) — never a hand-rolled day-count
    table, and never
    raises itself. Since every call site that normalizes a date for
    display/filtering/sorting (`get_receipt`, the year filter,
    `has_undated`, `flatten_line_items`, `sort_line_items`, and — indirectly, since it's
    always handed an already-normalized value — `check_receipt`'s
    `DATE_NOT_STANDARD` check, and the status-PUT approval gate's
    `_missing_approval_fields`) funnels through this one function, teaching
    it the dotted format, and later the month-name format, was each time
    the *only* code change needed to make a
    legacy row whose stored text is that format behave as fully dated
    everywhere, with its stored row never rewritten; `check_receipt(data, today)` — `today`
    is an injected parameter so callers/tests are deterministic — returns
    `MISSING_STORE`/`MISSING_DATE`/`DATE_NOT_STANDARD`/`FUTURE_DATE`
    (1-day grace)/`MISSING_TOTAL`/`TOTAL_MISMATCH` (skipped unless every
    item has a usable amount; tolerant of either tax-added-on-top or
    tax-already-included, tolerance `0.05`)/`LINE_MISMATCH` (per
    `Decimal(str(value))` math, never raw floats — raised only when the
    line total matches *neither* the plain `quantity x unit_price` check
    within `TOTAL_TOLERANCE` (`0.05`) *nor* `quantity x unit_price x (1 +
    rate)` within `VAT_LINE_TOTAL_TOLERANCE` (`0.02`) for a `rate` in
    `GERMAN_VAT_RATES = (0.07, 0.19)` — the latter covers a German receipt
    that prints an item's unit price net of VAT next to a line total
    gross of VAT, e.g. a 2.23 net unit price next to a 2.39 gross line
    total at 19% VAT; a real mismatch, explained by neither check, still
    warns); raises domain
    exceptions, no HTTP/FastAPI/file I/O; `flatten_line_items(saved_receipt)`
    — pure, no I/O — turns one `SavedReceipt`'s `items` into `LineItemRow`s
    in their original order (`line_index` 0, 1, 2, ...), normalizing
    `purchase_date` for display with the same `normalize_purchase_date`
    call `get_receipt()` uses (never duplicated, never computes or converts
    money, nulls stay null); `matches_query(row, q)` — pure — splits `q`
    (assumed already trimmed) on whitespace and requires every word to
    appear as a substring of the row's item name or store name, with both
    sides passed through `fold_for_search(text)` — pure: `casefold()`,
    `ß`→`ss`, NFKD with combining marks dropped, then `ae`→`a`, `oe`→`o`,
    `ue`→`u` — so "gluck"/"glueck"/"GLÜCK" find "Waldglück", "muesli"
    finds "Müsli", "strasse" finds "Straße", "cafe" finds "Café"
    (search-only: stored data is never changed); a null item name can still match through the store
    name; an empty `q` matches every row, though `api/routes.py` simply
    skips calling this at all for a blank query); `sort_line_items(rows,
    sort)` — pure, no I/O — `DEFAULT_ITEM_SORT = "date_desc"`,
    `ALLOWED_ITEM_SORT_VALUES = ("date_desc", "date_asc", "amount_desc",
    "amount_asc", "store")`. Expects `rows` already in the tie-break
    order (receipt `created_at` DESC, `receipt_id` ASC, `line_index`
    ASC — the order `list_matching_receipts`/`flatten_line_items`
    naturally produce) and relies on Python's sort being **stable**:
    sorting by just the primary criterion reproduces that full tie-break
    order for free among rows sharing the same primary key, with no need
    to re-state it as a compound key. `"store"` sorts by
    `store_name.casefold()`, a `None` name always last. `"amount_desc"`/
    `"amount_asc"` sort by `line_total` as `Decimal(str(value))` — never
    a raw float — a `None` `line_total` always last in both directions
    (mixed currencies are compared by number only — a deliberate
    simplification, no conversion). `"date_desc"`/`"date_asc"` (default)
    sort by `normalize_purchase_date(row.purchase_date)` — safe to call
    again even though `flatten_line_items` already normalized the row's
    `purchase_date` for display, since re-normalizing an already-ISO date
    is a no-op and re-normalizing an already-unparseable raw string still
    correctly returns `None` — a row with no valid date always sorts
    last, in both directions (every "last" case is implemented by
    partitioning into two lists — e.g. `with_amount`/`without_amount` —
    sorting only the first stably, then concatenating, rather than
    encoding "missing" into the sort key itself, which would risk
    putting it first when `reverse=True`).
    `ports.py` (`ReceiptExtractor` Protocol + `ExtractionError` /
    `ExtractionUnavailableError`, `ReceiptRepository` Protocol —
    `save_upload`/`get_upload`/`save_receipt`/`get_receipt`/
    `list_receipts`/`update_receipt`/`reset_receipt`/`delete_receipt`/
    `list_apartments`/`get_apartment`/`set_receipt_apartment`/
    `set_receipt_status`/`get_receipt_facets`/`list_matching_receipts`,
    plus the
    strict, separate `ReceiptUpdate`/`LineItemUpdate`/`DiscountUpdate`/
    `TaxUpdate` models in `models.py` for user-submitted corrections, and
    `ApartmentAssignment` (`apartment_id: str`, `extra="forbid"`) for
    `PUT /receipts/{id}/apartment`'s body, and `StatusAssignment`
    (`status: str`, `extra="forbid"`, a `field_validator` rejecting
    anything outside `ALLOWED_RECEIPT_STATUSES`) for
    `PUT /receipts/{id}/status`'s body — each its own model, deliberately
    separate from `ReceiptUpdate`, so a classification change can never be
    confused with (or smuggled into) a data correction — deliberately
    distinct from the lenient `ReceiptData` family used to parse AI output,
    which must stay lenient). `ExtractionError` means the receipt itself couldn't
    be read (unparseable output, timeout, bad request);
    `ExtractionUnavailableError` means the AI *service* isn't usable (bad
    key, no credit, unknown model, rate limit) — they map to `502` and
    `503` respectively in `api/routes.py`, so a misconfigured key doesn't
    look like an unreadable receipt. Must never import `adapters`, `api`,
    `fastapi`, `openai`, `sqlite3`, or `config.py`.
  - `adapters/` — `openai_extractor.py` (`OpenAIReceiptExtractor`, the
    OpenAI API call — maps `AuthenticationError`/`PermissionDeniedError`/
    `NotFoundError`/`RateLimitError` to `ExtractionUnavailableError`,
    everything else to `ExtractionError`, always via `raise ... from exc`
    so the real cause is still logged; `EXTRACTION_INSTRUCTIONS` includes
    one rule for `purchase_date` — return `YYYY-MM-DD`, converting German
    month names and dotted dates (day first), null if unsure — matching
    `domain.rules.normalize_purchase_date`'s own accepted shapes, so the AI
    is nudged toward a format this app can already parse even before
    `normalize_purchase_date` runs server-side as a fallback), `file_storage.py` (saving/finding
    files in `uploads/` by UUID filename; `delete_file` looks up the file
    the same way `find_file` does — by the validated UUID, inside
    `UPLOAD_DIR` only, never a client-supplied path — and treats an
    already-missing file as a no-op, not an error, so a retry is safe),
    `sqlite_repository.py`
    (**concurrency:** every method opens its own short-lived connection via
    `_connect()` and closes it immediately — never one shared/reused
    connection — so `sqlite3`'s default `check_same_thread=True` is never
    at risk; combined with `sqlite3.connect()`'s default 5s busy timeout,
    this has been verified safe for light concurrency (a handful of
    parallel upload+extract requests) by `tests/test_concurrency.py`,
    without needing WAL mode or any other change.
    `SqliteReceiptRepository`: stdlib `sqlite3`, no ORM; `uploads`,
    `receipts` and `apartments` tables; schema created via
    `CREATE TABLE IF NOT EXISTS`, plus a small additive migration on
    construction — `PRAGMA table_info` then
    `ALTER TABLE ... ADD COLUMN` only for a column that's missing, never
    dropping/recreating a table, so existing rows always survive an
    upgrade; this is how `edited_at`, the nullable `apartment_id` columns
    on `uploads`/`receipts`, and the
    `status TEXT NOT NULL DEFAULT 'needs_review'` column on `receipts`
    were all added — the `NOT NULL DEFAULT` applies to existing rows too,
    so every receipt that predates the column still gets `needs_review`.
    `apartments` is a new table (no migration
    needed there) seeded with `DEFAULT_APARTMENTS`
    via `INSERT OR IGNORE` every time, so it's idempotent). (A `categories`
    table and a `category_id` column/migration on `receipts` existed here
    too, until the expense-category feature was removed — see
    [docs/adr/0004-remove-categories.md](docs/adr/0004-remove-categories.md).
    A database that already has them keeps them, untouched and unread; a
    new database never gets them.)
    `list_apartments` returns only `active = 1` rows
    ordered by `sort_order`; `get_apartment` returns a row
    regardless of `active` (the route distinguishes "unknown" from
    "inactive" itself, and a receipt's `apartment_name`
    must still resolve even if deactivated later).
    `save_receipt`'s `INSERT`/`ON CONFLICT` deliberately omits
    `apartment_id` from the `ON CONFLICT` `SET` clause: a first save inserts
    it, a re-extract leaves whatever is already there untouched; it also
    always resets `status` to
    `'needs_review'` on every save, first or re-extract alike, since the
    underlying data was just replaced.
    `set_receipt_status` mirrors
    `set_receipt_apartment`: one transaction, updates only
    `status` plus `updated_at`, returns `None` if no `receipts` row exists
    (so the route 404s), never touches `edited_at`, `extracted_json`,
    `ai_result_json`, `created_at`, or `apartment_id`.
    `list_receipts(limit, offset=0, ...)` orders by `created_at DESC,
    receipt_id ASC` (stable tie-break) and builds each row from
    `extracted_json` (same source as `get_receipt`, so `total`'s JSON
    type matches); a row with unparseable
    `extracted_json` is logged (receipt_id only) and skipped rather than
    failing the whole list. It returns `(summaries, total)`: `total` is
    `len(rows)` from `_filtered_receipt_rows` (every matching, already-
    parsed receipt, before the `limit`/`offset` slice — so a skipped
    corrupt row is excluded exactly as it already was from the old
    `count`), and `summaries` is built from `rows[offset : offset +
    limit]` only — never eagerly converting rows outside the requested
    page into `ReceiptSummary` objects.
    **Filtering (`apartment_id`/`year`/`undated`/`status` params):**
    `apartment_id` and `status`
    (plain column equality) are filtered in a parameterized SQL `WHERE`
    clause built from a list of clauses/params — never string-formatted
    user input. `year`/`undated` can't be done that way without duplicating
    date-validity logic in SQL, so they're filtered in Python instead, by
    calling `domain.rules.normalize_purchase_date` on each matching row's
    `extracted_json`-sourced `purchase_date` (the same shared rule
    `check_receipt`/`save_receipt`/`get_receipt` all use) — a year matches
    only when normalization succeeds and the result starts with that year
    (so a raw `"26/06/2025"` never matches `year=2025`, only `undated`).
    Because the date filter runs after the SQL query, the SQL side has NO
    `LIMIT` when any filter is given; `limit` is applied in Python as rows
    are accepted, after the corrupted-JSON skip and the date filter, so a
    filtered call never over- or under-counts.
    The SQL `WHERE`-building and the row-filtering/parsing loop above both
    live in a private `_filtered_receipt_rows(conn, ...)` shared by
    `list_receipts` and `list_matching_receipts` — the latter is
    `GET /items`'s source: same filters, same order, no `limit`, but each
    row rebuilt into a full `SavedReceipt` (not a `ReceiptSummary`) so
    `domain.rules.flatten_line_items` has every item to flatten. Unlike
    `list_receipts`'s summaries, `list_matching_receipts`'s
    `SavedReceipt.purchase_date` is left raw/unnormalized — normalizing it
    for display is `flatten_line_items`'s job, not the adapter's, so that
    responsibility stays in one place (`domain/rules.py`) rather than
    being duplicated across two adapter methods. `get_receipt_facets`
    (`ApartmentFacet`/`ReceiptFacets` in `models.py`) computes `apartments`
    (one row per apartment via `LEFT JOIN` + `COUNT`, always *every*
    receipt for that apartment, ignoring `apartment_id`) and `total`
    (`COUNT(*)` over all receipts) in one query each; `years`/`has_undated`
    are computed the same way as the date filter above (via
    `normalize_purchase_date` over each row's `extracted_json`), scoped to
    `apartment_id` via a parameterized `WHERE` when one is given.
    `update_receipt` replaces `extracted_json` and
    the four denormalized columns, sets `edited_at` to now, in one
    transaction, refreshes `updated_at`, and **never touches
    `ai_result_json` or `created_at`** — the original AI output stays
    byte-for-byte intact; returns `None` (never creates a row) if the
    receipt doesn't exist. `reset_receipt` is the reverse: parses
    `ai_result_json` with the same lenient `ReceiptData` model used for AI
    output, re-applies the same date normalization extraction does, writes
    that into `extracted_json` and the four denormalized columns, clears
    `edited_at` to `NULL`, refreshes `updated_at`, keeps `created_at` — one
    transaction, `ai_result_json` itself never touched; returns `None` if
    the receipt doesn't exist (so the route 404s), and is safe to call
    repeatedly (idempotent) or on a receipt that was never edited.
    `set_receipt_apartment` updates only `apartment_id` and `updated_at` on
    the `receipts` row (plus `apartment_id` on the matching `uploads` row,
    when one exists) in one transaction — never `edited_at`,
    `extracted_json`, `ai_result_json` or `created_at`, since this is a
    classification change, not an edit; returns `None` if the receipt
    doesn't exist (so the route 404s), else re-fetches via `get_receipt`.
    `delete_receipt` removes the row from both
    `receipts` and `uploads` in one transaction, returning whether a
    `receipts` row existed. Must never import `api`.
    **Date normalization:** `save_receipt` captures `ai_result_json` from
    the data exactly as the AI returned it *before* normalizing — so a raw,
    unparseable date is preserved there forever — then normalizes
    `purchase_date` in place (via `domain.rules.normalize_purchase_date`)
    for both the caller's `data` object and `extracted_json`/the
    `purchase_date` column; an unparseable date is kept as-is (not
    discarded) so the user can see and correct it. `get_receipt`
    additionally normalizes `purchase_date` for display only (never
    rewriting the stored row) so a pre-normalization row shows the clean
    date too, without a migration. `update_receipt` needs no normalization
    on write, since `ReceiptUpdate.purchase_date`'s own validator already
    requires `null` or a valid ISO date.
    **Money rule:** `total` is never stored as a float — the adapter
    converts with `Decimal(str(value))` to an exact decimal string (e.g.
    `19.99`, not a binary-float expansion) in a dedicated column kept for
    future search/summary use; the live API always reads `total` back from
    `extracted_json` (the full `ReceiptData`, parsed with its original
    float), never from that decimal-string column, so no rounding error
    ever reaches a response.
  - `api/` — `app.py` (creates the FastAPI app, CORS middleware — origins
    from `CORS_ORIGINS`, methods `GET`/`POST`/`PUT`/`DELETE` (not `"*"`;
    PUT and DELETE were added for Issue 10 — PUT was missing before then,
    so the edit form's Save was silently blocked by the browser's CORS
    preflight even though curl and Jest's mocked `fetch` never exercise
    real CORS enforcement and so never caught it) — and a `lifespan`
    handler that creates the repository — and therefore the SQLite schema
    — at startup, not the deprecated `on_event`),
    `routes.py` (`/health`, `GET /apartments` — active apartments only,
    `sort_order`, `{"id", "name"}` per item (a `GET /categories` endpoint
    existed here too, until the expense-category feature was removed —
    see
    [docs/adr/0004-remove-categories.md](docs/adr/0004-remove-categories.md);
    the path now simply 404s, like any other undefined route),
    `POST /receipts/upload` —
    `apartment_id` is a **required** form field, validated via
    `repository.get_apartment()` *before* the existing file-type/size
    validation and before anything is written (missing -> FastAPI's own
    `422`; unknown -> `422` "Unknown apartment."; inactive -> `422` "This
    apartment is no longer active." — none of these touch disk or create
    an uploads row), stored on the uploads row, echoed in the response as
    `apartment_id`/`apartment_name`.
    **Duplicate-file detection (`domain.rules.content_hash`/
    `is_valid_sha256_hex`, `uploads.content_sha256`,
    `POST /receipts/check-duplicates`, `scripts/backfill_hashes.py`):** the
    same receipt file must never be uploaded, read by the AI (which costs
    money) and counted twice. `content_hash(data: bytes) -> str` (pure,
    stdlib `hashlib` only) is SHA-256 as a lowercase 64-char hex string;
    `is_valid_sha256_hex(value)` is true only for exactly that shape
    (uppercase, short or non-hex all `False`). The upload route computes
    `content_hash()` on the bytes it already read, right after the
    existing file-type/size/emptiness validation (so those keep their own
    `400`/`413` even when the bytes would otherwise match a saved receipt)
    and *before* `save_file`/`save_upload` — a flagged duplicate writes
    nothing to disk and no `uploads` row. A new optional form field,
    `allow_duplicate` (`bool`, default `false`): when a **saved** receipt
    (one with a `receipts` row — an upload that was never extracted, or
    whose receipt was since deleted, doesn't count) already has this exact
    hash and `allow_duplicate` is `false`, the route returns `409` with
    `{"detail": {"code": "DUPLICATE_FILE", "message": "This file is
    already saved.", "existing": <ReceiptSummary>}}` — the same field set
    `GET /receipts`'s list rows use (`receipt_id`/`original_filename`/
    `store_name`/`purchase_date` (normalized for display, like
    `get_receipt()`)/`currency`/`total`/`created_at`/`apartment_id`/
    `apartment_name`/`status`); the `201` response shape is otherwise
    unchanged, and the hash itself is never part of it. `allow_duplicate:
    true` (or no existing match) continues exactly as before, storing the
    hash on the `uploads` row. `POST /receipts/check-duplicates` (body
    `{"hashes": [...]}` validated against `DuplicateHashesRequest`, a
    bare `list[str]`, `extra="forbid"`) lets the frontend batch-check
    several files before even starting an upload: at most 50 entries
    (`MAX_DUPLICATE_CHECK_HASHES`), each must pass `is_valid_sha256_hex`
    (else `422`); an empty list is `{"items": []}`; otherwise
    `{"items": [{"hash", "existing": <ReceiptSummary> or null}, ...]}` in
    request order — a repeated hash is answered per entry, never
    deduplicated. Never calls the extractor, never writes anything.
    Registered as a plain `POST` on a fixed literal path, so it can never
    collide with `POST /receipts/upload` (different path) or
    `GET /receipts/{receipt_id}` (different HTTP method). `ReceiptRepository`
    gained `find_saved_by_hashes(hashes) -> dict[hash, ReceiptSummary]`
    (parameterized `IN`, chunked at 200 per query — defensive, SQLite's
    own parameter limit is much higher; when several uploads share a hash,
    picks the **oldest** by `receipts.created_at`), `set_upload_hash(
    receipt_id, content_sha256)` (used only by the backfill script),
    `list_uploads_without_hash()`, `count_uploads()`, and
    `list_saved_hash_duplicate_groups()` (groups of 2+ saved receipts
    sharing a hash — used only by the backfill script's `--report`, a
    different, unrelated notion of "duplicate" from the yearly report's
    own apartment/date/store/total-based `possible_duplicates`). `save_
    upload(...)` gained an optional `content_sha256` parameter, stored in
    a new, non-unique (`allow_duplicate` can legitimately create more than
    one upload with the same hash) `uploads.content_sha256 TEXT NULL`
    column plus `idx_uploads_content_sha256`, added via the same existing
    `PRAGMA table_info` + `ALTER TABLE ADD COLUMN`-if-missing migration
    guard as every other additive column here — an old database's
    existing rows keep `content_sha256 = NULL` until backfilled.
    `scripts/backfill_hashes.py` (operational, like `backup.py` —
    `BACKEND_DIR` on `sys.path`, `config`/`adapters.sqlite_repository`
    imported lazily inside `main()`, never imported *by* domain/adapters/
    api) hashes every `uploads` row still missing one: `run_backfill(
    repository, dry_run=False)` finds each file via the existing safe,
    UUID-based `adapters.file_storage.find_file` lookup, hashes it in
    64 KiB chunks via `scripts._common.sha256_file` (already used by
    `backup.py`, just a smaller `chunk_size` here), and stores it through
    `repository.set_upload_hash(...)` — never raw SQL in the script
    itself. A missing file is skipped and counted, never fatal; idempotent
    (only rows still missing a hash are ever touched, so a second run
    with nothing new to do changes nothing); `--dry-run` runs the same
    logic but skips the `set_upload_hash` write; `--report` additionally
    calls `list_saved_hash_duplicate_groups()` and prints each group
    (apartment short name via a tiny script-local `_short_apartment_name`
    — the frontend's `apartmentShortName` has no backend equivalent —
    store, date, total, receipt ids, oldest first) without changing or
    deleting anything. Prints only a summary (hashed/already hashed/
    missing file counts, plus the report) — never file contents or full
    paths. **Out of scope, both here and for the 409 check:** near-
    duplicate or image-similarity detection — only a byte-for-byte
    identical file is ever caught; a re-compressed or re-photographed
    copy of the same receipt is not.
    `POST /receipts/{receipt_id}/extract`, `GET /receipts/{receipt_id}`,
    `GET /receipts?limit=N&offset=M&sort=S` — list, `limit`
    default 50 (1–200, else `422`), `offset` default 0 (`>= 0`, else
    `422`), **`sort`** (`ALLOWED_RECEIPT_SORT_VALUES`, default
    `DEFAULT_RECEIPT_SORT = "date_desc"`; anything else `422` "sort must
    be one of: …", same style as `GET /items`): `date_desc`/`date_asc` by
    `normalize_purchase_date`, `amount_desc`/`amount_asc` by total as
    `Decimal(str(value))`, `uploaded_desc` = the former fixed order
    (`created_at` DESC). A receipt with no valid date (date sorts) or no
    total (amount sorts) always comes **last, in either direction**.
    `domain.rules.sort_receipts(rows, sort, purchase_date=…, total=…)` is
    pure and takes key functions (no adapter types); the repository's
    `list_receipts(…, sort=…)` applies it to the rows
    `_filtered_receipt_rows` already returns in the tie-break order
    (`created_at` DESC, `receipt_id` ASC) — Python's sort is stable, so
    equal keys keep that order — and only *then* slices `limit`/`offset`,
    so "Show more" pages continue the same order and `total` is
    unchanged. (Before this, the list was always newest-upload-first; the
    existing order tests still pass unchanged because their receipts all
    share one purchase date, so the date sort ties and keeps upload
    order.)
    `{"items": [...], "count": N, "total": T}`, empty DB ->
    `{"items": [], "count": 0, "total": 0}` never `404`. `total` is the
    count of every receipt matching the given filters, ignoring
    `limit`/`offset` entirely (the same stable order — `created_at`
    DESC, `receipt_id` ASC — applied *before* the `limit`/`offset`
    slice, same as `GET /items`); `count` stays the number of items
    actually returned on this page. A row skipped for unparseable
    `extracted_json` is excluded from `total` the same way it was
    always excluded from `count` — it was never part of the filtered
    rows to begin with, not a new special case. `offset`/`total` were
    added — mirroring `GET /items`, which already had both — after an
    earlier frontend ticket ("Tidy History filters and add Show more")
    hit this exact gap and stopped rather than guess at a backend
    change. Optional filters, AND-combined,
    no params unchanged from before, validated by the shared
    `_validate_receipt_filters(repository, apartment_id, year, status)`
    helper (also used by `GET /items`, below, so the two
    endpoints' filter rules can never drift apart): `apartment_id` (422 via
    `repository.get_apartment()` if unknown — same check and message as the
    apartment PUT), `year` (`_parse_year_filter()`: a 4-digit `\d{4}`
    2000–2100 or the literal string `"none"` for null/non-ISO dates; the
    `\d{4}` regex check happens *before* `int()` + range, so `"2025x"`/
    `"25"`/`"20255"` are rejected the same way a too-small/too-large year
    is, all `422`), `status` (`"needs_review"`/`"approved"` else `422`).
    (A `category_id` filter existed here too; it was removed along with the
    rest of the expense-category feature — see
    [docs/adr/0004-remove-categories.md](docs/adr/0004-remove-categories.md)
    — so a client still sending it now gets it silently ignored, like any
    other undeclared query parameter, rather than a `422`.)
    `GET /receipts/facets?apartment_id=<optional>` —
    registered *before* `GET /receipts/{receipt_id}` in `routes.py` (source
    order is what FastAPI matches on) so the literal path `/receipts/facets`
    is never captured by that route's `{receipt_id}` segment; 422 for an
    unknown `apartment_id`; returns `repository.get_receipt_facets(...)
    .model_dump()` directly.
    **Yearly spending summary (`GET /reports/years`, `GET
    /reports/yearly?year=YYYY&basis=all|approved`,
    `domain.rules.summarize_year`):** both live under `/reports`, a path
    segment `GET /receipts/{receipt_id}` can never match, so there is no
    registration-order collision to worry about (nor between the two new
    routes themselves, whose own suffixes differ). `GET /reports/years`
    reuses the exact same unscoped `get_receipt_facets()` call `GET
    /receipts/facets` does and returns `{"items": facets.years}` (already
    descending) — so the two can never disagree about which years exist.
    `GET /reports/yearly` requires `year` (a plain 4-digit `2000-2100`,
    *not* the list endpoints' own `year` filter, which also accepts
    `"none"` — this one has no undated case, since a report is always for
    one specific year) — missing or invalid is `422` via a dedicated
    `_parse_report_year()`, deliberately not shared with `_parse_year_
    filter()`. `basis` defaults to `"all"` (every receipt counts whatever
    its status — the owner has no time to review every receipt before a
    tax declaration is due) or `"approved"`; anything else is `422`.
    The route itself does almost nothing: `repository.list_matching_
    receipts()` (no filters — every receipt) and `repository.list_
    apartments()` (active, in `sort_order`) feed straight into
    `domain.rules.summarize_year(receipts, apartments, year, basis,
    date.today())`, whose result is returned via `.model_dump()` — no new
    repository/adapter method was needed; both calls were already there
    for `GET /items`/`GET /apartments`.
    **`summarize_year`'s bucket order** (a receipt counts at most once, in
    the *first* bucket it matches): (a) no valid normalized date ->
    `excluded.undated` — checked *before* the year comparison, so this is
    the one bucket that is **not** scoped to the requested year (an
    undated receipt belongs to no year, so it is `excluded.undated` for
    every year queried); (b) a valid date whose year differs from the
    requested one -> silently **ignored** (not counted in any bucket at
    all, for this call); (c) `basis == "approved"` and the receipt isn't
    approved -> `excluded.not_approved` (never reached at all when
    `basis == "all"` — that bucket then stays `0`); (d) `total is None`
    -> `excluded.no_total`; (e) currency missing/blank (trimmed, so
    whitespace-only counts as missing) -> `excluded.no_currency`; (f)
    `apartment_id is None` -> `excluded.no_apartment`; (g) otherwise,
    **counted**. The year itself comes from `normalize_purchase_date` —
    never `created_at` — so a legacy dotted/month-name date (see
    `domain/rules.py` above) lands in the right year/month exactly like
    everywhere else in the app. The amount is the receipt's `total` from
    `extracted_json` (the edited working copy — `list_matching_receipts`
    already reads from there, same as `GET /items`), as printed, gross
    (no net/VAT split); a negative total (a refund) sums with its sign.
    Every amount in the response is `Decimal(str(value))` math only, as a
    decimal string quantized to two decimals with `ROUND_HALF_UP` (not
    Python's default round-half-to-even) via `_format_report_amount()` —
    a fixed, documented rounding rule for a report used for a tax
    declaration; a comment notes currencies with a different number of
    decimal places aren't supported yet. Currencies are never added
    together — every total is grouped by the receipt's own currency
    (trimmed, uppercased).
    **Response shape:** `apartments` — one entry **per active apartment,
    always, in `sort_order`**, even one with zero counted receipts (empty
    `by_currency`/`months`) — each with `by_currency` (currencies in
    alphabetical order) and `months` (`1`-`12`, **only months that
    actually had a counted receipt**); `overall` — the same `by_currency`
    shape, summed across every apartment (always equal to the sum of the
    apartments' own `by_currency`, since both are built from the same
    per-receipt loop); `overall_months` — both apartments together per
    month, the same `MonthlyBreakdown` shape as an apartment's `months`
    (only months with a counted receipt, currencies never mixed), summed
    with `Decimal` from the same counted receipts as `overall` in the same
    loop, so it equals the apartments' months added up and its months add
    up to `overall` (for two-decimal amounts; each value is quantized
    half-up on its own, exactly like `overall` vs. the apartments). It is
    a separate top-level field rather than `overall.months` because
    `overall` is a list and stays unchanged for existing clients;
    `excluded` (the five counts above); `with_warnings`
    — the number of **counted** receipts for which `check_receipt(data,
    today)` returns at least one warning (an excluded receipt's warnings,
    if any, are never counted here).
    **Owner-facing extras (none of these ever include an excluded
    receipt):** `counted_unreviewed` — counted receipts whose `status !=
    "approved"` (always `0` under `basis == "approved"`, since every
    counted receipt is approved by definition there; meaningful under
    `basis == "all"`, where it says how many of what's counted still
    needs review). `attention` — up to 50 counted receipts with at least
    one warning, sorted by (normalized `purchase_date`, `receipt_id`)
    ascending, each `{receipt_id, store_name, purchase_date, total,
    currency, apartment_id, warning_codes}`; `with_warnings` is the
    *full* count (may exceed 50) — `attention` is just a capped sample to
    act on. `possible_duplicates` — up to 50 groups (`possible_
    duplicate_groups` is the full count) of 2+ counted receipts sharing
    `apartment_id`, normalized `purchase_date`, `store_name` (trimmed,
    `casefold()`-ed — never a `None`/blank store, which is never grouped),
    currency and `total` (compared as `Decimal`); groups are sorted by
    (`purchase_date`, `apartment_id`, store `casefold()`, currency,
    `total`) for a deterministic order. **Totals are never reduced for a
    detected duplicate** — a duplicate stays fully counted in every total
    above until the owner actually deletes one of the receipts; this
    endpoint only flags the group, it never guesses which copy (if
    either) is the real one. `largest` — per currency (alphabetical),
    the 10 counted receipts with the largest **absolute** total (so a
    large refund ranks by its magnitude, not its sign; ties broken by
    `receipt_id`), each `{receipt_id, store_name, purchase_date, total,
    apartment_id}` (no `currency` field inside an item — it's already the
    enclosing group's key).
    **Yearly export for the tax advisor (`domain/report_export.py`,
    `adapters/report_export.py`, `GET /reports/yearly/export.csv`,
    `GET /reports/yearly/export.zip`):** gives a statement with one row
    per receipt plus the receipt documents, so the owner's tax advisor
    can check every number against the original. `domain.rules.
    classify_receipt(receipt, year, basis)` was extracted from
    `summarize_year` (a pure refactor, no behavior change -- all of
    `summarize_year`'s own tests pass unchanged) and returns one of
    `"counted"`/`"other_year"`/`"undated"`/`"not_approved"`/`"no_total"`/
    `"no_currency"`/`"no_apartment"`, the exact same order/rules
    `summarize_year` always used; `summarize_year` now calls it instead
    of duplicating the bucket logic. `domain.report_export` is pure
    (only the standard library's `csv`/`io`, plus `domain.rules`/
    `domain.models`) and defines `STYLES = ("excel_de", "plain")`:
    `excel_de` is `;`-delimited, UTF-8 with a leading BOM, decimal comma,
    dates `DD.MM.YYYY`, German headers/words (for Excel on German
    Windows); `plain` is `,`-delimited, no BOM, decimal point, ISO dates,
    English headers/words. `format_amount(value, style)` quantizes a
    `Decimal` to 2 places with `ROUND_HALF_UP` (the same rule
    `summarize_year` uses) and swaps `.` for `,` under `excel_de` --
    never a float. `sanitize_cell(text)` is the CSV/formula-injection
    mitigation: for TEXT cells only (store name, source file name,
    apartment name -- never an amount column) a value starting with `=`,
    `+`, `-`, `@`, a TAB or a CR gets a leading single quote, so a store
    named e.g. `=HYPERLINK(...)` can never be read as a formula by Excel/
    Sheets; `None` becomes `""`. `counted_receipts(receipts, year, basis,
    apartment_id=None)` first restricts to one apartment when given (so
    a receipt with no apartment is excluded by the filter itself, never
    by `classify_receipt`), then keeps only the `"counted"` ones -- shared
    by `receipts_rows`, the ZIP's PDF loop, and the route's
    `MAX_EXPORT_RECEIPTS` check, so all three always agree on the same
    set. `receipts_rows(...)` returns rows ordered by normalized purchase
    date, then store (`casefold()`-ed), then `receipt_id`; columns are
    Nr/No, Datum/Date, Geschaeft/Store, Wohnung/Apartment, Waehrung/
    Currency, Betrag brutto/Amount gross (the working-copy total as
    printed, gross -- no VAT split, no total row), Status/Status
    (`"geprueft"`/`"nicht geprueft"` or `"approved"`/`"not reviewed"`),
    Bearbeitet/Edited (`"ja"`/`"nein"` or `"yes"`/`"no"`, from
    `SavedReceipt.edited`), Warnungen/Warnings (space-separated
    `check_receipt()` codes -- the same mechanism `summarize_year`'s own
    `with_warnings`/`attention` already use), PDF/PDF (the ZIP's relative
    path, blank if that receipt's PDF could not be built), Quelldatei/
    Source file (`original_filename`), Beleg-ID/Receipt ID.
    `not_included_rows(...)` lists every excluded receipt (never
    `"other_year"` or `"counted"`) with a plain-words Reason per bucket;
    an undated receipt has no year of its own, so it appears in **every**
    year's `not_included.csv` -- stated in `README.txt`. `summary_rows(
    summary, style, apartment_id=None)` reuses the numbers an already-
    computed `YearlySummary` holds (never recomputes money differently):
    one row per apartment/currency, plus a "Beide Wohnungen"/"Both
    apartments" row from `summary.overall` -- included **only** when
    `apartment_id` is `None` (an apartment-filtered export shows that one
    apartment's rows only). `to_csv(headers, rows, style)` writes via the
    `csv` module (`QUOTE_MINIMAL`, `"\r\n"` line endings), prepending the
    BOM for `excel_de`. `readme_text(...)` explains each file, that
    amounts are gross/printed/not tax advice, that possible duplicates
    stay fully counted, that undated receipts repeat in every year's
    `not_included.csv`, the basis, the UTC generation time and the
    counts (German for `excel_de`, English for `plain`).
    `adapters.report_export.build_zip(receipts, apartments, year, basis,
    style, apartment_id, today, upload_dir)` (stdlib `tempfile`/
    `zipfile` only -- no new dependency) writes `receipts.csv`/
    `summary.csv`/`not_included.csv`/`README.txt` plus one archive PDF
    per counted receipt at `documents/<apartment_id>/<name>.pdf`, where
    `<name>` is `domain.rules.archive_filename(...)` **without** its
    `.pdf` extension, plus `"_"` and the first 8 characters of the
    receipt id, plus `.pdf` -- unique even for two receipts sharing
    store/date/total, and ASCII-only like `archive_filename` itself.
    Each receipt's PDF comes from the existing `adapters.pdf_archive.
    make_archive_pdf` (a `.pdf` original passed through byte-for-byte; an
    image converted, EXIF-rotated, size-capped, exactly as `GET /receipts/
    {id}/archive.pdf` already does) via the existing safe lookup in
    `adapters.file_storage.find_file` (plus a resolved-path containment
    check against `upload_dir`, defense in depth). A missing file or an
    `ArchiveError` for one receipt never aborts the export: that
    receipt's PDF column in `receipts.csv` stays blank and
    `"<receipt_id>: <short reason>"` (no stack trace, no path) is
    appended to a `problems.txt` member, added to the ZIP only when at
    least one problem occurred. Returns the path of a temporary ZIP
    file; the caller deletes it once the response has been sent.
    The two routes share `_validate_export_params()`: `year` (the same
    required 4-digit `2000-2100` `_parse_report_year` the plain yearly
    report uses), `basis` (`ALLOWED_REPORT_BASIS`, default `"all"`),
    `style` (`STYLES`, default `"excel_de"`), and an optional
    `apartment_id` (422 via `repository.get_apartment()` if unknown --
    same check as everywhere else). With `apartment_id` given, only that
    apartment's receipts are included and a receipt with no apartment is
    left out -- it appears only in the unfiltered export's
    `not_included.csv`. `GET /reports/yearly/export.csv` returns just
    `receipts.csv` as the body -- `Content-Type: text/csv; charset=utf-8`,
    `Content-Disposition: attachment; filename="receipts-<year>-
    all-apartments.csv"` (or `-<apartment_id>.csv`), `X-Content-Type-
    Options: nosniff`, `Cache-Control: private, no-cache` -- and has
    **no** limit on the number of counted receipts. `GET /reports/yearly/
    export.zip` returns the full ZIP the same way (`Content-Type:
    application/zip`, filename `smart-receipt-report-<year>-
    all-apartments.zip` or `-<apartment_id>.zip`) via `FileResponse` plus
    a `BackgroundTask` that unlinks the temporary file once the response
    is sent; `MAX_EXPORT_RECEIPTS = 500` caps only this route (never the
    CSV route) -- more counted receipts than that is a `422` suggesting
    picking one apartment or using the CSV export instead, checked via
    the exact same `counted_receipts(...)` list the ZIP itself would
    build (so the check and the export can never disagree). Both routes
    live under `/reports/yearly/export.*`, static suffixes that can never
    collide with `GET /reports/yearly` or `GET /receipts/{receipt_id}`.
    **Out of scope:** VAT split, categories, Excel `.xlsx`, currency
    conversion, encryption, scheduling, and this export never changes
    any report total. **The ZIP is not encrypted and contains personal
    data** (receipt images/PDFs and amounts) -- handle and send it with
    the same care as the original receipts.
    `GET /items` — a flat list of purchased line items across receipts:
    `{"items": [...], "count": <returned>, "total": <all matching rows>}`.
    Accepts the identical `apartment_id`/`year`/`status`
    (same `_validate_receipt_filters()` call, same `422` rules, same
    "unrecognized parameter is ignored" behavior for a stray `category_id`)
    plus `q`
    (stripped; `422` if longer than `MAX_ITEM_SEARCH_LENGTH` = 100 *after*
    stripping; a blank result is treated as "no search," not an error),
    `sort` (`Query(default=DEFAULT_ITEM_SORT)`, 422 if not in
    `ALLOWED_ITEM_SORT_VALUES` — checked right after the shared filter
    validation, before the `q` length check), and
    `limit`/`offset` (`Query(default=100, ge=1, le=500)`/
    `Query(default=0, ge=0)`, else `422`). Calls
    `repository.list_matching_receipts(**filters)` (unlimited, already
    apartment/year/status-filtered), then — entirely in Python,
    documented in a code comment as fine at this app's scale but not
    forever — flattens every matching receipt via
    `domain.rules.flatten_line_items`, filters by `q` via
    `domain.rules.matches_query` when `q` isn't blank, sorts via
    `domain.rules.sort_line_items(rows, sort)` (always — even for the
    default — so the explicit `sort=date_desc` and no `sort` param at all
    produce byte-identical responses), and *then* slices
    `rows[offset : offset + limit]`; `total` is `len(rows)` *before* that
    slice, `count` is `len(page)` after it. Without a `sort` param, row
    order (receipt
    `created_at` DESC/`receipt_id` ASC, then `line_index` ASC) used to
    fall out
    entirely from `list_matching_receipts`'s own order plus
    `flatten_line_items` enumerating each receipt's `items` in place; that
    tie-break order is now the *fallback* within `sort_line_items` (see
    `domain/rules.py` above) rather than the only order, since
    `date_desc` is now the explicit default sort rather than "no
    sorting at all" — a deliberate, intentional change to the previously
    implicit default order (the pre-existing ordering tests in
    `tests/test_items.py` needed no changes, since every row in them
    shares the same `purchase_date`, so `date_desc`'s stable tie-break
    reproduces the exact order those tests already asserted; new tests
    cover every sort mode explicitly). `PUT /receipts/{receipt_id}`
    — corrects the editable fields, `FastAPI`-validates the body against
    `ReceiptUpdate` (auto-`422`), 404 if the receipt doesn't exist (PUT
    never creates one), 200 with the same shape/types as GET,
    `POST /receipts/{receipt_id}/reset` — discards edits, restores
    `ai_result_json` into the displayed data (never touching
    `ai_result_json` itself), clears `edited`/`edited_at`; 400/404 the same
    way as the other id-taking routes, 500 generic on a repository failure,
    200 with the same shape as GET; idempotent (safe to call repeatedly or
    on a never-edited receipt); never calls `get_extractor` or touches the
    stored file. Already allowed by the existing CORS `allow_methods` list
    (`tests/test_reset_and_edited.py` has a preflight test for it anyway).
    `PUT /receipts/{receipt_id}/apartment` — moves a receipt to a different
    apartment: body validated against `ApartmentAssignment` (missing/null
    `apartment_id`, or any extra field -> FastAPI's own `422`); 400 for a
    non-UUID id; 404 if no `receipts` row exists (checked via `get_receipt`
    before the apartment is validated, same as the other id-taking routes);
    422 via `repository.get_apartment()` for an unknown or inactive
    apartment (same messages as upload's check); 500 generic on a
    repository failure; 200 with the same shape as GET (including
    `warnings`). Calls `repository.set_receipt_apartment(...)`, never
    `update_receipt`/`reset_receipt` — so `edited_at`, `extracted_json`,
    `ai_result_json` and `created_at` are always left untouched. A later
    re-extract keeps this apartment, since `extract_receipt`'s own
    `ON CONFLICT` branch never overwrites `apartment_id`. (A
    `PUT /receipts/{receipt_id}/category` endpoint existed here too, until
    the expense-category feature was removed — see
    [docs/adr/0004-remove-categories.md](docs/adr/0004-remove-categories.md);
    the path now simply 404s.)
    `PUT /receipts/{receipt_id}/status` — body validated against
    `StatusAssignment` (FastAPI's own `422` for a missing/invalid/extra
    field); 400 non-UUID id; 404 if no `receipts` row exists. Setting
    `ReceiptStatus.NEEDS_REVIEW` is always allowed; setting
    `ReceiptStatus.APPROVED` first calls `_missing_approval_fields(saved)`
    — a pure helper checking, in this fixed order, `apartment_id is None`,
    `normalize_purchase_date(purchase_date) is
    None` (the same shared date rule `domain.rules` uses elsewhere — never
    a bare `date.fromisoformat`, so a stray-but-recoverable date like
    `"2025-06-26 11"` still counts as valid), and `total is None` — and if
    that list is non-empty, `422`s with
    `{"detail": {"message": "...", "missing": [...]}}` listing only the
    actually-missing ones, never all three unconditionally (a category
    check used to be part of this list too — see
    [docs/adr/0004-remove-categories.md](docs/adr/0004-remove-categories.md)).
    Data-quality
    `warnings` are deliberately never checked here — approval is a human
    decision, not a data-quality gate. 500 generic on a repository
    failure; 200 with the same shape as GET either way. Calls
    `repository.set_receipt_status(...)`, never `update_receipt`/
    `reset_receipt`/`set_receipt_apartment` — so
    `edited_at`, `extracted_json`, `ai_result_json`, `created_at` and
    `apartment_id` are always left untouched.
    **Editing an approved receipt:** `PUT /receipts/{id}` (the
    data-correction endpoint) never reads or changes `status` — an
    already-approved receipt silently stays `approved` after a
    correction; `tests/test_status_endpoints.py`'s
    `test_editing_an_approved_receipt_keeps_it_approved` documents this
    rather than adding a gate, per the ticket that introduced it.
    `DELETE /receipts/{receipt_id}` — 204 (empty body) on success, 400 for
    a non-UUID id, 404 if no `receipts` row exists (unknown id, or
    uploaded-but-never-extracted — nothing touched on disk or in the DB);
    order of operations is confirm-exists -> remove file -> remove DB
    rows, so a failure partway through always leaves a state a retry can
    finish (an already-gone file is a no-op, not an error).
    **`warnings`:** extract, GET and PUT (and the reset endpoint, below)
    all merge `"warnings": [w.model_dump() for w in check_receipt(data,
    date.today())]` into their response dict via the shared
    `_warnings_payload()` helper — computed fresh on every request, never
    stored, never blocking any action. The extract/GET/PUT contract test
    (`tests/test_get_receipt.py`'s `EXTRACTED_FIELD_NAMES`) includes
    `"warnings"` and `"status"`.
    `extract_receipt`'s response includes
    `status` the same way it does `apartment_id`/`apartment_name` — read
    from the `get_receipt()` re-fetch right after saving, falling back to
    `ReceiptStatus.NEEDS_REVIEW` if that re-fetch somehow returns
    nothing.
    `GET /receipts/{receipt_id}/file` — serves the original upload via
    `FileResponse` for a saved receipt (same existence check as GET); 400
    for a non-UUID id, 404 if no saved receipt exists or the file is
    missing from disk (logged server-side with the receipt_id only).
    `Content-Type` always comes from `domain.rules.media_type_for_extension`
    on the *stored* file's extension — never the client-supplied
    `content_type` and never sniffed — plus `X-Content-Type-Options:
    nosniff`, `Content-Disposition: inline` (no filename, ever) and
    `Cache-Control: private, no-cache`. No `X-Frame-Options` is set, since
    the frontend may show a PDF in a same-origin iframe. **No
    authentication**, same as every other endpoint here: anyone who can
    reach the server and knows a receipt id can fetch its file.
    `GET /receipts/{receipt_id}/archive.pdf`
    (`adapters/pdf_archive.py`, `domain.rules.archive_filename`) —
    downloads a saved receipt as a single-page PDF, for uniform documents
    regardless of the original format; same 400/404 checks as the plain
    file endpoint above (UUID, saved receipt exists, file exists on disk).
    Defined with plain `def` (not `async def`) specifically so FastAPI
    runs Pillow's conversion in its threadpool, never blocking the event
    loop; nothing here is ever written to disk or the database — the
    original is only ever read, never modified (`test_receipt_archive.py`
    hashes the stored file before/after the call to prove this).
    `make_archive_pdf(path)`: a `.pdf` original is returned byte-for-byte
    via `path.read_bytes()`, no re-encoding at all; a `.jpg`/`.jpeg`/
    `.png` is opened with `PIL.Image.open()` (which only reads header
    metadata, not pixel data), and its `width * height` is checked against
    `MAX_PIXELS` (`60_000_000`) **before** anything calls `.load()`/
    `.convert()`/`.resize()` — so a small file crafted to decode into a
    huge image (a decompression bomb) is rejected cheaply, never
    decoded. `prepare_image(img)`: `ImageOps.exif_transpose()` first (so a
    sideways phone photo's orientation tag — e.g. tag 6 — rotates the
    pixels and correctly swaps width/height, rather than leaving the
    image sideways), then any `RGBA`/`LA`/transparent-`P`-mode image is
    flattened onto a plain white background and converted to `RGB`
    (non-transparent images are just `.convert("RGB")`'d directly), then
    downscaled — **never upscaled** — via `Image.LANCZOS` only if the
    long edge exceeds `MAX_LONG_EDGE` (`3000`), aspect ratio preserved.
    The PDF itself is `prepared.save(buffer, format="PDF")` with no
    extra arguments, so Pillow sizes the page to the image itself (no
    forced A4) and copies no EXIF/metadata from the original into the
    output. Any failure (corrupt/truncated image, oversized image, I/O
    error) raises `ArchiveError` (chaining the real cause via `from exc`
    for the server log), which the route maps to `422` with the fixed,
    generic message `"This file could not be converted to PDF."` — the
    real exception is logged via `logger.exception(...)`, identified by
    receipt_id only, exactly like the extract/save/update/delete failure
    paths elsewhere in this file. `domain.rules.archive_filename(...)`
    builds the `Content-Disposition` filename: every part (apartment id,
    date, store name, amount+currency) is independently slugified —
    lowercased, transliterated to ASCII (`"ß"` → `"ss"`, accents stripped
    via NFKD), everything outside `a-z`/`0-9`/`.`/`-` collapsed to a
    single `-` — so a hostile store name (CRLF/header-injection attempts,
    path traversal, quotes, non-ASCII) can never produce an unsafe
    filename; a missing/invalid part becomes a fixed placeholder
    (`"no-apartment"`/`"undated"`/`"unknown-store"`/`"no-total"`) rather
    than being silently dropped. `purchase_date` is only used if
    `date.fromisoformat()` accepts it (never guessed); `total` is
    formatted via `Decimal(str(total))` with exactly 2 decimals — never
    float arithmetic. The store-name part is capped at 40 chars, the
    whole filename (incl. `.pdf`) at 120. **`PIL` is used only in
    `adapters/`** — `domain/rules.py`'s `archive_filename` never imports
    it, and `PIL` was added to `domain`'s forbidden-modules list in
    `.importlinter` alongside `fastapi`/`openai`/`sqlite3` (confirmed
    still `KEPT` by `lint-imports`). **Pillow is a new dependency**
    (`requirements.txt`, pinned to the latest stable release at the time
    it was added) — `make_archive_pdf` is written generically enough
    (any file in → PDF bytes out, for one receipt) to be reused later for
    a batch/ZIP export, without changes;
    the `get_extractor` and `get_repository` dependencies; server-side
    logging of extraction, save, update, and delete failures; maps domain
    exceptions to HTTP status codes: 400/413 from upload rules, 502 from
    `ExtractionError`, 503 from `ExtractionUnavailableError` or when
    `OPENAI_API_KEY` is not configured, 500 generic on a repository
    save/update/delete or file-removal failure — raw error text is never
    returned to the client).
    **Apartment on extract:** before saving, `extract_receipt` reads
    `repository.get_upload(receipt_id).apartment_id` (`None` if no uploads
    row) and passes it to `save_receipt(...)` — that call's own `INSERT`
    sets it on a first save, while its `ON CONFLICT` branch *omits*
    `apartment_id` from the `SET` clause entirely, so a re-extract leaves
    whatever is already stored untouched rather than overwriting it with
    `None`. The response's `apartment_id`/`apartment_name` come from a
    `get_receipt()` re-fetch right after saving (reusing its join, rather
    than duplicating the lookup) so they always reflect the receipt's true
    stored apartment, not just the upload's.
    A custom `RequestValidationError` handler in `app.py` stringifies any
    non-finite float (`NaN`/`Infinity`) echoed back in a `422` error's
    `"input"` field — otherwise Starlette's own JSON encoder crashes
    trying to serialize the error response itself, since stdlib `json`
    accepts `NaN` as *input* but refuses to emit it as *output*.
  - `main.py` stays a thin entry point (`from api.app import app`) so
    `uvicorn main:app --reload --port 8001` keeps working.
  - `config.py` stays at the backend root; reads `backend/.env`
    (`backend/.env.example`, the former gitignored). CORS allowed origins
    come from `CORS_ORIGINS` (default `http://localhost:5173`).
    `OPENAI_API_KEY` is normalized to `None` ("not configured") when
    missing, empty, or equal to the `.env.example` placeholder
    (`your-key-here`) — so a forgotten placeholder key behaves exactly
    like a missing one (503, no provider call) instead of reaching OpenAI.
    `DATABASE_PATH` (default `data/receipts.db`) configures the SQLite
    file; a relative value is resolved against `backend/` (the folder
    containing `config.py`), not the current working directory, so
    starting `uvicorn` from elsewhere (e.g. `--app-dir backend` from the
    repo root) never creates a second, empty database — an absolute value
    is used as given. `backend/data/` and `*.db` are gitignored.
  - Dependency direction: `api` -> `adapters` -> `domain`, and `api` ->
    `domain` directly. Enforced by import-linter (`backend/.importlinter`).
  - `scripts/` — operational tooling, deliberately outside the
    domain/adapters/api layers (not covered by `.importlinter`, and must
    never be imported by any of those three): `_common.py` (shared
    constants/hashing: `MANIFEST_FILENAME`, `DB_ARCNAME`, `UPLOADS_PREFIX`,
    `BACKUP_GLOB_PATTERN`, `sha256_file`/`sha256_bytes`), `backup.py`
    (`python scripts/backup.py [--out DIR] [--keep N]` — copies the
    database via `sqlite3.Connection.backup`, not a plain file copy, so the
    copy is consistent even while the server is running; runs
    `PRAGMA integrity_check` on the copy before zipping anything and aborts
    with no zip left behind if it isn't `"ok"`; zips `receipts.db`, every
    `backend/uploads/` file except `.gitkeep`, and a `manifest.json` of row
    counts + a SHA-256 per file; writes to a `.partial` name and
    `os.replace`s it into place only once complete; re-opens and verifies
    the finished zip against its own manifest; `--keep N`, default 30,
    deletes only the oldest files matching `receipts-backup-*.zip` in the
    output directory. Pure backup/verify logic (`run_backup`) takes
    explicit `database_path`/`uploads_dir` arguments and never imports
    `config`/`adapters` itself — only the CLI's `main()` does, lazily, so
    the logic stays trivially testable against temp paths. Never reads or
    copies `backend/.env`), `restore.py`
    (`python scripts/restore.py ZIPFILE --target DIR [--force]` — restores
    into a plain data folder, **never the live data directly**; every zip
    member is read into memory and fully validated — manifest present,
    every path safe (no absolute path, no `..`, zip-slip protected), every
    file's SHA-256 matching the manifest, the restored database passing
    `PRAGMA integrity_check` with row counts matching the manifest — before
    anything is written to `--target`, so a rejected zip leaves the target
    untouched; refuses a `--target` that already has data unless `--force`,
    which moves the existing `receipts.db`/`uploads/` into
    `<target>/pre-restore-<timestamp>/` first instead of deleting them).
  - **Note:** calling the extract endpoint sends the receipt file to
    OpenAI; the resulting receipt data is then stored locally in SQLite
    (the file itself stays in `backend/uploads/`, never in the database).
    **Delete only removes local state** (the database record and the
    local file) — it cannot and does not delete the copy OpenAI already
    received when the receipt was extracted.

