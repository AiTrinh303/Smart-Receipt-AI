# Smart Receipt AI

Keep, check and archive receipts for two holiday apartments, ready for the year-end tax report.

## What this is
A web app that stores the shopping receipts of my two holiday apartments in Germany. I upload photos or PDFs, AI reads the date, store, items and total, I check the result against the original and approve it, and the data will feed my year-end tax report. It is built for one person, the owner of the apartments, not as a multi-user product.

## Features
- Upload a receipt photo or PDF; AI reads the store, date, items and total.
- Browse History and Items, filter by apartment/year/status, search items.
- Yearly report (counts every receipt; shows warnings, possible duplicates and the largest receipts to check).
- Download the yearly report as CSV and a ZIP with the PDFs, for the tax advisor.
- Warns before reading a file that is already saved; the same file is never read by the AI twice.
- Upload page for repeat use: see your latest uploads and counts per apartment, and what was read in each finished batch row.

## Before you start
- Python 3 (I use 3.12) and Node.js with npm (a current LTS version). Check with `python3 --version` and `node --version`.
- Git, and a Linux or macOS terminal. On Windows, use WSL or replace the activate command with `venv\Scripts\activate`.
- An OpenAI API key with credit. The API is billed separately from a ChatGPT subscription: create the key at platform.openai.com and add billing there. Each receipt is one API call, so set a monthly limit and watch the usage page.
- `backend/.env` holds your key. Never commit it.

## How to run it
1. Get the code:
   ```bash
   git clone https://github.com/AiTrinh303/Smart-Receipt-AI.git
   cd Smart-Receipt-AI
   ```
2. Set up the backend:
   ```bash
   cd backend
   python3 -m venv venv
   source venv/bin/activate
   pip install -r requirements.txt
   cp -n .env.example .env
   ```
3. Open `backend/.env` and replace `your-key-here` with your real `OPENAI_API_KEY`.
4. Start the backend (same terminal):
   ```bash
   uvicorn main:app --reload --port 8001
   ```
5. In a second terminal, start the frontend:
   ```bash
   cd frontend
   npm install
   cp -n .env.example .env
   npm run dev
   ```
6. Open http://localhost:5173

After changing `backend/.env`, stop and restart uvicorn. `--reload` does not watch that file. The database and the uploads folder are created automatically on first run.

## How to know it worked
- http://localhost:8001/health shows `{"status":"ok"}`.
- http://localhost:5173 shows the Upload page with two apartment cards (Bergblick and Waldglück), nothing pre-selected, and a dashed upload area.
- Choose an apartment, add a receipt photo or PDF and click "Read receipt". After a few seconds the receipt page shows the store, date, items and total next to the original file. Reload the page: the same result appears without a new AI call.
- If the page says "The AI service is not available", the key is missing, wrong or out of credit. Check `backend/.env` and restart the backend.
- The tests pass: `cd backend && pip install -r requirements-dev.txt && pytest`, then `cd frontend && npm test`.

## What it does not do yet
- No login. Use it only on your own machine and do not expose it to the internet.
- Only an identical file is detected as a duplicate: a second photo of the same receipt is only flagged in the yearly report's quick check.
- No bulk approval: receipts are approved one at a time, with a review mode that moves to the next one.
- The AI can misread a receipt. Check each one against the original before approving it.
- Receipt files are sent to OpenAI to be read, and deleting a receipt here cannot delete that copy.
- Backups are manual (`python scripts/backup.py`, run inside `backend/`), and a batch in progress is lost if the browser tab is closed.
- The yearly export ZIP is **not encrypted** and contains personal data (receipt photos/PDFs and amounts) — handle and send it the same way you would the original receipts.

## Where the decisions live
Why it is built this way, in short:
- **Three layers (domain, adapters, api).** The rules do not depend on OpenAI, SQLite or FastAPI, so changing the AI provider or the database means editing one adapter, and the tests need no API key. A check (`import-linter`) fails if the domain imports an outer layer.
- **Every receipt keeps two copies of its data:** the untouched AI output and a working copy I can edit. That gives an audit trail for tax purposes and a "reset to AI result" button.
- **Money is never a floating-point number.** Amounts use exact decimals so totals add up.
- **Warnings do not block.** A total that does not match or an odd date only warns me. Three things are required to approve a receipt: an apartment, a valid date and a total.
- **One apartment per receipt, no categories.** The report only needs apartment, year and review status, so categories were removed.
- **No login, one local SQLite file.** It is a personal tool, so I kept it simple and listed the risk above.
- **Duplicate files are caught by content, not by name.** Uploading a file now hashes it (SHA-256) before anything is written or sent to the AI; if an identical file is already saved, the upload is refused with a 409 pointing at the existing receipt, unless I explicitly say to keep it anyway. The 46 receipts saved before this existed have no hash yet — `python scripts/backfill_hashes.py` (run once inside `backend/`, after activating the venv) fills them in; `--dry-run` previews it first, and `--report` lists any receipts that turn out to already share an identical file.

The decisions are written down in `docs/adr/`:
- [ADR 0001: layered backend](docs/adr/0001-layered-backend.md)
- [ADR 0002: apartments and the expense ledger](docs/adr/0002-apartments-and-expense-ledger.md)
- [ADR 0003: category and review status](docs/adr/0003-category-and-review-status.md), superseded by 0004
- [ADR 0004: remove categories](docs/adr/0004-remove-categories.md)

The plan and backlog are the [GitHub issues](https://github.com/AiTrinh303/Smart-Receipt-AI/issues), each with acceptance criteria. Design rules: [docs/design.md](docs/design.md). Rules for the AI assistant: [CLAUDE.md](CLAUDE.md).

## Project structure
```text
Smart-Receipt-AI/
├── backend/
│   ├── main.py            # entry point (uvicorn main:app)
│   ├── config.py          # settings from .env (API key, database path)
│   ├── domain/            # pure rules: models, dates, money, warnings, interfaces
│   ├── adapters/          # outside world: OpenAI, SQLite, uploads folder, PDF export
│   ├── api/               # FastAPI routes and error handling
│   ├── scripts/           # backup.py, restore.py, backfill_hashes.py
│   ├── tests/             # pytest
│   ├── data/              # SQLite database (not in git)
│   └── uploads/           # original receipt files (not in git)
├── frontend/
│   └── src/
│       ├── api/           # calls to the backend
│       ├── batch/         # upload queue logic
│       ├── components/ui/ # shared UI components
│       ├── format/        # display helpers (dates, apartment names)
│       ├── hooks/         # React hooks
│       └── *.tsx          # screens: upload, history, items, receipt
├── docs/
│   ├── adr/               # architecture decisions
│   └── design.md          # design rules
├── backups/               # backup archives (not in git)
├── CLAUDE.md              # rules for the AI assistant
└── README.md
```
Dependencies point inward: `api` → `adapters` → `domain`. The domain never imports the others.

## Background
**User problem.** Users currently have to manually enter receipt details (store, date, items, prices, tax, total) after every purchase, which is time-consuming and error-prone.

**MVP.** A user can upload one shopping receipt (image or PDF), the system uses AI to extract the important purchase information, and displays the result clearly for review.