# CLAUDE.md

Reference context for Claude Code working in this repository.

## Project overview

Smart Receipt AI is a web app that helps users organize shopping receipts and
understand their spending without manual data entry. Manually entering
receipt details (store, date, items, prices, tax, total) is time-consuming
and error-prone. MVP: a user uploads one receipt (image or PDF), AI extracts
the purchase info, and the result is displayed for review.

## Tech stack

- Frontend: Vite + React + TypeScript + Tailwind CSS
- Backend: FastAPI (Python)
- Testing: Jest + React Testing Library (frontend)

## Project structure

- `frontend/` — Vite + React + TypeScript app, styled with Tailwind CSS.
  Jest + React Testing Library config lives here (`jest.config.cjs`,
  `jest.esbuild-transform.cjs`, `tsconfig.jest.json`, `src/setupTests.ts`).
  **Design system:** semantic color/radius/shadow tokens live in
  `tailwind.config.js` (`theme.extend`) — components must use these tokens
  (e.g. `bg-brand`, `text-ink-muted`, `border-border`), never hardcoded hex
  colors; see [docs/design.md](docs/design.md) for the palette, contrast
  ratios, and when to use each shared component. Shared UI components live
  in `src/components/ui/` (`Button`, `Card`, `Alert`, `Spinner`, `Container`,
  `formatFileSize`) — reach for these instead of ad hoc markup. All
  interactive elements need a visible `focus-visible` ring and a minimum
  44px touch target on small screens; never convey state with color alone.
  User-visible strings and roles that existing tests assert on (e.g.
  "Uploading...", "Extracting receipt data...", "Receipt not found",
  "Upload another receipt", the 502/503 messages) must stay exactly as they
  are unless a task explicitly asks to change them.
  `src/api/` holds API call modules (`uploadReceipt.ts`, `extractReceipt.ts`,
  `getReceipt.ts`, `listReceipts.ts`, shared `ApiError`, shared response
  types in `types.ts` — including `ReceiptSummary`, the list-row shape); the
  backend URL is read from `VITE_API_URL` (`.env.example` / `.env`, the
  latter gitignored). `ReceiptUpload.tsx` uploads a file then automatically
  calls extract and renders `ReceiptResult.tsx` with the structured result.
  Dependency direction: UI components (`App.tsx`, `ReceiptUpload.tsx`,
  `ReceiptResult.tsx`, `ReceiptHistory.tsx`) -> `src/api/` ->
  `src/api/types.ts`. `src/api/` must never import a UI component —
  enforced by dependency-cruiser.
  **Reopening a saved receipt:** after a successful extraction,
  `ReceiptUpload.tsx` writes `?receipt=<id>` to the address bar via
  `window.history.replaceState` (no router library, no page reload, no new
  history entries). On load, if `?receipt=<uuid>` is present, it calls
  `getReceipt` (`GET /receipts/{id}`) instead of upload/extract and renders
  the same `ReceiptResult` — reloading the page or reopening the link never
  triggers a new AI call. An invalid (non-UUID) `receipt` value never
  reaches the server — it goes straight to "Receipt not found", the same
  message shown for a real `404`. "Upload another receipt" clears the
  `receipt` param along with all state.
  **Navigation (`App.tsx`, `src/navigation.ts`):** no router library — a
  tiny `navigateTo(search)` helper does `history.pushState` and dispatches a
  synthetic `popstate` event (since `pushState`/`replaceState` never fire
  one themselves); `App.tsx` listens for `popstate` (real browser
  back/forward and the synthetic ones) to decide, from the URL, which of
  `ReceiptHistory.tsx` (`?view=history`) or `ReceiptUpload.tsx` (otherwise —
  including `?receipt=<id>`) to render, keying each on the current
  `location.search` so external navigation remounts cleanly without
  disturbing `ReceiptUpload`'s own internal `replaceState` calls.
  `ReceiptHistory.tsx` lists saved receipts (store, date, total; "Not
  detected" for anything missing) and navigates to `?receipt=<id>` on row
  click; `ReceiptUpload.tsx` adds a "Back to history" link when showing a
  result.
  **Editing (`ReceiptEditForm.tsx`, `src/api/updateReceipt.ts`):** an
  "Edit" button in `ReceiptResult.tsx`'s own header (next to the store
  name, which is the page's `<h1>`) opens a form prefilled from the
  current data, with add/remove rows for
  items/discounts/taxes. **Save** sends `PUT /receipts/{id}` with *only*
  the editable fields (never `receipt_id`/`created_at`/
  `original_filename`/etc.) and updates the view straight from the
  response — no extra `GET`. Empty text/number inputs are sent as `null`;
  non-numeric amounts are caught client-side (inline error, no request
  sent) before anything reaches the server; a `422` is turned into
  readable per-field messages via `updateReceipt.ts`. **Cancel** discards
  all changes and sends no request. A stored `purchase_date` that isn't a
  valid ISO date renders as a plain text input (not `<input type="date">`,
  which would just show blank) with an "Original: ..." hint below it.
  Never calls the extract endpoint.
  **Original file viewer (`ReceiptFileViewer.tsx`, `src/api/receiptFileUrl.ts`,
  `ReceiptDetailLayout.tsx`):** `receiptFileUrl(id)` builds the
  `GET /receipts/{id}/file` URL (no `fetch` — an `<img src>`/`<iframe src>`
  loads it directly, so no CORS is needed). `ReceiptFileViewer` decides
  image vs. PDF from `contentType` first, then the filename extension,
  else defaults to image. Renders as a framed card: a header row with the
  (truncated, `title`-attributed) file name, icon zoom/fit controls for
  images (`aria-label`s "Zoom out"/"Zoom in"/"Fit", 50%–300%), and an
  "Open original" link-styled `<a>` (kept a real anchor, not the `Button`
  component, so it stays `role="link"` for `target="_blank"`); a body with
  a `slate-100` background (so a white receipt stands out) that is either
  the image/iframe or, on a failed image load, an `Alert` with "The
  original file is not available." instead of a broken image.
  `ReceiptDetailLayout` wraps the saved-receipt view (`ReceiptResult`) and
  the edit view (`ReceiptEditForm`) in a shared two-column layout
  (`lg:grid-cols-[5fr_6fr]`, file left/data right, file panel `sticky`
  with its own scroll area near viewport height) from the `lg` breakpoint
  up, inside the shell's wider `xl` `Container` size; below `lg` it
  renders a "Receipt data"/"Original" segmented control
  (`role="tablist"`/`role="tab"`, `aria-selected`) that toggles visibility
  with CSS only — both panels stay mounted, so typed edit-form input
  survives switching tabs. The extract response has no
  `original_filename`/`content_type` (only `GET /receipts/{id}` does), so
  right after extraction the viewer's filename falls back to the
  just-uploaded `File`/upload response and its content type is treated as
  unknown (extension-based detection). Every conditional class name here
  (and throughout the app) picks between complete static strings — never
  built by concatenating a variable into a class name — since Tailwind's
  JIT only generates CSS for literal class-name text it finds in the
  source.
  **Deleting (`src/api/deleteReceipt.ts`):** a `danger-ghost` "Delete"
  button, in the surrounding container below `ReceiptResult` (separated
  from it by a divider — destructive and comparatively rare, unlike Edit,
  which is primary and in the header), hidden while the edit form is open,
  opens an in-page confirmation styled as a danger `Alert` (not
  `window.confirm`) — no request until "Yes, delete".
  A `204` navigates to `?view=history&notice=deleted` (a one-shot URL
  param `ReceiptHistory.tsx` reads once on mount, displays as "Receipt
  deleted.", then immediately strips via `replaceState` so a reload never
  redisplays it); a `404` navigates there with `notice=gone` ->
  "This receipt no longer exists." instead. Network/5xx failures keep the
  receipt on screen with the error shown so the user can retry — nothing
  is navigated away on failure. `deleteReceipt` never parses a body on
  success (a `204` has none).
  **Mobile-friendly items (`useMediaQuery`, `ReceiptResult.tsx`):**
  `src/hooks/useMediaQuery.ts` wraps `window.matchMedia`, returns `false`
  when it doesn't exist (jsdom's default — existing tests need no mock),
  and updates live on change with listener cleanup. Below `sm`
  (`max-width: 639px`), `ReceiptResult` renders items as cards
  (name heading, a Qty/Unit price/Line total definition list, currency
  shown once in the labels) instead of the table — only one variant is
  ever in the DOM, never both hidden with CSS.
  **Image preview (`ReceiptUpload.tsx`):** a valid JPG/PNG gets a thumbnail
  via `URL.createObjectURL` in the selected-file row (PDFs keep the file
  icon). The previous object URL is always revoked before the next one
  is created or discarded — on Remove, on replacing the file, after
  "Upload another receipt", and on unmount (via a ref, so the cleanup
  sees the latest URL) — at most one live URL at a time. jsdom has
  neither `URL.createObjectURL` nor `URL.revokeObjectURL`;
  `src/test/objectUrl.ts` is an explicit per-file mock (not a global
  polyfill) used by every test that selects an image.
  **Skeleton loading states (`components/ui/Skeleton.tsx`):** every
  loading area (the history list, the saved-receipt view, next to the
  extraction status) is a `role="status" aria-busy="true"` region that
  keeps the exact original loading string in the DOM (visible or
  `sr-only`) next to `animate-pulse`/`motion-reduce:animate-none`
  skeleton blocks — the region (and `aria-busy`) disappears once loading
  ends.
  **Style guide (`StyleGuide.tsx`, `env.ts`, `?view=styleguide`):**
  dev-only page showing every `Button`/`Alert` variant, the nav tab's
  active/inactive states, the logo mark, the dropzone's
  idle/drag-over/file-selected states, a `Skeleton` sample, and the
  card-variant items list, with static sample data (no network
  calls) — open it after any visual change, since jsdom cannot see
  colors or layout. Gated on `env.ts`'s `isDev` (`import.meta.env.DEV`,
  isolated into its own module specifically so tests can
  `jest.doMock('./env', ...)` to flip it — `import.meta.env.DEV` itself is
  a compile-time constant, not something a single test run can toggle).
  Not linked from the header. `App.tsx`'s dynamic `import('./StyleGuide')`
  must use the literal `import.meta.env.DEV` (not `isDev`) specifically so
  Vite's dead-code elimination can drop it from a production build —
  confirmed by grepping `dist/assets/*.js` for "StyleGuide" after a build,
  not assumed.
