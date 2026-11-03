import re
import unicodedata
from datetime import date, timedelta
from decimal import Decimal

from domain.models import LineItemRow, ReceiptData, ReceiptWarning, SavedReceipt

ALLOWED_EXTENSIONS = {".jpg", ".jpeg", ".png", ".pdf"}
ALLOWED_CONTENT_TYPES = {"image/jpeg", "image/png", "application/pdf"}
MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024  # 10 MB


class UnsupportedFileTypeError(Exception):
    """Raised when a file's extension or content type is not an allowed receipt type."""


class EmptyFileError(Exception):
    """Raised when an uploaded file has zero bytes."""


class FileTooLargeError(Exception):
    """Raised when an uploaded file exceeds the maximum allowed size."""


EXTENSION_MEDIA_TYPES = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".pdf": "application/pdf",
}


def media_type_for_extension(extension: str) -> str | None:
    """Maps a stored file's extension to a fixed, trusted media type -- never
    the client-supplied content_type and never sniffed from the file's
    contents, both of which a client could spoof."""
    return EXTENSION_MEDIA_TYPES.get(extension.lower())


def validate_upload(extension: str, content_type: str | None, size_bytes: int) -> None:
    if extension not in ALLOWED_EXTENSIONS or content_type not in ALLOWED_CONTENT_TYPES:
        raise UnsupportedFileTypeError(f"Unsupported file type: {extension}")

    if size_bytes == 0:
        raise EmptyFileError("Uploaded file is empty.")

    if size_bytes > MAX_FILE_SIZE_BYTES:
        raise FileTooLargeError(f"File size {size_bytes} exceeds the maximum of {MAX_FILE_SIZE_BYTES} bytes.")


# --- Date normalization and data-quality warnings -------------------------

# An ISO date optionally followed by exactly one non-digit separator
# (space, "T", comma) and a single trailing token with no further
# whitespace -- e.g. "2025-06-26 11" or "2025-06-26T11:04:00". A second,
# space-separated token ("2025-06-26 11 22") does not match, since that
# looks like more than one stray value, not a single mangled timestamp.
_LEADING_ISO_DATE_PATTERN = re.compile(r"^(\d{4}-\d{2}-\d{2})([ T,][^\s]*)?$")

TOTAL_TOLERANCE = Decimal("0.05")
FUTURE_DATE_GRACE_DAYS = 1


def normalize_purchase_date(raw: str | None) -> str | None:
    """Extracts a valid ISO date (YYYY-MM-DD) from the start of a raw
    AI-extracted date string. Never guesses day/month order for an
    ambiguous format like "26/06/2025" -- that, and any other text that
    doesn't start with an ISO date (or has more than one trailing stray
    token), returns None rather than a guess. Never raises."""
    if raw is None:
        return None

    match = _LEADING_ISO_DATE_PATTERN.match(raw)
    if not match:
        return None

    candidate = match.group(1)
    try:
        date.fromisoformat(candidate)
    except ValueError:
        return None
    return candidate


def _to_decimal(value: float) -> Decimal:
    return Decimal(str(value))


def _format_amount(value: Decimal) -> str:
    return str(value.quantize(Decimal("0.01")))


def _item_amount(item) -> Decimal | None:
    """The best available amount for one line item: its own line_total,
    else quantity x unit_price, else None if neither is usable."""
    if item.line_total is not None:
        return _to_decimal(item.line_total)
    if item.quantity is not None and item.unit_price is not None:
        return _to_decimal(item.quantity) * _to_decimal(item.unit_price)
    return None


