from pathlib import Path
from typing import Protocol

from domain.models import (
    Apartment,
    ReceiptData,
    ReceiptFacets,
    ReceiptSummary,
    ReceiptUpdate,
    SavedReceipt,
    SavedUpload,
)


class ExtractionError(Exception):
    """Raised when a receipt's data could not be extracted (e.g. unreadable
    image, timeout, or output that doesn't parse) -- the AI service itself
    is reachable and usable."""


class ExtractionUnavailableError(Exception):
    """Raised when the AI service itself is not usable right now (bad or
    missing API key, no credit, unknown model, rate limited) -- distinct
    from the receipt being unreadable."""


class ReceiptExtractor(Protocol):
    def extract(self, file_path: Path) -> ReceiptData: ...


class ReceiptRepository(Protocol):
    def save_upload(
        self,
        receipt_id: str,
        original_filename: str | None,
        stored_filename: str,
        content_type: str | None,
        apartment_id: str | None = None,
    ) -> None: ...

    def get_upload(self, receipt_id: str) -> SavedUpload | None: ...

    def save_receipt(
        self, receipt_id: str, data: ReceiptData, apartment_id: str | None = None
    ) -> None: ...

    def get_receipt(self, receipt_id: str) -> SavedReceipt | None: ...

    def list_receipts(
        self,
        limit: int,
        offset: int = 0,
        apartment_id: str | None = None,
        year: int | None = None,
        undated: bool = False,
        status: str | None = None,
    ) -> tuple[list[ReceiptSummary], int]: ...

    def update_receipt(self, receipt_id: str, update: ReceiptUpdate) -> SavedReceipt | None: ...

    def reset_receipt(self, receipt_id: str) -> SavedReceipt | None: ...

    def delete_receipt(self, receipt_id: str) -> bool: ...

    def list_apartments(self) -> list[Apartment]: ...

    def get_apartment(self, apartment_id: str) -> Apartment | None: ...

    def set_receipt_apartment(self, receipt_id: str, apartment_id: str) -> SavedReceipt | None: ...

    def set_receipt_status(self, receipt_id: str, status: str) -> SavedReceipt | None: ...

    def get_receipt_facets(self, apartment_id: str | None = None) -> ReceiptFacets: ...

    def list_matching_receipts(
        self,
        apartment_id: str | None = None,
        year: int | None = None,
        undated: bool = False,
        status: str | None = None,
    ) -> list[SavedReceipt]: ...
