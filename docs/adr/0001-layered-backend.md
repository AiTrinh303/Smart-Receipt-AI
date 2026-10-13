# ADR 0001: Layered backend, dependencies point inward
Status: Accepted · Date: 2026-10-13
## Context
Rules (allowed file types, size limit, receipt data shape) were
mixed with outside-world code (FastAPI routes, OpenAI calls) in
main.py and extraction.py. We plan to add SQLite and may change the
AI provider.
## Decision
Three layers: domain (models, rules, ports), adapters (OpenAI,
SQLite, file storage), api (FastAPI routes).
Allowed: api -> adapters -> domain, and api -> domain.
Forbidden: domain importing adapters, api, fastapi, openai or
sqlite3.
Frontend: UI components -> src/api -> types. src/api never imports
UI components.
## Consequences
Domain tests need no API key or network. Swapping OpenAI or SQLite
touches one adapter. Cost: more files and some wiring code.
## Check
import-linter (backend) and dependency-cruiser (frontend), run
before every commit.
