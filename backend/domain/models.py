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
