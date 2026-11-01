# Smart-Receipt-AI
a web application that helps users organize shopping receipts and understand their spending without manually entering information.

## User Problem
Users currently have to manually enter receipt details (store, date, items,
prices, tax, total) after every purchase, which is time-consuming and
error-prone.

## MVP
A user can upload one shopping receipt (image or PDF), the system uses AI
to extract the important purchase information, and displays the result
clearly for review.

## Project Structure

```
Smart-Receipt-AI/
├── frontend/   # React + TypeScript (Vite)
└── backend/    # FastAPI
```

## Setup

### Frontend

```bash
cd frontend
npm install
cp .env.example .env   # sets VITE_API_URL=http://localhost:8001
npm run dev
```

Runs at http://localhost:5173. The frontend reads the backend's URL from
`VITE_API_URL` (see `.env.example`); `.env` is gitignored and not committed.

Above the dropzone, the upload screen asks "Which apartment is this receipt
for?" as a set of selectable cards (nothing preselected) fetched from
`GET /apartments`; while that loads it shows "Loading apartments...", and if
it fails, an error with a "Retry" button (uploading is impossible either way
until an apartment can be chosen). "Read receipt" stays disabled until both
a valid file **and** an apartment are chosen — with only a file selected, a
muted "Choose an apartment to continue." hint appears. The choice is kept in
memory for the session: it survives "Remove", picking a different file, and
"Upload another receipt", so uploading several receipts for the same
apartment in one sitting only requires choosing it once.

The upload screen is a dropzone: click it, press Enter/Space, or drag a
receipt onto it to choose a file; dropping more than one file at once shows
an error asking for one receipt at a time. On small screens, a "Take photo"
button opens the device camera directly. The selected file is shown with its
name and size and a "Remove" button. See
[docs/design.md](docs/design.md) for the design system (tokens, shared
components, accessibility rules) used throughout the UI.

After a receipt is uploaded and extracted, the address bar is updated to
`?receipt=<id>` (via `history.replaceState`, no page reload). Reloading the
page or opening that link again fetches the already-saved result from
`GET /receipts/{id}` and displays it directly — it does **not** call the AI
again.

Navigation is URL-based, with no router library:
- No parameter — the upload view (default).
- `?view=history` — the receipt history list (newest first), split by
  apartment with filters. A tab bar shows "All apartments (N)" plus one
  tab per apartment with its own count; arrow keys/Home/End move between
  tabs. Below it, three dropdowns filter by Year (plus "No valid date"
  when some receipt has no usable date), Status (Needs review/Approved),
  and Category (plus "No category"); a "Clear filters" button appears
  once any of those three is set and resets them without changing the
  selected apartment tab. All of this lives in the URL
  (`?view=history&apartment=<id>&year=<v>&status=<v>&category=<v>`), so
  Back/Forward and reload all work, and an unrecognized value in the URL
  is simply ignored rather than breaking the page. Inside one apartment's
  tab, that row's own apartment badge is hidden (redundant with the tab);
  in "All apartments" it's shown, same as the category and status badges.
  A filtered search with no matches shows "No receipts match these
  filters." instead of the plain empty state, which only appears with no
  filters at all. Clicking a row navigates to `?receipt=<id>` and shows
  the same detail view as above (also without calling the AI); a "Back to
  history" link returns to the same tab and filters you came from.
  Browser back/forward works for all of these.

On any saved-receipt view (both right after extraction and when reopening
`?receipt=<id>`), an "Apartment" card above the receipt data shows the same
selectable-cards control as the upload form, with the receipt's current
apartment already selected. Choosing another one saves it immediately
(`PUT /receipts/{id}/apartment`): the control shows "Saving..." while that's
in flight, "Saved" once it succeeds, and on failure shows the error and puts
the previous selection back so you can try again. Hidden while the edit form
is open; this never touches the receipt's data itself (no extract call, no
plain `PUT /receipts/{id}`).

