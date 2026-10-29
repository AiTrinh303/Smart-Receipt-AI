from datetime import date

from pydantic import BaseModel, ConfigDict, Field, field_validator


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


class Apartment(BaseModel):
    id: str
    name: str
    sort_order: int
    active: bool


# Seeded at startup via INSERT OR IGNORE (adapters/sqlite_repository.py), so
# adding or renaming an entry here takes effect on existing databases too
# without a destructive migration -- only a new id is ever inserted.
DEFAULT_APARTMENTS: list[Apartment] = [
    Apartment(
        id="oberaudorf-bergblick",
        name="Fewo JoJo - Oberaudorf - Bergblick",
        sort_order=1,
        active=True,
    ),
    Apartment(
        id="sankt-englmar-waldglueck",
        name="Fewo JoJo - Sankt Englmar - Waldglück",
        sort_order=2,
        active=True,
    ),
]


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
    apartment_id: str | None


class SavedReceipt(ReceiptData):
    receipt_id: str
    original_filename: str | None
    content_type: str | None
    created_at: str
    updated_at: str
    edited: bool
    edited_at: str | None
    apartment_id: str | None
    apartment_name: str | None


class ReceiptWarning(BaseModel):
    """A data-quality warning, computed fresh on every response -- never
    stored. `details` holds decimal strings (e.g. amounts), never floats."""

    code: str
    field: str
    message: str
    details: dict[str, str]


class ReceiptSummary(BaseModel):
    receipt_id: str
    original_filename: str | None
    store_name: str | None
    purchase_date: str | None
    currency: str | None
    total: float | None
    created_at: str
    apartment_id: str | None
    apartment_name: str | None


# --- Editable-field models (user corrections), deliberately separate from
# ReceiptData/LineItem/Discount/Tax above: those parse lenient AI output and
# must stay lenient, while these validate strictly against user input. ---


class LineItemUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1)
    quantity: float | None = Field(strict=True, allow_inf_nan=False, gt=0)
    unit_price: float | None = Field(strict=True, allow_inf_nan=False)
    line_total: float | None = Field(strict=True, allow_inf_nan=False)


class DiscountUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    description: str = Field(min_length=1)
    amount: float | None = Field(strict=True, allow_inf_nan=False)


class TaxUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    description: str = Field(min_length=1)
    amount: float | None = Field(strict=True, allow_inf_nan=False)


class ApartmentAssignment(BaseModel):
    """Body of PUT /receipts/{id}/apartment -- a classification change,
    deliberately its own strict model so changing the apartment can never
    be confused with (or smuggled into) ReceiptUpdate's data-correction
    fields."""

    model_config = ConfigDict(extra="forbid")

    apartment_id: str = Field(min_length=1)


class ReceiptUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    store_name: str | None = Field(max_length=200)
    purchase_date: str | None
    currency: str | None = Field(max_length=10)
    items: list[LineItemUpdate] = Field(max_length=200)
    discounts: list[DiscountUpdate] = Field(max_length=50)
    taxes: list[TaxUpdate] = Field(max_length=50)
    total: float | None = Field(strict=True, allow_inf_nan=False)

    @field_validator("purchase_date")
    @classmethod
    def _validate_purchase_date(cls, value: str | None) -> str | None:
        if value is None:
            return None
        try:
            date.fromisoformat(value)
        except ValueError:
            raise ValueError("purchase_date must be null or a valid ISO date (YYYY-MM-DD).")
        return value
