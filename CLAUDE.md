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
  `src/api/` holds API call modules (e.g. `uploadReceipt.ts`); the backend
  URL is read from `VITE_API_URL` (`.env.example` / `.env`, the latter
  gitignored).
- `backend/` — FastAPI app (`main.py`) with a Python venv and
  `requirements.txt`/`requirements-dev.txt`. Has `/health`,
  `POST /receipts/upload`, and `POST /receipts/{receipt_id}/extract`
  (sends the stored receipt to the OpenAI API — see `extraction.py` —
  and returns structured data; requires `OPENAI_API_KEY`, else `503`).
  Config (`config.py`) is read from `backend/.env`
  (`backend/.env.example`, the former gitignored). CORS allowed origins
  come from the `CORS_ORIGINS` env var (default `http://localhost:5173`).
  **Note:** calling the extract endpoint sends the receipt file to OpenAI.

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
```

## Conventions

- Keep changes scoped to what's asked — don't add features, UI, or
  abstractions beyond the current task.
- `frontend/` and `backend/` changes should stay separate; only touch both
  when a task explicitly requires it.
- Do not commit automatically — only commit when explicitly told to.
- Current phase: early MVP build. Features are being added incrementally
  per ticket — see GitHub Issues for the backlog.