Next to it, a "Category" dropdown (placeholder "Choose a category") works
the same way, saving immediately via `PUT /receipts/{id}/category`. A
"Status" badge shows "Needs review" or "Approved"; a "Mark as approved"
button (or, once approved, "Back to needs review") sends
`PUT /receipts/{id}/status`. Approving requires an apartment, a category, a
valid purchase date and a total — if any are missing, an error explains
exactly what's left in plain words (e.g. "To approve this receipt, also
set: apartment, category.") and the status doesn't change; a missing date
also points you to the Edit button. Data-quality warnings never block
approval — that decision is yours. Both controls are hidden while the edit
form is open and never touch the extract endpoint or the plain
`PUT /receipts/{id}`.

On any saved-receipt view, an "Edit" button opens a form (prefilled from the
current data) for correcting store name, date, currency, items, discounts,
taxes and total. **Save** sends a `PUT` with only those fields and shows the
updated data directly from the response (no extra `GET`); **Cancel**
discards the changes and sends no request. Empty fields are saved as
`null`; non-numeric amounts are caught client-side before any request is
sent, and the server's validation messages are shown for anything it
rejects. If the stored date isn't a valid ISO date but starts with one
(e.g. `"2025-06-26 11"`), the date field is prefilled with just that
leading date instead — never the raw text, which the server would reject;
only a date with no leading ISO date at all keeps the plain text field and
an "Original: ..." hint. Editing and saving never call
the extract endpoint — no AI call, no cost.

