from pydantic import BaseModel


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


class SavedUpload(BaseModel):
    receipt_id: str
    original_filename: str | None
    stored_filename: str
    content_type: str | None
    created_at: str


class SavedReceipt(ReceiptData):
    receipt_id: str
    original_filename: str | None
    content_type: str | None
    created_at: str
    updated_at: str


class ReceiptSummary(BaseModel):
    receipt_id: str
    original_filename: str | None
    store_name: str | None
    purchase_date: str | None
    currency: str | None
    total: float | None
    created_at: str
