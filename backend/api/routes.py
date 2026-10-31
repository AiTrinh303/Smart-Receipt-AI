import logging
import re
import time
import uuid
from datetime import date
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse

import config
from adapters.file_storage import delete_file, find_file, save_file
from adapters.openai_extractor import OpenAIReceiptExtractor
from adapters.sqlite_repository import SqliteReceiptRepository
from domain.models import (
    ApartmentAssignment,
    CategoryAssignment,
    ReceiptStatus,
    ReceiptUpdate,
    StatusAssignment,
)
from domain.ports import (
    ExtractionError,
    ExtractionUnavailableError,
    ReceiptExtractor,
    ReceiptRepository,
)
from domain.rules import (
    EmptyFileError,
    FileTooLargeError,
    UnsupportedFileTypeError,
    check_receipt,
    media_type_for_extension,
    normalize_purchase_date,
    validate_upload,
)

logger = logging.getLogger(__name__)

router = APIRouter()

_repository: ReceiptRepository | None = None


def get_repository() -> ReceiptRepository:
    global _repository
    if _repository is None:
        _repository = SqliteReceiptRepository(config.DATABASE_PATH)
    return _repository


def _warnings_payload(data) -> list[dict]:
    """Computed fresh on every call, never stored."""
    return [warning.model_dump() for warning in check_receipt(data, date.today())]


YEAR_PATTERN = re.compile(r"^\d{4}$")
MIN_FILTER_YEAR = 2000
MAX_FILTER_YEAR = 2100
NONE_FILTER_VALUE = "none"


def _parse_year_filter(year: str | None) -> tuple[int | None, bool]:
    """Returns (year_value, undated) for the `year` query param: None/False
    for no filter, (None, True) for "none" (undated), or (year_value, False)
    for a 4-digit year in range. Raises HTTPException(422) for anything
    else -- never guesses, same spirit as normalize_purchase_date."""
    if year is None:
        return None, False
    if year == NONE_FILTER_VALUE:
        return None, True
    if not YEAR_PATTERN.match(year):
        raise HTTPException(status_code=422, detail="year must be a 4-digit year (2000-2100) or 'none'.")
    year_value = int(year)
    if not (MIN_FILTER_YEAR <= year_value <= MAX_FILTER_YEAR):
        raise HTTPException(status_code=422, detail="year must be a 4-digit year (2000-2100) or 'none'.")
    return year_value, False


def _missing_approval_fields(saved) -> list[str]:
    """Fields required to set status='approved', in a fixed, stable order.
    Data-quality warnings are deliberately not checked here -- the user
    decides whether to approve despite them."""
    missing: list[str] = []
    if saved.apartment_id is None:
        missing.append("apartment")
    if saved.category_id is None:
        missing.append("category")
    if normalize_purchase_date(saved.purchase_date) is None:
        missing.append("date")
    if saved.total is None:
        missing.append("total")
    return missing


@router.get("/health")
def health():
    return {"status": "ok"}


@router.post("/receipts/upload", status_code=201)
async def upload_receipt(
    file: UploadFile = File(...),
    apartment_id: str = Form(...),
    repository: ReceiptRepository = Depends(get_repository),
):
    # Apartment choice is validated before anything touches disk or the
    # database: an unknown or inactive id must leave no file and no uploads
    # row behind, same as the existing file-validation failures below.
    apartment = repository.get_apartment(apartment_id)
    if apartment is None:
        raise HTTPException(status_code=422, detail="Unknown apartment.")
    if not apartment.active:
        raise HTTPException(status_code=422, detail="This apartment is no longer active.")

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
        apartment_id=apartment_id,
    )

    return {
        "receipt_id": receipt_id,
        "filename": file.filename,
        "content_type": file.content_type,
        "size_bytes": len(contents),
        "apartment_id": apartment.id,
        "apartment_name": apartment.name,
    }


@router.get("/apartments")
def list_apartments(repository: ReceiptRepository = Depends(get_repository)):
    items = repository.list_apartments()
    return {"items": [{"id": a.id, "name": a.name} for a in items], "count": len(items)}


@router.get("/categories")
def list_categories(repository: ReceiptRepository = Depends(get_repository)):
    items = repository.list_categories()
    return {"items": [{"id": c.id, "name": c.name} for c in items], "count": len(items)}


