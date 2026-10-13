import logging
import os
import time
import uuid
from pathlib import Path

from fastapi import Depends, FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware

import config
from extraction import ExtractionError, OpenAIReceiptExtractor, ReceiptExtractor

logger = logging.getLogger(__name__)

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


def get_extractor() -> ReceiptExtractor:
    if not config.OPENAI_API_KEY:
        raise HTTPException(status_code=503, detail="Receipt extraction is not configured.")
    return OpenAIReceiptExtractor(api_key=config.OPENAI_API_KEY, model=config.OPENAI_MODEL)


@app.post("/receipts/{receipt_id}/extract")
def extract_receipt(receipt_id: str, extractor: ReceiptExtractor = Depends(get_extractor)):
    try:
        validated_id = uuid.UUID(receipt_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="receipt_id must be a valid UUID.")

    matches = list(UPLOAD_DIR.glob(f"{validated_id}.*"))
    if not matches:
        raise HTTPException(status_code=404, detail="Receipt not found.")

    file_path = matches[0]
    started_at = time.perf_counter()
    try:
        data = extractor.extract(file_path)
    except ExtractionError as exc:
        elapsed_seconds = time.perf_counter() - started_at
        # The chained cause (e.g. the real OpenAI SDK exception) carries the
        # actual diagnostic detail; it is logged server-side only and never
        # included in the HTTP response, which stays a generic 502.
        cause = exc.__cause__ or exc
        logger.error(
            "Receipt extraction failed: receipt_id=%s extension=%s size_bytes=%s "
            "model=%s elapsed_seconds=%.3f exception_type=%s exception_message=%s",
            receipt_id,
            file_path.suffix,
            file_path.stat().st_size,
            config.OPENAI_MODEL,
            elapsed_seconds,
            type(cause).__name__,
            cause,
            exc_info=True,
        )
        raise HTTPException(status_code=502, detail="Receipt extraction failed. Please try again.")

    return {"receipt_id": receipt_id, **data.model_dump()}