- `backend/` — FastAPI app with a Python venv and
  `requirements.txt`/`requirements-dev.txt`, layered per
  [docs/adr/0001-layered-backend.md](docs/adr/0001-layered-backend.md):
  - `domain/` — `models.py` (`ReceiptData` and friends, plus `SavedUpload`,
    `SavedReceipt` and `ReceiptSummary` — the last a small list-row model:
    receipt_id, original_filename, store_name, purchase_date, currency,
    total, created_at — for persisted data), `rules.py` (allowed file
    types, size limit, and `media_type_for_extension()` — a pure
    extension -> fixed media type map used by the file-serving endpoint, so
    `Content-Type` is never taken from client input; raises domain
    exceptions, no HTTP/FastAPI/file I/O),
    `ports.py` (`ReceiptExtractor` Protocol + `ExtractionError` /
    `ExtractionUnavailableError`, `ReceiptRepository` Protocol —
    `save_upload`/`get_upload`/`save_receipt`/`get_receipt`/
    `list_receipts`/`update_receipt`, plus the strict, separate
    `ReceiptUpdate`/`LineItemUpdate`/`DiscountUpdate`/`TaxUpdate` models in
    `models.py` for user-submitted corrections — deliberately distinct from
    the lenient `ReceiptData` family used to parse AI output, which must
    stay lenient). `ExtractionError` means the receipt itself couldn't
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
    so the real cause is still logged), `file_storage.py` (saving/finding
    files in `uploads/` by UUID filename; `delete_file` looks up the file
    the same way `find_file` does — by the validated UUID, inside
    `UPLOAD_DIR` only, never a client-supplied path — and treats an
    already-missing file as a no-op, not an error, so a retry is safe),
    `sqlite_repository.py`
    (`SqliteReceiptRepository`: stdlib `sqlite3`, no ORM; `uploads` and
    `receipts` tables; schema created via `CREATE TABLE IF NOT EXISTS`).
    `list_receipts` orders by `created_at DESC, receipt_id ASC` (stable
    tie-break) and builds each row from `extracted_json` (same source as
    `get_receipt`, so `total`'s JSON type matches); a row with unparseable
    `extracted_json` is logged (receipt_id only) and skipped rather than
    failing the whole list. `update_receipt` replaces `extracted_json` and
    the four denormalized columns in one transaction, refreshes
    `updated_at`, and **never touches `ai_result_json` or `created_at`** —
    the original AI output stays byte-for-byte intact so a future "reset to
    AI result" stays possible; returns `None` (never creates a row) if the
    receipt doesn't exist. `delete_receipt` removes the row from both
    `receipts` and `uploads` in one transaction, returning whether a
    `receipts` row existed. Must never import `api`.
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
    `routes.py` (`/health`, `POST /receipts/upload`,
    `POST /receipts/{receipt_id}/extract`, `GET /receipts/{receipt_id}`,
    `GET /receipts?limit=N` — list, newest first, `limit` default 50
    (1–200, else `422`), `{"items": [...], "count": N}`, empty DB ->
    `{"items": [], "count": 0}` never `404`, `PUT /receipts/{receipt_id}`
    — corrects the editable fields, `FastAPI`-validates the body against
    `ReceiptUpdate` (auto-`422`), 404 if the receipt doesn't exist (PUT
    never creates one), 200 with the same shape/types as GET,
    `DELETE /receipts/{receipt_id}` — 204 (empty body) on success, 400 for
    a non-UUID id, 404 if no `receipts` row exists (unknown id, or
    uploaded-but-never-extracted — nothing touched on disk or in the DB);
    order of operations is confirm-exists -> remove file -> remove DB
    rows, so a failure partway through always leaves a state a retry can
    finish (an already-gone file is a no-op, not an error),
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
    reach the server and knows a receipt id can fetch its file;
    the `get_extractor` and `get_repository` dependencies; server-side
    logging of extraction, save, update, and delete failures; maps domain
    exceptions to HTTP status codes: 400/413 from upload rules, 502 from
    `ExtractionError`, 503 from `ExtractionUnavailableError` or when
    `OPENAI_API_KEY` is not configured, 500 generic on a repository
    save/update/delete or file-removal failure — raw error text is never
    returned to the client).
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
  - **Note:** calling the extract endpoint sends the receipt file to
    OpenAI; the resulting receipt data is then stored locally in SQLite
    (the file itself stays in `backend/uploads/`, never in the database).
    **Delete only removes local state** (the database record and the
    local file) — it cannot and does not delete the copy OpenAI already
    received when the receipt was extracted.

