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
cp .env.example .env   # add your OPENAI_API_KEY
uvicorn main:app --reload --port 8001
```

Runs at http://localhost:8001 — check http://localhost:8001/health

The backend allows cross-origin requests from the frontend dev server via
the `CORS_ORIGINS` environment variable (defaults to
`http://localhost:5173`).

### Endpoints

- `GET /health` — liveness check.
- `POST /receipts/upload` — accepts one JPG/PNG/PDF receipt file, stores it,
  and returns a `receipt_id`.
- `POST /receipts/{receipt_id}/extract` — sends the stored receipt to the
  OpenAI API and returns structured purchase data (store, date, items,
  discounts, taxes, total). Requires `OPENAI_API_KEY` to be set in
  `backend/.env` (see `backend/.env.example`); without it the endpoint
  returns `503`. **Note:** uploaded receipts are sent to OpenAI for
  processing when this endpoint is called.