@router.get("/receipts")
def list_receipts(
    limit: int = Query(default=50, ge=1, le=200),
    apartment_id: str | None = Query(default=None),
    year: str | None = Query(default=None),
    status: str | None = Query(default=None),
    category_id: str | None = Query(default=None),
    repository: ReceiptRepository = Depends(get_repository),
):
    if apartment_id is not None and repository.get_apartment(apartment_id) is None:
        raise HTTPException(status_code=422, detail="Unknown apartment.")

    year_value, undated = _parse_year_filter(year)

    if status is not None and status not in (ReceiptStatus.NEEDS_REVIEW, ReceiptStatus.APPROVED):
        raise HTTPException(status_code=422, detail="status must be 'needs_review' or 'approved'.")

    no_category = category_id == NONE_FILTER_VALUE
    category_id_value: str | None = None
    if category_id is not None and not no_category:
        if repository.get_category(category_id) is None:
            raise HTTPException(status_code=422, detail="Unknown category.")
        category_id_value = category_id

    items = repository.list_receipts(
        limit,
        apartment_id=apartment_id,
        year=year_value,
        undated=undated,
        status=status,
        category_id=category_id_value,
        no_category=no_category,
    )
    return {"items": [item.model_dump() for item in items], "count": len(items)}


@router.get("/receipts/facets")
def get_receipt_facets(
    apartment_id: str | None = Query(default=None),
    repository: ReceiptRepository = Depends(get_repository),
):
    # Registered BEFORE GET /receipts/{receipt_id} below so "facets" is
    # never swallowed by that path's {receipt_id} segment.
    if apartment_id is not None and repository.get_apartment(apartment_id) is None:
        raise HTTPException(status_code=422, detail="Unknown apartment.")

    facets = repository.get_receipt_facets(apartment_id=apartment_id)
    return facets.model_dump()


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
    except (ExtractionError, ExtractionUnavailableError) as exc:
        elapsed_seconds = time.perf_counter() - started_at
        # The chained cause (e.g. the real OpenAI SDK exception) carries the
        # actual diagnostic detail; it is logged server-side only and never
        # included in the HTTP response, which stays generic either way.
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
        if isinstance(exc, ExtractionUnavailableError):
            # The AI service itself is not usable (bad key, no credit, model
            # not available, rate limit) -- distinct from the receipt being
            # unreadable, so callers don't waste time debugging the image.
            raise HTTPException(
                status_code=503,
                detail=(
                    "The AI service is not available (not configured or out of "
                    "credit). Check the server configuration."
                ),
            )
        raise HTTPException(status_code=502, detail="Receipt extraction failed. Please try again.")

    # The first save copies the upload's chosen apartment onto the receipt;
    # a re-extract (the repository's ON CONFLICT branch) leaves whatever is
    # already stored there untouched. No uploads row at all -> None.
    upload = repository.get_upload(receipt_id)
    apartment_id_for_save = upload.apartment_id if upload is not None else None

    try:
        repository.save_receipt(receipt_id, data, apartment_id=apartment_id_for_save)
    except Exception:
        # Never tell the client the receipt was saved when it was not; the
        # real cause (never the API key or file contents) is logged for
        # developers only.
        logger.exception("Failed to save extracted receipt: receipt_id=%s", receipt_id)
        raise HTTPException(
            status_code=500,
            detail="Could not save the extracted receipt. Please try again.",
        )

    # Re-fetch rather than re-deriving: the receipt's true stored
    # apartment_id (kept as-is on a re-extract) and its name both come from
    # the same join get_receipt() already does, so there's one source of
    # truth instead of duplicating that lookup here.
    saved = repository.get_receipt(receipt_id)

    # A fresh extraction always clears any prior edit (save_receipt sets
    # edited_at to NULL), so these are deterministic here without relying
    # on `saved` for them.
    return {
        "receipt_id": receipt_id,
        **data.model_dump(),
        "warnings": _warnings_payload(data),
        "edited": False,
        "edited_at": None,
        "apartment_id": saved.apartment_id if saved else None,
        "apartment_name": saved.apartment_name if saved else None,
        "category_id": saved.category_id if saved else None,
        "category_name": saved.category_name if saved else None,
        "status": saved.status if saved else ReceiptStatus.NEEDS_REVIEW,
    }


