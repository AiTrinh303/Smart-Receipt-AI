import logging
import time
import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile

import config
from adapters.file_storage import find_file, save_file
from adapters.openai_extractor import OpenAIReceiptExtractor
from adapters.sqlite_repository import SqliteReceiptRepository
from domain.ports import ExtractionError, ReceiptExtractor, ReceiptRepository
from domain.rules import EmptyFileError, FileTooLargeError, UnsupportedFileTypeError, validate_upload

logger = logging.getLogger(__name__)

router = APIRouter()

_repository: ReceiptRepository | None = None


def get_repository() -> ReceiptRepository:
    global _repository
    if _repository is None:
        _repository = SqliteReceiptRepository(config.DATABASE_PATH)
    return _repository


@router.get("/health")
def health():
    return {"status": "ok"}


@router.post("/receipts/upload", status_code=201)
async def upload_receipt(
    file: UploadFile = File(...),
    repository: ReceiptRepository = Depends(get_repository),
):
    extension = Path(file.filename or "").suffix.lower()
    contents = await file.read()

    try:
        validate_upload(extension, file.content_type, len(contents))
    except UnsupportedFileTypeError:
        raise HTTPException(
            status_code=400,
            detail="Unsupported file type. Allowed types: .jpg, .jpeg, .png, .pdf",
        )
    except EmptyFileError:
        raise HTTPException(status_code=400, detail="Uploaded file is empty.")
    except FileTooLargeError:
        raise HTTPException(status_code=413, detail="File exceeds the maximum size of 10 MB.")

    receipt_id = save_file(contents, extension)
    repository.save_upload(
        receipt_id=receipt_id,
        original_filename=file.filename,
        stored_filename=f"{receipt_id}{extension}",
        content_type=file.content_type,
    )

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


@router.post("/receipts/{receipt_id}/extract")
def extract_receipt(
    receipt_id: str,
    extractor: ReceiptExtractor = Depends(get_extractor),
    repository: ReceiptRepository = Depends(get_repository),
):
    try:
        validated_id = uuid.UUID(receipt_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="receipt_id must be a valid UUID.")

    file_path = find_file(validated_id)
    if file_path is None:
        raise HTTPException(status_code=404, detail="Receipt not found.")

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

    try:
        repository.save_receipt(receipt_id, data)
    except Exception:
        # Never tell the client the receipt was saved when it was not; the
        # real cause (never the API key or file contents) is logged for
        # developers only.
        logger.exception("Failed to save extracted receipt: receipt_id=%s", receipt_id)
        raise HTTPException(
            status_code=500,
            detail="Could not save the extracted receipt. Please try again.",
        )

    return {"receipt_id": receipt_id, **data.model_dump()}


@router.get("/receipts/{receipt_id}")
def get_receipt(receipt_id: str, repository: ReceiptRepository = Depends(get_repository)):
    try:
        validated_id = uuid.UUID(receipt_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="receipt_id must be a valid UUID.")

    saved = repository.get_receipt(str(validated_id))
    if saved is None:
        raise HTTPException(status_code=404, detail="Receipt not found.")

    return saved.model_dump()
