# CLAUDE.md

Reference context for Claude Code working in this repository. This file is
a short index; per-feature detail lives in the files listed under "Where to
read more" at the end.

## Standing rules for tickets

These apply to every ticket, on top of (never in place of) the
per-feature detail documented in `docs/notes/`.

- **Scope, dependencies, push.** Work only in the folder(s) the ticket
  names (`frontend/`, `backend/`, or both only when it explicitly says
  so). No new dependencies unless the ticket says otherwise. Never push —
  commit locally only, even when a ticket gives an exact commit message
  and says to commit.
- **Staging and file safety.** Stage specific files only — never
  `git add .` or `git add -A`. Never commit `.env`, uploaded files, a
  `.db` file, `backups/`, or any build output (`dist/`, etc.). Never
  print, copy, or overwrite `backend/.env` — use `cp -n` (never `cp`)
  when seeding it from `.env.example`. Never delete a file you did not
  create.
- **Before any commit.** Prerequisite: `git status` is clean and every
  check below passes — if not, stop and resolve that first rather than
  working around it. The checks themselves: backend `pytest` and
  `lint-imports` (venv active); frontend `npm test`, `npm run
  check:deps`, and `npm run build` (delete the resulting `dist/`
  afterward — see the color/style rule below (in Conventions) for why
  the build itself matters, not just the tests).
- **Tests.** Given/When/Then comments. Backend tests use a temporary
  database and `FakeExtractor` only — never the real database and never
  a real OpenAI call. Frontend tests mock `fetch` and reset the URL in
  `beforeEach`/`afterEach`. When a ticket's change touches an existing
  test, list every one changed and why.
- **Frontend UI.** Use the design-system tokens and the shared
  `src/components/ui/` components — never a hardcoded color or ad hoc
  markup. Every Tailwind class name is a complete static string, never
  built by concatenating a variable into one. A minimum 44px touch
  target below `sm`. A visible `focus-visible` ring on every interactive
  element. Never convey state by color alone. Keep every user-visible
  string an existing test relies on unless the ticket explicitly asks to
  change it. No arithmetic on money in the frontend.
- **Backend.** `domain/` never imports `adapters`, `api`, `fastapi`,
  `openai`, `sqlite3`, or `PIL` (enforced by `lint-imports`). Money is
  always `Decimal(str(value))`, never a raw float.
- **No browser tool.** Give manual browser steps for whatever only a
  real browser can confirm (color/contrast, layout at specific widths, a
  real file download, `crypto.subtle` hashing, a new-tab link) and say so
  explicitly, rather than claiming it was verified.
- **End of response.** Finish with `git log --oneline`, `git log --stat`
  for the new commit(s), and `git status`.

## Project overview

Smart Receipt AI keeps, checks and archives the shopping receipts of the
owner's two holiday apartments in Germany (rented out via Booking), ready
for the yearly tax report. It is used by one person, the owner, and runs
locally only (no login, no hosting). The owner uploads photos or PDFs, AI
(OpenAI) reads store, date, items and total, the owner checks the result
against the original, and the yearly report plus a CSV/ZIP export go to
the tax advisor.

## Tech stack

- Frontend: Vite + React + TypeScript + Tailwind CSS
- Backend: FastAPI (Python), SQLite via stdlib `sqlite3`, Pillow for PDFs
- AI: OpenAI API (receipt extraction)
- Testing: Jest + React Testing Library (frontend), pytest (backend)

## Project structure

- `frontend/` — Vite app. `src/api/` API call modules + shared `types.ts`
  (never imports UI; enforced by dependency-cruiser), `src/components/ui/`
  shared components, `src/hooks/`, `src/format/` display helpers,
  `src/batch/` batch upload engine + queue, `src/hash/` client-side
  SHA-256. Design tokens in `tailwind.config.js` (see `docs/design.md`).
- `backend/` — FastAPI, layered per ADR 0001 (enforced by import-linter):
  - `domain/` — models, pure rules, ports, report export logic; never
    imports `adapters`/`api`/`fastapi`/`openai`/`sqlite3`/`PIL`.
  - `adapters/` — OpenAI extractor, SQLite repository, file storage,
    PDF archive, ZIP export.
  - `api/` — `app.py` (app, CORS, lifespan) and `routes.py` (endpoints).
  - `main.py` entry point, `config.py` (reads `backend/.env`),
    `scripts/` backup/restore/backfill tooling (outside the layers).
- URL views (no router; `src/navigation.ts` + `App.tsx`):
  - `/` — Upload (single file or batch, apartment required)
  - `?receipt=<id>` — saved receipt: file viewer, review, edit, delete
  - `?view=history` — receipts list, apartment tabs + year/status filters
  - `?view=items` — line items table, search and sort
  - `?view=report` — yearly report and tax-advisor export
  - `?view=styleguide` — dev-only style guide
- Shared UI components (`src/components/ui/`): `Button`, `Card`, `Alert`,
  `Spinner`, `Skeleton`, `Container`, `PageHeader`, `RadioCardGroup`,
  `StatusBadge`, `MissingValue`, `ClampedText`, plus `formatFileSize` and
  `formatMoney`.

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
- Do not commit automatically — only commit when explicitly told to (see
  "Standing rules for tickets" above for everything else that applies once
  a ticket does ask for a commit).
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

## Where to read more

- [docs/notes/frontend.md](docs/notes/frontend.md) — before changing any frontend view, component, API module or test.
- [docs/notes/backend.md](docs/notes/backend.md) — before changing any endpoint, the repository/schema, domain rules or scripts.
- [docs/design.md](docs/design.md) — before any visual change: tokens, contrast, layout rules, which shared component to use.
- [docs/adr/](docs/adr/) — before changing architecture or reviving a removed feature (layering, apartments, status, categories).
- [README.md](README.md) — for setup, running the app and what it does from the owner's point of view.