@router.get("/receipts/{receipt_id}")
def get_receipt(receipt_id: str, repository: ReceiptRepository = Depends(get_repository)):
    try:
        validated_id = uuid.UUID(receipt_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="receipt_id must be a valid UUID.")

    saved = repository.get_receipt(str(validated_id))
    if saved is None:
        raise HTTPException(status_code=404, detail="Receipt not found.")

    return {**saved.model_dump(), "warnings": _warnings_payload(saved)}


@router.get("/receipts/{receipt_id}/file")
def get_receipt_file(receipt_id: str, repository: ReceiptRepository = Depends(get_repository)):
    try:
        validated_id = uuid.UUID(receipt_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="receipt_id must be a valid UUID.")

    # A saved (extracted) receipt must exist -- same lookup as GET
    # /receipts/{id} -- so an unknown id or one that was uploaded but never
    # extracted behaves the same way as that endpoint.
    existing = repository.get_receipt(str(validated_id))
    if existing is None:
        raise HTTPException(status_code=404, detail="Receipt not found.")

    file_path = find_file(validated_id)
    if file_path is None:
        logger.warning("Receipt file missing on disk: receipt_id=%s", receipt_id)
        raise HTTPException(status_code=404, detail="Receipt file not found.")

    media_type = media_type_for_extension(file_path.suffix)
    if media_type is None:
        logger.warning(
            "Stored receipt file has no mapped media type: receipt_id=%s extension=%s",
            receipt_id,
            file_path.suffix,
        )
        raise HTTPException(status_code=404, detail="Receipt file not found.")

    return FileResponse(
        file_path,
        media_type=media_type,
        headers={
            "X-Content-Type-Options": "nosniff",
            "Content-Disposition": "inline",
            "Cache-Control": "private, no-cache",
        },
    )


@router.put("/receipts/{receipt_id}")
def update_receipt(
    receipt_id: str,
    update: ReceiptUpdate,
    repository: ReceiptRepository = Depends(get_repository),
):
    try:
        validated_id = uuid.UUID(receipt_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="receipt_id must be a valid UUID.")

    try:
        saved = repository.update_receipt(str(validated_id), update)
    except Exception:
        # Never tell the client the correction was saved when it was not;
        # the real cause (never the API key or file contents) is logged for
        # developers only.
        logger.exception("Failed to update receipt: receipt_id=%s", receipt_id)
        raise HTTPException(
            status_code=500,
            detail="Could not save the updated receipt. Please try again.",
        )

    if saved is None:
        raise HTTPException(status_code=404, detail="Receipt not found.")

    return {**saved.model_dump(), "warnings": _warnings_payload(saved)}


@router.post("/receipts/{receipt_id}/reset")
def reset_receipt(receipt_id: str, repository: ReceiptRepository = Depends(get_repository)):
    try:
        validated_id = uuid.UUID(receipt_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="receipt_id must be a valid UUID.")

    try:
        saved = repository.reset_receipt(str(validated_id))
    except Exception:
        # Never tell the client the reset happened when it did not; the
        # real cause (never the API key or file contents) is logged for
        # developers only.
        logger.exception("Failed to reset receipt: receipt_id=%s", receipt_id)
        raise HTTPException(
            status_code=500,
            detail="Could not reset the receipt. Please try again.",
        )

    if saved is None:
        raise HTTPException(status_code=404, detail="Receipt not found.")

    return {**saved.model_dump(), "warnings": _warnings_payload(saved)}


@router.put("/receipts/{receipt_id}/apartment")
def update_receipt_apartment(
    receipt_id: str,
    assignment: ApartmentAssignment,
    repository: ReceiptRepository = Depends(get_repository),
):
    try:
        validated_id = uuid.UUID(receipt_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="receipt_id must be a valid UUID.")

    existing = repository.get_receipt(str(validated_id))
    if existing is None:
        raise HTTPException(status_code=404, detail="Receipt not found.")

    apartment = repository.get_apartment(assignment.apartment_id)
    if apartment is None:
        raise HTTPException(status_code=422, detail="Unknown apartment.")
    if not apartment.active:
        raise HTTPException(status_code=422, detail="This apartment is no longer active.")

    try:
        saved = repository.set_receipt_apartment(str(validated_id), assignment.apartment_id)
    except Exception:
        # Never tell the client the apartment changed when it did not; the
        # real cause is logged for developers only.
        logger.exception("Failed to update receipt apartment: receipt_id=%s", receipt_id)
        raise HTTPException(
            status_code=500,
            detail="Could not update the apartment. Please try again.",
        )

    if saved is None:
        raise HTTPException(status_code=404, detail="Receipt not found.")

    return {**saved.model_dump(), "warnings": _warnings_payload(saved)}


