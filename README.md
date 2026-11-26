# Smart Receipt AI

Keep, check and archive receipts for two holiday apartments, ready for the
year-end tax report.

## What this is
A web app that stores the shopping receipts of my two holiday apartments in
Germany. I upload photos or PDFs, AI reads the date, store, items and total,
I check the result against the original, and the yearly report and export go
to my tax advisor. It is built for one person, the owner of the apartments,
and runs only on my own computer. It is not a multi-user product.

![Upload page: choose an apartment, add receipts, see your latest uploads](docs/images/upload-page.png)

## Before you start
- Python 3 (I use 3.12) and Node.js with npm (a current LTS version). Check
  with `python3 --version` and `node --version`.
- Git, and a Linux or macOS terminal. On Windows, use WSL or replace the
  activate command with `venv\Scripts\activate`.
- An OpenAI API key with credit. The API is billed separately from a ChatGPT
  subscription: create the key at platform.openai.com and add billing there.
  Each receipt is one API call, so set a monthly limit and watch the usage
  page.
- `backend/.env` holds your key. Never commit it.
- No login: use it only on your own machine and do not expose it to the
  internet.
- Receipt files are sent to OpenAI to be read, and deleting a receipt in
  the app cannot delete that copy.

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
3. Open `backend/.env` and replace `your-key-here` with your real
   `OPENAI_API_KEY`.
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

After changing `backend/.env`, stop and restart uvicorn: `--reload` does not
watch that file. The database and the uploads folder are created
automatically on first run.

## How to know it worked
- http://localhost:8001/health shows `{"status":"ok"}`.
- http://localhost:5173 shows the Upload page with two apartment cards
  (Bergblick and Waldglück), nothing pre-selected, and a dashed upload area.
- Choose an apartment, add a receipt photo or PDF and click "Read receipt".
  After a few seconds the receipt page shows the store, date, items and total
  next to the original file. Reload the page: the same result appears without
  a new AI call.
- The tests pass (see [Tests](#tests)).

## Features
- Upload one receipt or up to 20 at once (photo or PDF); AI reads the store,
  date, items and total.
- Check each receipt next to its original file, edit it, reset it to the AI
  result, approve it, and download it as a PDF.
- History (receipts) and Items (every purchased line): filter by apartment,
  year and review status; search and sort items.
- Yearly report per apartment, with a quick check of warnings, possible
  duplicates and the largest receipts.
- Download the yearly report as CSV, or as a ZIP with every receipt as a PDF,
  for the tax advisor.
- Warns before reading a file that is already saved, so the AI does not read
  it twice unless you choose "Upload anyway".
- The Upload page shows your latest uploads and the count per apartment.

## Where AI was used
- **In the product:** OpenAI reads each receipt. The untouched AI output is
  kept next to an editable working copy, and the app warns when the numbers
  do not add up.
- **In building it:** most code was written by Claude Code from tickets I
  wrote with a chat assistant. I chose the scope and wrote the decisions in
  `docs/adr/`.
- **How it was checked:** `pytest`, `npm test`, the layering checks
  (`lint-imports`, `npm run check:deps`), and trying real receipts in the
  browser and comparing the totals with the originals.
- **What was not verified:** I did not read every generated line, and the AI
  can misread a receipt, so totals must be checked against the original.

## Project structure
```text
Smart-Receipt-AI/
├── backend/
│   ├── main.py            # entry point (uvicorn main:app)
│   ├── config.py          # settings from .env (API key, database path)
│   ├── domain/            # pure rules: models, dates, money, warnings, interfaces
│   ├── adapters/          # outside world: OpenAI, SQLite, uploads folder, PDF/ZIP export
│   ├── api/               # FastAPI routes and error handling
│   ├── scripts/           # backup.py, restore.py, backfill_hashes.py
│   ├── tests/             # pytest
│   ├── data/              # SQLite database (not in git)
│   └── uploads/           # original receipt files (not in git)
├── frontend/
│   ├── public/            # favicon and icons
│   └── src/
│       ├── api/           # calls to the backend
│       ├── batch/         # upload queue
│       ├── components/ui/ # shared UI components
│       ├── format/        # display helpers (dates, apartment names)
│       ├── hash/          # file fingerprint (SHA-256) in the browser
│       ├── hooks/         # React hooks
│       └── *.tsx          # screens: upload, history, items, report, receipt
├── docs/
│   ├── adr/               # architecture decisions
│   ├── images/            # README screenshot
│   ├── notes/             # detailed frontend/backend notes
│   └── design.md          # design rules
├── CLAUDE.md              # rules for the AI assistant
└── README.md
```
Dependencies point inward: `api` → `adapters` → `domain`. The domain never
imports the others. Backups go to `backups/` (created by the backup script,
not in git).

Decisions: [docs/adr/](docs/adr/). Design rules: [docs/design.md](docs/design.md).
Rules for the AI assistant: [CLAUDE.md](CLAUDE.md).

## Background
Entering receipt details (store, date, items, prices, tax, total) by hand
for every purchase is slow and error-prone, and at tax time every receipt
has to be found again, sorted by apartment and added up. This app does the
reading and the adding up; I do the checking.

## Tests
```bash
cd backend && source venv/bin/activate
pip install -r requirements-dev.txt
pytest          # backend tests (temporary database, no OpenAI calls)
lint-imports    # checks the layers
cd ../frontend
npm test        # frontend tests
npm run check:deps
```

## Backups
Run inside `backend/` with the venv active:
```bash
python scripts/backup.py                 # zip of database + uploads into ../backups/, keeps the newest 30
python scripts/backup.py --out DIR --keep 10
python scripts/restore.py ../backups/receipts-backup-<date>.zip --target DIR
```
`restore.py` checks the whole ZIP before writing anything and restores into
a separate folder, never over the live data. It refuses a folder that
already has data unless you add `--force`, which moves the old data aside
first.