def check_receipt(data: ReceiptData, today: date) -> list[ReceiptWarning]:
    """Computes data-quality warnings for a receipt. `today` is injected
    (not datetime.date.today()) so callers -- and tests -- are deterministic.
    Never raises on odd data: null fields, empty lists, negative amounts."""
    warnings: list[ReceiptWarning] = []

    if not data.store_name or not data.store_name.strip():
        warnings.append(
            ReceiptWarning(
                code="MISSING_STORE",
                field="store_name",
                message="The store name is missing.",
                details={},
            )
        )

    if data.purchase_date is None:
        warnings.append(
            ReceiptWarning(
                code="MISSING_DATE",
                field="purchase_date",
                message="The purchase date is missing.",
                details={},
            )
        )
    else:
        normalized_date = normalize_purchase_date(data.purchase_date)
        if normalized_date is None:
            warnings.append(
                ReceiptWarning(
                    code="DATE_NOT_STANDARD",
                    field="purchase_date",
                    message=(
                        f'The date "{data.purchase_date}" is not a standard date. '
                        "Check it against the original."
                    ),
                    details={},
                )
            )
        elif date.fromisoformat(normalized_date) > today + timedelta(days=FUTURE_DATE_GRACE_DAYS):
            warnings.append(
                ReceiptWarning(
                    code="FUTURE_DATE",
                    field="purchase_date",
                    message=f"The date {normalized_date} is in the future. Check it against the original.",
                    details={},
                )
            )

    if data.total is None:
        warnings.append(
            ReceiptWarning(
                code="MISSING_TOTAL",
                field="total",
                message="The total is missing.",
                details={},
            )
        )
    else:
        item_amounts: list[Decimal] = []
        every_item_usable = True
        for item in data.items:
            amount = _item_amount(item)
            if amount is None:
                every_item_usable = False
                break
            item_amounts.append(amount)

        if every_item_usable and item_amounts:
            subtotal = sum(item_amounts, Decimal("0"))
            discounts_total = sum(
                (abs(_to_decimal(d.amount)) for d in data.discounts if d.amount is not None),
                Decimal("0"),
            )
            taxes_total = sum(
                (_to_decimal(t.amount) for t in data.taxes if t.amount is not None),
                Decimal("0"),
            )
            total = _to_decimal(data.total)
            net_of_discounts = subtotal - discounts_total
            tax_added_on_top = net_of_discounts + taxes_total
            tax_already_included = net_of_discounts

            matches_tax_added = abs(total - tax_added_on_top) <= TOTAL_TOLERANCE
            matches_tax_included = abs(total - tax_already_included) <= TOTAL_TOLERANCE

            if not matches_tax_added and not matches_tax_included:
                warnings.append(
                    ReceiptWarning(
                        code="TOTAL_MISMATCH",
                        field="total",
                        message=(
                            f"The total ({_format_amount(total)}) does not match the items, "
                            f"discounts and tax ({_format_amount(net_of_discounts)} + "
                            f"{_format_amount(taxes_total)}). Check it against the original."
                        ),
                        details={
                            "total": _format_amount(total),
                            "subtotal_after_discounts": _format_amount(net_of_discounts),
                            "taxes": _format_amount(taxes_total),
                        },
                    )
                )

    for index, item in enumerate(data.items):
        if item.quantity is None or item.unit_price is None or item.line_total is None:
            continue
        expected = _to_decimal(item.quantity) * _to_decimal(item.unit_price)
        actual = _to_decimal(item.line_total)
        if abs(expected - actual) > TOTAL_TOLERANCE:
            warnings.append(
                ReceiptWarning(
                    code="LINE_MISMATCH",
                    field=f"items[{index}]",
                    message=(
                        f"Item {index + 1}: quantity x unit price ({_format_amount(expected)}) "
                        f"does not match the line total ({_format_amount(actual)}). "
                        "Check it against the original."
                    ),
                    details={
                        "index": str(index),
                        "expected": _format_amount(expected),
                        "actual": _format_amount(actual),
                    },
                )
            )

    return warnings


# --- GET /items: flattening line items and matching a search query --------


def flatten_line_items(saved_receipt: SavedReceipt) -> list[LineItemRow]:
    """Flattens one receipt's line items into LineItemRow rows, in the
    receipt's own item order (line_index 0, 1, 2, ...). purchase_date is
    normalized for display with the same rule get_receipt uses -- a raw,
    unparseable date still shows its extractable leading ISO date, never
    the raw text, unless even that fails. Never computes or converts
    money; nulls stay null."""
    normalized_date = normalize_purchase_date(saved_receipt.purchase_date)
    display_date = normalized_date if normalized_date is not None else saved_receipt.purchase_date

    return [
        LineItemRow(
            receipt_id=saved_receipt.receipt_id,
            line_index=index,
            name=item.name,
            quantity=item.quantity,
            unit_price=item.unit_price,
            line_total=item.line_total,
            currency=saved_receipt.currency,
            purchase_date=display_date,
            store_name=saved_receipt.store_name,
            apartment_id=saved_receipt.apartment_id,
            apartment_name=saved_receipt.apartment_name,
            status=saved_receipt.status,
        )
        for index, item in enumerate(saved_receipt.items)
    ]