@router.put("/receipts/{receipt_id}/category")
def update_receipt_category(
    receipt_id: str,
    assignment: CategoryAssignment,
    repository: ReceiptRepository = Depends(get_repository),
):
    try:
        validated_id = uuid.UUID(receipt_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="receipt_id must be a valid UUID.")

    existing = repository.get_receipt(str(validated_id))
    if existing is None:
        raise HTTPException(status_code=404, detail="Receipt not found.")

    category = repository.get_category(assignment.category_id)
    if category is None:
        raise HTTPException(status_code=422, detail="Unknown category.")
    if not category.active:
        raise HTTPException(status_code=422, detail="This category is no longer active.")

    try:
        saved = repository.set_receipt_category(str(validated_id), assignment.category_id)
    except Exception:
        # Never tell the client the category changed when it did not; the
        # real cause is logged for developers only.
        logger.exception("Failed to update receipt category: receipt_id=%s", receipt_id)
        raise HTTPException(
            status_code=500,
            detail="Could not update the category. Please try again.",
        )

    if saved is None:
        raise HTTPException(status_code=404, detail="Receipt not found.")

    return {**saved.model_dump(), "warnings": _warnings_payload(saved)}


@router.put("/receipts/{receipt_id}/status")
def update_receipt_status(
    receipt_id: str,
    assignment: StatusAssignment,
    repository: ReceiptRepository = Depends(get_repository),
):
    try:
        validated_id = uuid.UUID(receipt_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="receipt_id must be a valid UUID.")

    existing = repository.get_receipt(str(validated_id))
    if existing is None:
        raise HTTPException(status_code=404, detail="Receipt not found.")

    # Setting 'needs_review' is always allowed; data-quality warnings never
    # block approval either -- the user makes the final call either way.
    if assignment.status == ReceiptStatus.APPROVED:
        missing = _missing_approval_fields(existing)
        if missing:
            raise HTTPException(
                status_code=422,
                detail={
                    "message": "This receipt is missing required information before it can be approved.",
                    "missing": missing,
                },
            )

    try:
        saved = repository.set_receipt_status(str(validated_id), assignment.status)
    except Exception:
        # Never tell the client the status changed when it did not; the
        # real cause is logged for developers only.
        logger.exception("Failed to update receipt status: receipt_id=%s", receipt_id)
        raise HTTPException(
            status_code=500,
            detail="Could not update the status. Please try again.",
        )

    if saved is None:
        raise HTTPException(status_code=404, detail="Receipt not found.")

    return {**saved.model_dump(), "warnings": _warnings_payload(saved)}


@router.delete("/receipts/{receipt_id}", status_code=204)
def delete_receipt(receipt_id: str, repository: ReceiptRepository = Depends(get_repository)):
    try:
        validated_id = uuid.UUID(receipt_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="receipt_id must be a valid UUID.")

    # (a) confirm the receipt exists -- nothing on disk or in the database
    # is touched if it doesn't (unknown id, or uploaded but never extracted).
    existing = repository.get_receipt(str(validated_id))
    if existing is None:
        raise HTTPException(status_code=404, detail="Receipt not found.")

    # (b) remove the file first: if this fails, the database is left
    # untouched so a retry can still finish the job.
    try:
        delete_file(validated_id)
    except Exception:
        logger.exception("Failed to remove file for receipt: receipt_id=%s", receipt_id)
        raise HTTPException(
            status_code=500,
            detail="Could not delete the receipt. Please try again.",
        )

    # (c) remove the database rows. If this fails, the file is already
    # gone; a retry will find no file (a no-op) and can still succeed.
    try:
        repository.delete_receipt(str(validated_id))
    except Exception:
        logger.exception("Failed to remove database record for receipt: receipt_id=%s", receipt_id)
        raise HTTPException(
            status_code=500,
            detail="Could not delete the receipt. Please try again.",
        )

    return None
