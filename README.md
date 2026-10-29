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
- `?view=history` — the receipt history list (newest first). Clicking a row
  navigates to `?receipt=<id>` and shows the same detail view as above
  (also without calling the AI); a "Back to history" link returns to the
  list. Browser back/forward works for all of these.

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

### Endpoints

- `GET /health` — liveness check.
- `POST /receipts/upload` — accepts one JPG/PNG/PDF receipt file, stores it,
  records it in the database, and returns a `receipt_id`.
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
- `GET /receipts/{receipt_id}` — returns the saved receipt (same fields as
  the extract response, plus `original_filename`, `content_type`,
  `created_at`, `updated_at`). Unknown or not-yet-extracted receipts
  return `404`. A row saved before date normalization existed, whose
  `purchase_date` isn't a plain ISO date but starts with one, is normalized
  for display here (the stored row itself is never rewritten — no
  migration of existing data).

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
- `GET /receipts?limit=N` — lists saved receipts newest first, as
  `{"items": [{receipt_id, original_filename, store_name, purchase_date,
  currency, total, created_at}, ...], "count": <number>}` (no items,
  discounts or taxes — use `GET /receipts/{id}` for the full detail).
  `limit` defaults to 50 (1–200); an out-of-range or non-integer value
  returns `422`. An empty database returns `{"items": [], "count": 0}`,
  never `404`.
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
