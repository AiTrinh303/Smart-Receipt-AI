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


class ReceiptStatus:
    """String constants, not an Enum, so they serialize as plain strings in
    every response without any extra JSON-schema machinery."""

    NEEDS_REVIEW = "needs_review"
    APPROVED = "approved"


ALLOWED_RECEIPT_STATUSES = (ReceiptStatus.NEEDS_REVIEW, ReceiptStatus.APPROVED)


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
    status: str


class ApartmentFacet(BaseModel):
    """One row of GET /receipts/facets's `apartments` list -- the count is
    always every receipt for that apartment, regardless of any filter."""

    id: str
    name: str
    count: int


class LineItemRow(BaseModel):
    """One flattened row of GET /items -- one purchased line item, with
    enough of its receipt's context to filter, display, and open the
    original. Built by domain.rules.flatten_line_items; never stored."""

    receipt_id: str
    line_index: int
    name: str | None
    quantity: float | None
    unit_price: float | None
    line_total: float | None
    currency: str | None
    purchase_date: str | None
    store_name: str | None
    apartment_id: str | None
    apartment_name: str | None
    status: str


class CurrencyTotal(BaseModel):
    """One currency's total within a yearly report scope (an apartment, a
    month, or the overall combined total) -- `total` is always a decimal
    string, never a float."""

    currency: str
    total: str
    receipt_count: int


class MonthlyBreakdown(BaseModel):
    """One calendar month (1-12) of a yearly report's apartment breakdown
    -- only months that actually had a counted receipt appear."""

    month: int
    by_currency: list[CurrencyTotal]


class ApartmentYearSummary(BaseModel):
    """One apartment's yearly totals -- every active apartment appears
    (even with empty `by_currency`/`months`), in the same `sort_order`
    `list_apartments()` already returns."""

    apartment_id: str
    apartment_name: str
    by_currency: list[CurrencyTotal]
    months: list[MonthlyBreakdown]


class ExcludedCounts(BaseModel):
    """Why a receipt did not end up in any apartment's totals --
    `undated` counts every receipt with no valid date regardless of the
    requested year (a receipt with no date has no year to belong to);
    the other four only count receipts whose date falls in the
    requested year, in the fixed bucket order `summarize_year` applies."""

    undated: int
    not_approved: int
    no_total: int
    no_currency: int
    no_apartment: int


class AttentionReceipt(BaseModel):
    """One counted receipt with at least one data-quality warning,
    surfaced so the owner can fix it before filing -- `purchase_date` is
    already normalized, `total` is a decimal string."""

    receipt_id: str
    store_name: str | None
    purchase_date: str
    total: str
    currency: str
    apartment_id: str
    warning_codes: list[str]


class DuplicateGroup(BaseModel):
    """Two or more counted receipts that share apartment, normalized
    date, store name (casefolded), currency and total -- a likely
    double-entry. Totals are never reduced for this; the owner deletes
    the extra one if it really is a duplicate."""

    receipt_ids: list[str]
    store_name: str
    purchase_date: str
    total: str
    currency: str
    apartment_id: str


class LargestReceipt(BaseModel):
    """One of a currency's largest counted receipts by absolute total."""

    receipt_id: str
    store_name: str | None
    purchase_date: str
    total: str
    apartment_id: str


class CurrencyLargest(BaseModel):
    currency: str
    items: list[LargestReceipt]


class YearlySummary(BaseModel):
    """GET /reports/yearly's response body."""

    year: int
    basis: str
    apartments: list[ApartmentYearSummary]
    overall: list[CurrencyTotal]
    excluded: ExcludedCounts
    with_warnings: int
    counted_unreviewed: int
    attention: list[AttentionReceipt]
    possible_duplicates: list[DuplicateGroup]
    possible_duplicate_groups: int
    largest: list[CurrencyLargest]


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
