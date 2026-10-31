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


class Category(BaseModel):
    id: str
    name: str
    sort_order: int
    active: bool


class ReceiptStatus:
    """String constants, not an Enum, so they serialize as plain strings in
    every response without any extra JSON-schema machinery."""

    NEEDS_REVIEW = "needs_review"
    APPROVED = "approved"


ALLOWED_RECEIPT_STATUSES = (ReceiptStatus.NEEDS_REVIEW, ReceiptStatus.APPROVED)


# Seeded at startup via INSERT OR IGNORE (adapters/sqlite_repository.py), so
# adding, renaming or reordering an entry here takes effect on existing
# databases too without a destructive migration -- only a new id is ever
# inserted. These are PLACEHOLDER categories and must be confirmed with a
# tax advisor before being relied on for an actual filing.
DEFAULT_CATEGORIES: list[Category] = [
    Category(id="cleaning", name="Cleaning and supplies", sort_order=1, active=True),
    Category(id="repairs", name="Repairs and maintenance", sort_order=2, active=True),
    Category(id="furniture", name="Furniture and equipment", sort_order=3, active=True),
    Category(id="linen", name="Linen and textiles", sort_order=4, active=True),
    Category(id="consumables", name="Guest consumables", sort_order=5, active=True),
    Category(id="utilities", name="Utilities and services", sort_order=6, active=True),
    Category(id="garden", name="Garden and outdoor", sort_order=7, active=True),
    Category(id="insurance", name="Insurance and fees", sort_order=8, active=True),
    Category(id="travel", name="Travel and transport", sort_order=9, active=True),
    Category(id="other", name="Other", sort_order=10, active=True),
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
    category_id: str | None
    category_name: str | None
    status: str


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
    category_id: str | None
    category_name: str | None
    status: str


class ApartmentFacet(BaseModel):
    """One row of GET /receipts/facets's `apartments` list -- the count is
    always every receipt for that apartment, regardless of any filter."""

    id: str
    name: str
    count: int


class ReceiptFacets(BaseModel):
    """GET /receipts/facets's response body. `years` is sorted descending
    (newest first, matching the list's own default order); `has_undated`
    and `years` are scoped to `apartment_id` when one was given, but
    `apartments` and `total` are not."""

    apartments: list[ApartmentFacet]
    total: int
    years: list[int]
    has_undated: bool


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


class CategoryAssignment(BaseModel):
    """Body of PUT /receipts/{id}/category -- a classification change,
    deliberately its own strict model, same reasoning as
    ApartmentAssignment above."""

    model_config = ConfigDict(extra="forbid")

    category_id: str = Field(min_length=1)


class StatusAssignment(BaseModel):
    """Body of PUT /receipts/{id}/status -- strict, only the two allowed
    status values."""

    model_config = ConfigDict(extra="forbid")

    status: str = Field(min_length=1)

    @field_validator("status")
    @classmethod
    def _validate_status(cls, value: str) -> str:
        if value not in ALLOWED_RECEIPT_STATUSES:
            raise ValueError("status must be 'needs_review' or 'approved'.")
        return value


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
