# Smart Receipt AI

## What this is
A web app that stores the shopping receipts of my two holiday apartments. I upload photos or PDFs, AI reads the date, store, items and total, I check the result and approve it, and the data will feed my year-end tax report. It is built for one person, the owner of the apartments, not as a multi-user product.

## Before you start
- Python 3 (I use 3.12) and Node.js with npm (a current LTS version). Check with `python3 --version` and `node --version`.
- Git, and a Linux or macOS terminal. On Windows, use WSL or replace the activate command with `venv\Scripts\activate`.
- An OpenAI API key with credit. The API is billed separately from a ChatGPT subscription: create the key at platform.openai.com and add billing there.
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

After changing `backend/.env`, stop and restart uvicorn. `--reload` does not watch that file.

## How to know it worked
- http://localhost:8001/health shows `{"status":"ok"}`.
- http://localhost:5173 shows the Upload page with an "Apartment" section marked "Required", two apartment cards (Bergblick and Waldglück) below it, and a dashed upload area further down. Nothing is pre-selected, and a muted line under the "Read receipt" button says what to do next.
- Choose an apartment, add a receipt photo or PDF (drag it in, or click "Browse files" inside the dashed area) and click "Read receipt". After a few seconds the receipt page shows the store, date, items and total next to the original image. Reload the page: the same result appears without a new AI call.
- If the page says "The AI service is not available", the key is missing, wrong or out of credit. Check `backend/.env` and restart the backend.
- Optional, to run the tests: `cd backend && pip install -r requirements-dev.txt && pytest`, then `cd frontend && npm test`.

## What it does not do yet
- No login. Use it only on your own machine and do not expose it to the internet.
- No year-end report or export yet. Planned: approved receipts only, per apartment and year, as CSV plus a PDF bundle.
- No duplicate detection: uploading the same receipt twice creates two records.
- The AI can misread a receipt. Check each one against the original before approving it.
- Receipt files are sent to OpenAI to be read, and deleting a receipt here cannot delete that copy.
- Backups are manual (`python scripts/backup.py`, run inside `backend/`), and a batch in progress is lost if the browser tab is closed.

## Where the decisions live
- Architecture: [ADR 0001, layered backend](docs/adr/0001-layered-backend.md)
- Apartments and the expense ledger: [ADR 0002](docs/adr/0002-apartments-and-expense-ledger.md)
- Categories removed: [ADR 0004](docs/adr/0004-remove-categories.md) (supersedes ADR 0003)
- Spec and plan: [plan.spec.md](plan.spec.md)
- Design rules: [docs/design.md](docs/design.md). Rules for the AI assistant: [CLAUDE.md](CLAUDE.md)

## Background

### User Problem
Users currently have to manually enter receipt details (store, date, items,
prices, tax, total) after every purchase, which is time-consuming and
error-prone.

### MVP
A user can upload one shopping receipt (image or PDF), the system uses AI
to extract the important purchase information, and displays the result
clearly for review.

## Reference

### Project Structure

```
Smart-Receipt-AI/
├── frontend/   # React + TypeScript (Vite)
└── backend/    # FastAPI
```