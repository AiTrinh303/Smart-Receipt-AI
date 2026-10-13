import uuid
from pathlib import Path

UPLOAD_DIR = Path(__file__).resolve().parent.parent / "uploads"


def save_file(contents: bytes, extension: str) -> str:
    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

    # A fresh UUID is used as the stored filename so the client-supplied
    # filename (which may contain path-traversal sequences) never reaches
    # the filesystem path.
    receipt_id = str(uuid.uuid4())
    stored_path = UPLOAD_DIR / f"{receipt_id}{extension}"
    stored_path.write_bytes(contents)
    return receipt_id


def find_file(receipt_id: uuid.UUID) -> Path | None:
    matches = list(UPLOAD_DIR.glob(f"{receipt_id}.*"))
    return matches[0] if matches else None
