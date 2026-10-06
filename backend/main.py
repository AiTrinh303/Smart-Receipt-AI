import os
import uuid
from pathlib import Path

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI()

CORS_ORIGINS = os.environ.get("CORS_ORIGINS", "http://localhost:5173").split(",")

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)

UPLOAD_DIR = Path(__file__).parent / "uploads"

ALLOWED_EXTENSIONS = {".jpg", ".jpeg", ".png", ".pdf"}
ALLOWED_CONTENT_TYPES = {"image/jpeg", "image/png", "application/pdf"}
MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024  # 10 MB


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/receipts/upload", status_code=201)
async def upload_receipt(file: UploadFile = File(...)):
    extension = Path(file.filename or "").suffix.lower()

    if extension not in ALLOWED_EXTENSIONS or file.content_type not in ALLOWED_CONTENT_TYPES:
        raise HTTPException(
            status_code=400,
            detail="Unsupported file type. Allowed types: .jpg, .jpeg, .png, .pdf",
        )

    contents = await file.read()

    if len(contents) == 0:
        raise HTTPException(status_code=400, detail="Uploaded file is empty.")

    if len(contents) > MAX_FILE_SIZE_BYTES:
        raise HTTPException(status_code=413, detail="File exceeds the maximum size of 10 MB.")

    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

    # A fresh UUID is used as the stored filename so the client-supplied
    # filename (which may contain path-traversal sequences) never reaches
    # the filesystem path.
    receipt_id = str(uuid.uuid4())
    stored_path = UPLOAD_DIR / f"{receipt_id}{extension}"
    stored_path.write_bytes(contents)

    return {
        "receipt_id": receipt_id,
        "filename": file.filename,
        "content_type": file.content_type,
        "size_bytes": len(contents),
    }
