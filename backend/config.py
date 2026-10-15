import os
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).parent / ".env")

_PLACEHOLDER_OPENAI_API_KEY = "your-key-here"
_raw_openai_api_key = os.environ.get("OPENAI_API_KEY")
# An empty value or the .env.example placeholder is treated as "not
# configured" (same as a missing key), so the existing 503 path covers it and
# no provider call is ever attempted with a key that could never work.
OPENAI_API_KEY = (
    _raw_openai_api_key
    if _raw_openai_api_key and _raw_openai_api_key != _PLACEHOLDER_OPENAI_API_KEY
    else None
)
OPENAI_MODEL = os.environ.get("OPENAI_MODEL", "gpt-6-astra")

_BACKEND_DIR = Path(__file__).parent
_raw_database_path = Path(os.environ.get("DATABASE_PATH", "data/receipts.db"))
# A relative DATABASE_PATH (including the default) is resolved against the
# backend/ directory itself, not the current working directory -- otherwise
# starting uvicorn from a different folder would silently create a second,
# empty database. An absolute DATABASE_PATH is used exactly as given.
DATABASE_PATH = (
    _raw_database_path if _raw_database_path.is_absolute() else _BACKEND_DIR / _raw_database_path
)
DATABASE_PATH.parent.mkdir(parents=True, exist_ok=True)
