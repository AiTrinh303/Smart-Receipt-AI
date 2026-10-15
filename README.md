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
rejects. If the stored date isn't a valid ISO date, the field shows an
"Original: ..." hint so it can be corrected. Editing and saving never call
the extract endpoint — no AI call, no cost.

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

### Endpoints

- `GET /health` — liveness check.
- `POST /receipts/upload` — accepts one JPG/PNG/PDF receipt file, stores it,
  records it in the database, and returns a `receipt_id`.
- `POST /receipts/{receipt_id}/extract` — sends the stored receipt to the
  OpenAI API, returns structured purchase data (store, date, items,
  discounts, taxes, total), and saves the result (re-extracting the same
  receipt overwrites the saved result). **Note:** uploaded receipts are sent
  to OpenAI for processing when this endpoint is called. Error responses:
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
- `GET /receipts/{receipt_id}` — returns the saved receipt (same fields as
  the extract response, plus `original_filename`, `content_type`,
  `created_at`, `updated_at`). Unknown or not-yet-extracted receipts
  return `404`.
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
  displayed data changes — so a future "reset to AI result" stays possible.
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