If a receipt has data-quality warnings (see the API section below), a
panel titled "Check these values" lists them above the data, and a small
"Edited" badge appears next to the store name whenever the receipt has
unsaved-to-AI edits (its timestamp is in the badge's `title`). A secondary
"Reset to AI result" button then appears next to Delete; it shows an
in-page confirmation ("Replace your edits with the original AI result?
This cannot be undone.") before sending anything, and the restored data
replaces the view directly from the response.

Next to the extracted data (both right after extraction and when reopening
a saved receipt), the original uploaded file is shown via
`GET /receipts/{id}/file` — a zoomable image viewer (50%–300%, with a
"Fit" button) or, for a PDF, an embedded viewer — plus an "Open original"
link. From the `lg` breakpoint up this is a two-column layout (file on the
left, data on the right); below that, "Receipt data" and "Original" tabs
switch between them without losing anything typed into the edit form,
since both stay mounted. The edit form shows the same layout, so the
original can be checked while correcting a value.

A "Delete" button sits next to "Edit" on any saved-receipt view (hidden
while the edit form is open) and requires confirmation via an in-page
prompt — not `window.confirm` — before sending anything. On success, it
navigates to `?view=history` with a fresh list and a "Receipt deleted."
notice; if the receipt was already gone (`404`), it navigates there with
"This receipt no longer exists." instead. A network failure or server
error keeps you on the receipt with the error shown, so you can try again.
**Privacy note:** delete only removes the local database record and the
local file — the receipt image/PDF was already sent to OpenAI for
extraction, and this app has no way to delete that copy.

### Backend

```bash
cd backend
python3 -m venv venv
source venv/bin/activate   # Windows: venv\Scripts\activate
pip install -r requirements.txt
cp -n .env.example .env   # add your OPENAI_API_KEY (-n: never overwrite an existing .env)
uvicorn main:app --reload --port 8001
```

Runs at http://localhost:8001 — check http://localhost:8001/health

The backend allows cross-origin requests from the frontend dev server via
the `CORS_ORIGINS` environment variable (defaults to
`http://localhost:5173`).

Extracted receipts are persisted locally in a SQLite database. The file path
comes from `DATABASE_PATH` (default `data/receipts.db`, created
automatically); `backend/data/` and `*.db` files are gitignored. A relative
`DATABASE_PATH` is always resolved against the `backend/` folder itself, not
the current working directory — so running `uvicorn` from elsewhere (e.g.
`uvicorn --app-dir backend main:app` from the repo root) still uses the same
database instead of silently creating a second, empty one. An absolute
`DATABASE_PATH` is used exactly as given.
**Note:** receipt data itself is stored locally, but the receipt image/PDF
is still sent to OpenAI for extraction.

Schema changes use a small, additive migration (no migration framework): on
construction, the repository checks `PRAGMA table_info(receipts)` and runs
`ALTER TABLE ... ADD COLUMN` only for a column that's missing, never
dropping or recreating a table — so upgrading never loses existing rows.

### Backups

Receipts live only on this machine (the SQLite database plus the original
files in `backend/uploads/`) and are tax records, so losing the laptop
without a backup means losing them.

```bash
cd backend && source venv/bin/activate
python scripts/backup.py [--out DIR] [--keep N]
```

- Output directory: `--out`, else the `BACKUP_DIR` environment variable,
  else `backups/` at the repo root (created automatically; gitignored).
- The database is copied with SQLite's online backup API (not a plain file
  copy), so the backup is safe to run while the server is still running.
  The copy is verified with `PRAGMA integrity_check` before anything is
  zipped; on failure the command exits non-zero and leaves no zip behind.
- The zip (`receipts-backup-<timestamp>.zip`) contains `receipts.db`, every
  file from `backend/uploads/` (`.gitkeep` excluded), and a `manifest.json`
  with row counts and a SHA-256 hash of every file — **`backend/.env` (and
  therefore the OpenAI API key) is never included.** The finished zip is
  re-opened and checked against its own manifest before the command
  reports success.
- `--keep N` (default 30) deletes only the oldest files matching
  `receipts-backup-*.zip` in the output directory, keeping the `N` most
  recent; nothing else in that folder is touched.
- The command prints where the zip went and reminds you to copy it
  somewhere else — a backup that only exists on the same laptop isn't a
  backup.

To restore a backup:

```bash
cd backend && source venv/bin/activate
python scripts/restore.py backups/receipts-backup-<timestamp>.zip --target /path/to/restored-data [--force]
```

- Restores into `--target` (a plain data folder: `receipts.db` plus
  `uploads/`), **never into the live `backend/data/`/`backend/uploads/`
  directly** — point `DATABASE_PATH` and the uploads location at the
  restored copy afterwards, or copy the restored files over yourself once
  the server is stopped.
- Refuses a `--target` that already has a `receipts.db` or upload files
  unless `--force` is given; with `--force` the existing data is moved
  aside into `<target>/pre-restore-<timestamp>/` first, never deleted.
- Every member of the zip is validated before anything is written: path
  safety (no absolute paths, no `..`, nothing outside `--target`), a
  `manifest.json` must be present, every file's hash must match the
  manifest, and the restored database must pass `PRAGMA integrity_check`
  with row counts matching the manifest. A zip that fails any of these
  checks is rejected and nothing is written.

**Keeping backups safe (the 3-2-1 idea):** keep a copy on this laptop, a
copy on an external drive, and a copy in the cloud or at a second
location — then actually try a restore at least once so you know it
works, not just that the command exits `0`. Backup zips contain personal
receipt data and are **not encrypted**, so store them somewhere private
(or encrypt the drive/location they live on). Original receipt files may
need to be kept for a legally required retention period — ask a tax
advisor how long applies.

Example crontab line for a daily backup at 2am (documentation only — this
project does not install any cron job or systemd unit):

```cron
0 2 * * * cd /path/to/Smart-Receipt-AI/backend && venv/bin/python scripts/backup.py --out /path/to/external-drive/receipt-backups
```

### Endpoints

- `GET /health` — liveness check.
- `GET /apartments` — the two seeded holiday apartments, as
  `{"items": [{"id", "name"}], "count": n}`, only the active ones, in
  `sort_order`.
- `POST /receipts/upload` — accepts one JPG/PNG/PDF receipt file plus a
  **required** `apartment_id` form field, stores the file,
  records it in the database, and returns a `receipt_id` along with
  `apartment_id`/`apartment_name`. The apartment is validated *before*
  anything is written to disk or the database: a missing `apartment_id`
  is `422` (FastAPI's own required-field validation); an unknown or
  inactive one is `422` with a clear message, and leaves no file and no
  database row behind. Existing file-validation errors (unsupported
  type, empty file, oversized file) keep their order and status codes.
- `POST /receipts/{receipt_id}/extract` — sends the stored receipt to the
  OpenAI API, returns structured purchase data (store, date, items,
  discounts, taxes, total), and saves the result (re-extracting the same
  receipt overwrites the saved result). **Note:** uploaded receipts are sent
  to OpenAI for processing when this endpoint is called. **Date
  normalization:** a `purchase_date` the AI prints with a stray time suffix
  (e.g. `"2025-06-26 11"` or `"2025-06-26T11:04:00"`) is normalized to the
  plain ISO date (`"2025-06-26"`) before saving; a date that doesn't start
  with a valid ISO date (e.g. `"26/06/2025"`, free text — day/month order is
  never guessed) is kept exactly as the AI returned it, so it can be seen
  and corrected, and is flagged by a `DATE_NOT_STANDARD` warning (below).
  The original AI output in `ai_result_json` always keeps the raw,
  unnormalized value. Error responses:
  - `503` — the AI *service* isn't usable right now: `OPENAI_API_KEY` is
    missing, empty, or still the `.env.example` placeholder
    (`your-key-here`) — none of these ever reach the provider — or the
    provider itself rejected the request for a reason unrelated to the
    receipt (bad/invalid key, no credit, unknown model, rate limited).
  - `502` — the receipt itself could not be read (unparseable image/PDF,
    provider timeout, or any other extraction failure).

  Both keep the existing behavior of logging the real cause server-side
  (exception type, message, receipt_id, file info, elapsed time) while
  never including provider error text, the key, or file contents in the
  response or the log; nothing is saved to the database on either failure.
  The response also carries a **`warnings`** array (see below), and
  `GET`/`PUT` share the same fields and types with this response.
  **Apartment:** the first save copies the apartment chosen at upload onto
  the receipt; re-extracting (Retry) keeps whatever apartment is already
  stored, never overwriting it with `null`.
- `GET /receipts/{receipt_id}` — returns the saved receipt (same fields as
  the extract response, plus `original_filename`, `content_type`,
  `created_at`, `updated_at`). Unknown or not-yet-extracted receipts
  return `404`. A row saved before date normalization existed, whose
  `purchase_date` isn't a plain ISO date but starts with one, is normalized
  for display here (the stored row itself is never rewritten — no
  migration of existing data).

#### Apartments

Every receipt-shaped response — `upload`, `extract`, `GET` one, `PUT`,
`POST .../reset`, and each item of the `GET /receipts` list — carries flat
**`apartment_id`** and **`apartment_name`** fields (both `string` or
`null`), with the same key set and JSON types everywhere. A receipt
belongs to at most one apartment, chosen at upload (required, see above).
Changing it is a classification change, not a data edit: it never sets
`edited_at` and never touches `extracted_json`, `ai_result_json`, or
`created_at`. `PUT /receipts/{id}` and the reset endpoint never change it;
it is changed only via `PUT /receipts/{receipt_id}/apartment` — see below.

#### Categories and review status

- `GET /categories` — the ten seeded expense categories, as
  `{"items": [{"id", "name"}], "count": n}`, only the active ones, in
  `sort_order`. The seeded names are **placeholders** and must be
  confirmed with a tax advisor before being relied on for an actual
  filing.

Every receipt-shaped response also carries flat **`category_id`**,
**`category_name`** (both `string` or `null`) and **`status`**
(`"needs_review"` or `"approved"`, default `"needs_review"`), with the
same key set and JSON types everywhere. A receipt belongs to at most one
category. Changing the category or the status is a classification
change, not a data edit: it never sets `edited_at` and never touches
`extracted_json`, `ai_result_json`, or `created_at`. `PUT /receipts/{id}`
and the reset endpoint never change category, status or apartment.
Re-extracting a receipt (Retry) keeps its category and apartment, but
resets `status` back to `"needs_review"`, since the underlying data was
just replaced.

The category and status are changed through their own endpoints, never
through `PUT /receipts/{id}` (the data-correction endpoint) or the reset
endpoint:

- `PUT /receipts/{receipt_id}/category`, body `{"category_id": "<id>"}`
  (strict — any other field is rejected). `400` for a non-UUID id, `404`
  if the receipt doesn't exist or was never extracted, `422` for a
  missing, null, unknown, or inactive category.
- `PUT /receipts/{receipt_id}/status`, body `{"status": "needs_review"
  | "approved"}` (strict). Same `400`/`404` rules for the id; `422` for a
  missing or invalid status value. Setting `"needs_review"` is always
  allowed. Setting `"approved"` requires **all** of: an apartment, a
  category, a valid ISO purchase date, and a total — if any are missing,
  the response is `422` with
  `{"detail": {"message": "...", "missing": [...]}}`, listing only what's
  actually missing (in the fixed order `apartment`, `category`, `date`,
  `total`). **Data-quality warnings never block approval** — the user
  decides whether to approve despite them.

Both endpoints return the same shape as `GET`, and a `500` with a generic
message if the database update itself fails. Editing a receipt's data
(`PUT /receipts/{id}`) never changes its status — an already-approved
receipt stays approved even after a correction, silently; there is no
extra confirmation step for this in the API.

#### Data-quality warnings

Every response that carries receipt data (`extract`, `GET`, `PUT`, and
`POST .../reset`) includes a **`warnings`** array, computed fresh on every
request — never stored, and never blocking any action. Each entry is
`{code, field, message, details}`, where `details` holds decimal amount
strings (never floats). Codes:

- `MISSING_STORE` — the store name is null or blank.
- `MISSING_DATE` — the purchase date is null.
- `DATE_NOT_STANDARD` — the purchase date isn't a valid ISO date (and
  doesn't start with one either, so it couldn't be normalized).
- `FUTURE_DATE` — a valid date more than one day in the future (the extra
  day allows for time zone differences).
- `MISSING_TOTAL` — the total is null.
- `TOTAL_MISMATCH` — only checked when every item has a usable amount
  (its own `line_total`, or `quantity × unit_price` as a fallback) and the
  total isn't null. The receipt is considered consistent if the total
  matches *either* `(items − |discounts|) + taxes` (tax added on top) *or*
  `items − |discounts|` (prices already include tax), each within `0.05`;
  a warning is raised only when neither matches. If any item has no usable
  amount at all, this check is skipped entirely (nothing to compare).
- `LINE_MISMATCH` — an item where `quantity`, `unit_price` and
  `line_total` are all present but `quantity × unit_price` differs from
  `line_total` by more than `0.05`; `details.index` names the item.

All amount math uses `Decimal(str(value))`, never raw floats.
- `GET /receipts/{receipt_id}/file` — serves the original uploaded file
  (image or PDF) for a saved receipt, so it can be shown next to the
  extracted data. `400` for a non-UUID id; `404` if no saved receipt exists
  for that id (unknown id, uploaded-but-never-extracted, or already
  deleted), or if the file is missing from disk. The response's
  `Content-Type` is always derived from the stored file's extension
  (`.jpg`/`.jpeg` → `image/jpeg`, `.png` → `image/png`, `.pdf` →
  `application/pdf`) — **never** the content type the client sent at
  upload time and never sniffed from the file's contents, since either
  could be spoofed. Also sets `X-Content-Type-Options: nosniff`,
  `Content-Disposition: inline` (the original filename is never included in
  any response header), and `Cache-Control: private, no-cache`.
  **Note:** like the other endpoints, this one has no authentication yet —
  anyone who can reach the server and knows a receipt's id can fetch its
  original file.
- `GET /receipts/{receipt_id}/archive.pdf` — downloads a saved receipt as a
  single-page PDF, for uniform documents regardless of whether the
  original was a phone photo or already a PDF. Same existence/lookup
  checks as the plain file endpoint (`400` non-UUID, `404` unknown/
  never-extracted/deleted/missing-from-disk). A `.pdf` original is
  returned completely unchanged; a `.jpg`/`.jpeg`/`.png` is converted with
  [Pillow](https://pillow.readthedocs.io/): EXIF orientation is applied,
  any transparency is flattened onto white, the image is converted to
  RGB, and it's downscaled (never upscaled) if its long edge exceeds 3000
  pixels — the PDF page is sized to the image itself, never forced to a
  fixed page size like A4, and no EXIF or other metadata from the
  original is copied into it. An image reporting more than 60,000,000
  pixels is rejected *before* any pixel data is decoded (`422`, generic
  message, real cause logged server-side with only the receipt id —
  never the client's). **The original file on disk is never modified or
  replaced** — this only ever reads it and returns new PDF bytes.
  Response headers: `Content-Type: application/pdf`,
  `Content-Disposition: attachment; filename="<generated-name>.pdf"` (an
  ASCII-only, safe filename built from the apartment/date/store/total —
  never the client's original filename), `X-Content-Type-Options:
  nosniff`, `Cache-Control: private, no-cache`. Runs as a sync endpoint so
  the conversion happens in FastAPI's threadpool, not on the event loop.
- `GET /receipts?limit=N` — lists saved receipts newest first, as
  `{"items": [{receipt_id, original_filename, store_name, purchase_date,
  currency, total, created_at, apartment_id, apartment_name, category_id,
  category_name, status}, ...],
  "count": <number>}` (no items,
  discounts or taxes — use `GET /receipts/{id}` for the full detail).
  `limit` defaults to 50 (1–200); an out-of-range or non-integer value
  returns `422`. An empty database returns `{"items": [], "count": 0}`,
  never `404`. Optional filters, combined with AND, with no params meaning
  "everything" (unchanged):
  - `apartment_id` — a known apartment id, else `422`.
  - `year` — a 4-digit year (2000–2100), or `"none"` for receipts whose
    date is null or isn't a valid ISO date; a year matches only a
    receipt whose date normalizes to that exact year (so a raw,
    unparseable date like `"26/06/2025"` never matches `year=2025` — it
    only matches `year=none`); anything else is `422`.
  - `status` — `"needs_review"` or `"approved"`, else `422`.
  - `category_id` — a known category id, or `"none"` for receipts with no
    category, else `422`.
- `GET /receipts/facets?apartment_id=<optional>` — the counts behind the
  history view's apartment tabs and filter dropdowns:
  `{"apartments": [{"id", "name", "count"}, ...], "total": <number>,
  "years": [2026, 2025, ...], "has_undated": <bool>}`. Each apartment's
  `count` is always every receipt it has, regardless of `apartment_id`;
  `total` is always every receipt in the database. `years` (sorted newest
  first) and `has_undated` are scoped to `apartment_id` when it's given —
  an unknown `apartment_id` is `422`. Registered ahead of
  `GET /receipts/{receipt_id}` so the literal path `/receipts/facets`
  is never captured by that route's `{receipt_id}` segment.
- `GET /items` — a flat list of every purchased line item across receipts,
  for seeing what was bought and opening the original receipt:
  `{"items": [{receipt_id, line_index, name, quantity, unit_price,
  line_total, currency, purchase_date, store_name, apartment_id,
  apartment_name, category_name, status}, ...], "count": <returned>,
  "total": <all matching rows>}`. `purchase_date` is normalized for
  display exactly like `GET /receipts/{id}`. Ordered by the receipt's
  `created_at` (newest first), then by the item's original position in
  the receipt (`line_index`, stable). Accepts the exact same
  `apartment_id`/`year`/`status`/`category_id` filters as `GET /receipts`
  (same validation and `422` rules), plus:
  - `q` — a search trimmed of surrounding whitespace, at most 100
    characters (longer is `422`); a blank query (after trimming) is
    ignored, not an error. Split into words; **every** word must appear,
    case-insensitively, in the item's name or its receipt's store name —
    so a row with no item name can still match through the store name.
  - `limit` (default 100, 1–500) and `offset` (default 0, ≥ 0) — an
    out-of-range value is `422`.
  An empty result is `200` with `items: []`, `count: 0`, `total: 0`, never
  `404`. A receipt that was only uploaded, never extracted, contributes no
  rows, same as `GET /receipts`. **Implementation note:** filtering by
  apartment/year/status/category happens the same way `GET /receipts`
  does; flattening each matching receipt's items, the `q` search, and the
  `limit`/`offset` slice all then happen in Python, after fetching every
  matching receipt — fine at this app's scale (thousands of rows, not
  millions), but would need a dedicated indexed table if that ever
  stopped being true.
- `PUT /receipts/{receipt_id}` — corrects a saved receipt's editable fields
  (`store_name`, `purchase_date`, `currency`, `items`, `discounts`, `taxes`,
  `total`). Returns `200` with the same shape/types as `GET /receipts/{id}`.
  `400` for a non-UUID id; `404` for an unknown id or one that was uploaded
  but never extracted (PUT never creates a receipt); `422` for invalid
  input; `500` (generic, nothing partially saved) on a database failure.
  Validation rules: unknown extra fields are rejected; `purchase_date` must
  be `null` or a valid ISO date (`YYYY-MM-DD`); every amount/quantity must
  be a finite JSON number or `null` (no strings, `NaN`, or `Infinity`) —
  amounts may be negative (refunds/discounts), but `quantity`, when given,
  must be greater than `0`; item names and discount/tax descriptions must
  be non-empty; at most 200 items, 50 discounts, 50 taxes. **The original
  AI output (`ai_result_json`) is never modified by an edit** — only the
  displayed data changes. A successful PUT sets **`edited`** to `true` and
  **`edited_at`** to the current UTC time (re-extracting the same receipt,
  or resetting it, clears both back to `false`/`null`).
- `PUT /receipts/{receipt_id}/apartment` — moves a saved receipt to a
  different apartment: body `{"apartment_id": "<id>"}` (unknown extra
  fields rejected; a missing or `null` `apartment_id` is `422`). `400` for
  a non-UUID id; `404` for an unknown id or one that was uploaded but
  never extracted; `422` for an unknown or inactive apartment; `500`
  (generic) on a database failure. Returns `200` with the same shape as
  `GET` (including `warnings`). Updates `apartment_id`/`updated_at` on the
  receipt (and the matching `uploads` row, when one exists) in one
  transaction — this is a classification change, not an edit, so
  `edited_at`, `extracted_json`, `ai_result_json` and `created_at` are
  never touched. A later re-extract keeps this apartment, not the one the
  file was originally uploaded with.
- `POST /receipts/{receipt_id}/reset` — discards any edits and restores the
  receipt from `ai_result_json` (re-applying the same date normalization
  extraction does), in one transaction; `edited`/`edited_at` are cleared,
  `updated_at` refreshes, `created_at` is kept, and `ai_result_json` itself
  is never touched — so resetting twice, or resetting a receipt that was
  never edited, is perfectly safe. `400` for a non-UUID id; `404` for an
  unknown id or one that was uploaded but never extracted; `500` (generic)
  on a database failure. Returns `200` with the same shape as `GET`
  (including `warnings`). **Never calls the AI and never touches the
  stored file.**
- `DELETE /receipts/{receipt_id}` — removes the saved receipt's database
  record and its stored file. `204` (empty body) on success; `400` for a
  non-UUID id; `404` for an unknown id or one that was uploaded but never
  extracted (nothing on disk or in the database is touched in that case);
  `500` (generic message) if the file or database removal fails — safe to
  retry either way (an already-removed file is not an error, so retrying
  after a database-removal failure still completes with `204`). Order of
  operations: confirm the receipt exists, remove the file, then remove the
  database rows — so a failure after the file is gone never leaves an
  orphaned reference to it.
  **Privacy note:** this only removes the local database record and the
  local file. The receipt image/PDF was already sent to OpenAI for
  extraction, and this app has no way to delete that copy from OpenAI.