# --- Archive PDF filenames -------------------------------------------------

_FILENAME_UNSAFE_PATTERN = re.compile(r"[^a-z0-9.\-]+")
_REPEATED_DASH_PATTERN = re.compile(r"-{2,}")

STORE_NAME_MAX_LENGTH = 40
ARCHIVE_FILENAME_MAX_LENGTH = 120
_ARCHIVE_EXTENSION = ".pdf"


def _slugify(value: str, max_length: int | None = None) -> str:
    """Lowercases, transliterates to ASCII (`"ß"` -> `"ss"`, accents
    stripped via NFKD normalization), and collapses every run of
    characters outside `a-z`/`0-9`/`.`/`-` into a single `-`. Never
    produces CR, LF, quotes, slashes or non-ASCII, whatever the input."""
    value = value.replace("ß", "ss")
    value = unicodedata.normalize("NFKD", value)
    value = value.encode("ascii", "ignore").decode("ascii")
    value = value.lower()
    value = _FILENAME_UNSAFE_PATTERN.sub("-", value)
    value = _REPEATED_DASH_PATTERN.sub("-", value)
    value = value.strip("-")
    if max_length is not None:
        value = value[:max_length].strip("-")
    return value


def archive_filename(
    apartment_id: str | None,
    purchase_date: str | None,
    store_name: str | None,
    total: float | None,
    currency: str | None,
) -> str:
    """Builds a safe, ASCII-only filename for a receipt's archive PDF, e.g.
    "oberaudorf-bergblick_2025-06-26_corner-store_19.99-usd.pdf". Every
    part is slugified independently (via _slugify), so the result never
    contains CR, LF, quotes, slashes or non-ASCII, regardless of input --
    this is the only thing standing between a hostile store name and the
    Content-Disposition header it ends up in. A missing or invalid part
    becomes a fixed placeholder rather than being silently omitted, so the
    filename's shape stays predictable: "no-apartment", "undated",
    "unknown-store", "no-total". `purchase_date` is only used if it is a
    valid ISO date (`date.fromisoformat`); `total` is formatted via
    `Decimal(str(total))` with exactly 2 decimals -- never float
    arithmetic, which could introduce a rounding artifact into the name.
    The whole filename (including the ".pdf" extension) is capped at
    ARCHIVE_FILENAME_MAX_LENGTH characters."""
    apartment_part = _slugify(apartment_id) if apartment_id else ""
    apartment_part = apartment_part or "no-apartment"

    date_part = "undated"
    if purchase_date is not None:
        try:
            date.fromisoformat(purchase_date)
            date_part = purchase_date
        except ValueError:
            date_part = "undated"

    store_part = _slugify(store_name, max_length=STORE_NAME_MAX_LENGTH) if store_name else ""
    store_part = store_part or "unknown-store"

    if total is not None:
        amount = str(Decimal(str(total)).quantize(Decimal("0.01")))
        currency_part = _slugify(currency) if currency else ""
        total_part = _slugify(f"{amount}-{currency_part}" if currency_part else amount)
    else:
        total_part = "no-total"

    name = "_".join([apartment_part, date_part, store_part, total_part])
    name = name[: ARCHIVE_FILENAME_MAX_LENGTH - len(_ARCHIVE_EXTENSION)].rstrip("_-")
    return f"{name}{_ARCHIVE_EXTENSION}"


def matches_query(row: LineItemRow, q: str) -> bool:
    """True if every whitespace-separated word in `q` appears,
    case-insensitively (via `str.casefold()`, not `.lower()`, so non-ASCII
    casing still matches correctly), in the item name or the store name --
    a row with a null item name can still match through the store name
    alone. `q` is expected already trimmed; a blank `q` matches every row,
    though callers should simply skip calling this at all for a blank
    query rather than relying on that."""
    words = q.split()
    if not words:
        return True
    haystack = " ".join(part for part in (row.name, row.store_name) if part).casefold()
    return all(word.casefold() in haystack for word in words)
