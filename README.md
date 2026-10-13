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
comes from `DATABASE_PATH` (default `backend/data/receipts.db`, created
automatically); `backend/data/` and `*.db` files are gitignored.
**Note:** receipt data itself is stored locally, but the receipt image/PDF
is still sent to OpenAI for extraction.

### Endpoints

- `GET /health` — liveness check.
- `POST /receipts/upload` — accepts one JPG/PNG/PDF receipt file, stores it,
  records it in the database, and returns a `receipt_id`.
- `POST /receipts/{receipt_id}/extract` — sends the stored receipt to the
  OpenAI API, returns structured purchase data (store, date, items,
  discounts, taxes, total), and saves the result (re-extracting the same
  receipt overwrites the saved result). Requires `OPENAI_API_KEY` to be set
  in `backend/.env` (see `backend/.env.example`); without it the endpoint
  returns `503`. **Note:** uploaded receipts are sent to OpenAI for
  processing when this endpoint is called.
- `GET /receipts/{receipt_id}` — returns the saved receipt (same fields as
  the extract response, plus `original_filename`, `content_type`,
  `created_at`, `updated_at`). Unknown or not-yet-extracted receipts
  return `404`.
