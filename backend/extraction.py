import base64
from pathlib import Path
from typing import Protocol

from openai import OpenAI
from pydantic import BaseModel

REQUEST_TIMEOUT_SECONDS = 60

# PDFs are sent as native file input (not rendered to an image first): the
# configured model is a vision-capable "and later" model per OpenAI's docs,
# which support extracting both text and page images directly from a PDF.
MIME_TYPES_BY_EXTENSION = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".pdf": "application/pdf",
}

EXTRACTION_INSTRUCTIONS = (
    "You are a receipt data extraction assistant. Extract only the information "
    "that is visibly printed on the receipt image or document provided. "
    "If a field is not visible on the receipt or you are not sure about its "
    "value, set it to null (or an empty list for the items/discounts/taxes "
    "lists). Never guess or invent values that are not present on the receipt."
)


class LineItem(BaseModel):
    name: str | None
    quantity: float | None
    unit_price: float | None
    line_total: float | None


class Discount(BaseModel):
    description: str | None
    amount: float | None


class Tax(BaseModel):
    description: str | None
    amount: float | None


class ReceiptData(BaseModel):
    store_name: str | None
    purchase_date: str | None
    currency: str | None
    items: list[LineItem]
    discounts: list[Discount]
    taxes: list[Tax]
    total: float | None


class ExtractionError(Exception):
    """Raised when a receipt's data could not be extracted."""


class ReceiptExtractor(Protocol):
    def extract(self, file_path: Path) -> ReceiptData: ...


class OpenAIReceiptExtractor:
    def __init__(self, api_key: str, model: str):
        self._client = OpenAI(api_key=api_key, timeout=REQUEST_TIMEOUT_SECONDS)
        self._model = model

    def extract(self, file_path: Path) -> ReceiptData:
        extension = file_path.suffix.lower()
        mime_type = MIME_TYPES_BY_EXTENSION.get(extension)
        if mime_type is None:
            raise ExtractionError(f"Unsupported file type for extraction: {extension}")

        encoded = base64.b64encode(file_path.read_bytes()).decode("utf-8")
        data_uri = f"data:{mime_type};base64,{encoded}"

        if extension == ".pdf":
            file_content = {
                "type": "input_file",
                "filename": file_path.name,
                "file_data": data_uri,
            }
        else:
            file_content = {"type": "input_image", "image_url": data_uri}

        try:
            response = self._client.responses.parse(
                model=self._model,
                instructions=EXTRACTION_INSTRUCTIONS,
                input=[
                    {
                        "role": "user",
                        "content": [
                            file_content,
                            {
                                "type": "input_text",
                                "text": "Extract the structured receipt data from this document.",
                            },
                        ],
                    }
                ],
                text_format=ReceiptData,
            )
        except Exception as exc:
            # Provider errors, timeouts, and unparseable output are all
            # collapsed into one error here; the endpoint maps this to a
            # generic 502 without leaking the raw provider error or the key.
            raise ExtractionError("Receipt extraction failed.") from exc

        parsed = response.output_parsed
        if parsed is None:
            raise ExtractionError("Receipt extraction returned no parsable data.")

        return parsed
