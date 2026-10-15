from pathlib import Path
from typing import Protocol

from domain.models import ReceiptData, ReceiptSummary, SavedReceipt, SavedUpload


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
    ) -> None: ...

    def get_upload(self, receipt_id: str) -> SavedUpload | None: ...

    def save_receipt(self, receipt_id: str, data: ReceiptData) -> None: ...

    def get_receipt(self, receipt_id: str) -> SavedReceipt | None: ...

    def list_receipts(self, limit: int) -> list[ReceiptSummary]: ...
