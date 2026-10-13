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
  `src/api/` holds API call modules (`uploadReceipt.ts`, `extractReceipt.ts`,
  shared `ApiError`, shared response types in `types.ts`); the backend URL
  is read from `VITE_API_URL` (`.env.example` / `.env`, the latter
  gitignored). `ReceiptUpload.tsx` uploads a file then automatically calls
  extract and renders `ReceiptResult.tsx` with the structured result.
  Dependency direction: UI components (`App.tsx`, `ReceiptUpload.tsx`,
  `ReceiptResult.tsx`) -> `src/api/` -> `src/api/types.ts`. `src/api/` must
  never import a UI component — enforced by dependency-cruiser.
- `backend/` — FastAPI app with a Python venv and
  `requirements.txt`/`requirements-dev.txt`, layered per
  [docs/adr/0001-layered-backend.md](docs/adr/0001-layered-backend.md):
  - `domain/` — `models.py` (`ReceiptData` and friends, plus `SavedUpload`
    and `SavedReceipt` for persisted data), `rules.py` (allowed file types,
    size limit; raises domain exceptions, no HTTP/FastAPI/file I/O),
    `ports.py` (`ReceiptExtractor` Protocol + `ExtractionError`,
    `ReceiptRepository` Protocol — `save_upload`/`get_upload`/
    `save_receipt`/`get_receipt`). Must never import `adapters`, `api`,
    `fastapi`, `openai`, `sqlite3`, or `config.py`.
  - `adapters/` — `openai_extractor.py` (`OpenAIReceiptExtractor`, the
    OpenAI API call), `file_storage.py` (saving/finding files in
    `uploads/` by UUID filename), `sqlite_repository.py`
    (`SqliteReceiptRepository`: stdlib `sqlite3`, no ORM; `uploads` and
    `receipts` tables; schema created via `CREATE TABLE IF NOT EXISTS`).
    Must never import `api`.
    **Money rule:** `total` is never stored as a float — the adapter
    converts with `Decimal(str(value))` to an exact decimal string (e.g.
    `19.99`, not a binary-float expansion) in a dedicated column kept for
    future search/summary use; the live API always reads `total` back from
    `extracted_json` (the full `ReceiptData`, parsed with its original
    float), never from that decimal-string column, so no rounding error
    ever reaches a response.
  - `api/` — `app.py` (creates the FastAPI app, CORS middleware, and a
    `lifespan` handler that creates the repository — and therefore the
    SQLite schema — at startup, not the deprecated `on_event`),
    `routes.py` (`/health`, `POST /receipts/upload`,
    `POST /receipts/{receipt_id}/extract`, `GET /receipts/{receipt_id}`;
    the `get_extractor` and `get_repository` dependencies; server-side
    logging of extraction and save failures; maps domain exceptions to
    HTTP status codes: 400/413 from upload rules, 502 from
    `ExtractionError`, 503 when `OPENAI_API_KEY` is missing, 500 generic on
    a repository save failure — raw error text is never returned to the
    client).
  - `main.py` stays a thin entry point (`from api.app import app`) so
    `uvicorn main:app --reload --port 8001` keeps working.
  - `config.py` stays at the backend root; reads `backend/.env`
    (`backend/.env.example`, the former gitignored). CORS allowed origins
    come from `CORS_ORIGINS` (default `http://localhost:5173`).
    `DATABASE_PATH` (default `backend/data/receipts.db`) configures the
    SQLite file; `backend/data/` and `*.db` are gitignored.
  - Dependency direction: `api` -> `adapters` -> `domain`, and `api` ->
    `domain` directly. Enforced by import-linter (`backend/.importlinter`).
  - **Note:** calling the extract endpoint sends the receipt file to
    OpenAI; the resulting receipt data is then stored locally in SQLite
    (the file itself stays in `backend/uploads/`, never in the database).

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
