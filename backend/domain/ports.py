from pathlib import Path
from typing import Protocol

from domain.models import ReceiptData


class ExtractionError(Exception):
    """Raised when a receipt's data could not be extracted."""


class ReceiptExtractor(Protocol):
    def extract(self, file_path: Path) -> ReceiptData: ...
