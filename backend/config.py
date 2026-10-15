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

DATABASE_PATH = Path(
    os.environ.get("DATABASE_PATH", str(Path(__file__).parent / "data" / "receipts.db"))
)