## Running locally

```bash
# Frontend dev server
cd frontend && npm run dev

# Backend dev server (runs on port 8001, matching frontend's VITE_API_URL)
cd backend && source venv/bin/activate && uvicorn main:app --reload --port 8001

# Frontend tests
cd frontend && npm test

# Backend tests
cd backend && source venv/bin/activate && pytest

# Backend boundary check (venv active)
cd backend && source venv/bin/activate && lint-imports

# Frontend boundary check
cd frontend && npm run check:deps
```

## Conventions

- Keep changes scoped to what's asked — don't add features, UI, or
  abstractions beyond the current task.
- `frontend/` and `backend/` changes should stay separate; only touch both
  when a task explicitly requires it.
- Do not commit automatically — only commit when explicitly told to.
- Before every commit: run `pytest`, `lint-imports` (backend, venv active),
  `npm test` and `npm run check:deps` (frontend).
- Never delete files you did not create.
- Never overwrite `backend/.env` — use `cp -n` (not `cp`) when seeding it
  from `.env.example`, and never print, copy, or commit its contents or
  any API key.
- Current phase: early MVP build. Features are being added incrementally
  per ticket — see GitHub Issues for the backlog.
- **Color or style changes must be verified against the built CSS, not
  just the Tailwind config or component source.** jsdom cannot see
  colors, layout, or contrast — all 100+ frontend tests can pass while a
  button is genuinely invisible in a real browser. After any such change,
  run `npm run build` and grep the generated `dist/assets/*.css` for the
  actual classes involved (e.g. `grep -o '\.bg-brand{[^}]*}' dist/assets/*.css`)
  and read the real `background-color`/`color`/`border-color` value —
  don't assume a class exists or resolves correctly just because it's
  spelled correctly in the source. Delete `dist/` afterward; never commit
  it. See `src/components/ui/Button.contrast.test.ts` for a test-level
  version of this same check (resolves the real Tailwind theme and
  verifies every token/contrast pair), and open `?view=styleguide` (dev
  only) to look at every component state directly.
