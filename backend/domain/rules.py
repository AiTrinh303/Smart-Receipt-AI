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

# A dotted German date, D.M.YYYY or DD.MM.YYYY (1-2 digit day/month, exactly
# 4-digit year, dots only -- a slash or a 2-digit year never matches this),
# optionally followed by one separator (space or comma) and arbitrary extra
# text, e.g. "02.06.2026 11:04". Deliberately narrower than a general
# day-first parser: no slash dates, no 2-digit years, no month names (all
# explicitly out of scope).
_LEADING_DOTTED_DATE_PATTERN = re.compile(r"^(\d{1,2})\.(\d{1,2})\.(\d{4})(?:[ ,].*)?$")

# A month-name date, "D[.]? Month YYYY" / "DD[.]? Month YYYY" (1-2 digit day,
# optional dot right after the day, one or more spaces, a month word, exactly
# 4-digit year), optionally followed by one separator (space or comma) and
# arbitrary extra text -- same trailing-text convention as the dotted and ISO
# patterns above. The month word itself is matched loosely (letters only,
# with an optional trailing dot for an abbreviation like "Mrz.") and resolved
# against MONTH_NAMES_BY_WORD below; an unknown word simply fails that
# lookup, returning None rather than guessing.
_LEADING_MONTH_NAME_DATE_PATTERN = re.compile(
    r"^(\d{1,2})\.?\s+([A-Za-zÄÖÜäöüß]+)\.?\s+(\d{4})(?:[ ,].*)?$"
)

# German and English month names, full and abbreviated, lowercased (matched
# via .casefold() so any input casing works). A handful of abbreviations
# ("jun", "jul", "aug", "sep", "sept", "nov") are identical in both languages
# and already map to the same month number either way, so one combined table
# is all that's needed -- no per-language branching. Kept as a module-level
# constant (not a nested dict/closure) so it's reusable and inspectable.
MONTH_NAMES_BY_WORD = {
    # German full names (both "märz" and the ASCII "maerz" spelling)
    "januar": 1, "februar": 2, "märz": 3, "maerz": 3, "april": 4, "mai": 5,
    "juni": 6, "juli": 7, "august": 8, "september": 9, "oktober": 10,
    "november": 11, "dezember": 12,
    # German abbreviations
    "jan": 1, "feb": 2, "mär": 3, "mrz": 3, "apr": 4, "jun": 6, "jul": 7,
    "aug": 8, "sep": 9, "sept": 9, "okt": 10, "nov": 11, "dez": 12,
    # English full names (september/october/december share the German full
    # names' spelling and value above, so are not repeated here)
    "january": 1, "february": 2, "march": 3, "may": 5, "june": 6, "july": 7,
    # English abbreviations not already covered above
    "mar": 3, "oct": 10,
}

TOTAL_TOLERANCE = Decimal("0.05")
FUTURE_DATE_GRACE_DAYS = 1

# Net-unit-price-vs-gross-line-total tolerance: some German receipts print an
# item's unit price excluding VAT but its line total including VAT (e.g. a
# net 2.23 unit price next to a gross 2.39 line total at 19% VAT). This is a
# second, OR'd allowance alongside TOTAL_TOLERANCE's plain quantity x
# unit_price check -- a real mismatch still warns.
GERMAN_VAT_RATES = (Decimal("0.07"), Decimal("0.19"))
VAT_LINE_TOTAL_TOLERANCE = Decimal("0.02")


def normalize_purchase_date(raw: str | None) -> str | None:
    """Extracts a valid date from the start of a raw AI-extracted date
    string, in one of three accepted shapes: an ISO date (YYYY-MM-DD), a
    dotted German date (D.M.YYYY / DD.MM.YYYY), or a month-name date
    (D[.]? Month YYYY, German or English, full or abbreviated,
    case-insensitive) -- see the patterns above. Never guesses day/month
    order for an ambiguous format like "26/06/2025" -- that, slash dates,
    2-digit years, unknown month words, and any other text that doesn't
    start with one of the three accepted shapes (or has more than one
    trailing stray token, for the ISO shape) all return None rather than a
    guess. Every shape is validated against a real calendar (leap years
    included, via the `date` constructor itself, which raises on an
    out-of-range day/month rather than silently rolling over). Never
    raises."""
    if raw is None:
        return None

    iso_match = _LEADING_ISO_DATE_PATTERN.match(raw)
    if iso_match:
        candidate = iso_match.group(1)
        try:
            date.fromisoformat(candidate)
        except ValueError:
            return None
        return candidate

    dotted_match = _LEADING_DOTTED_DATE_PATTERN.match(raw)
    if dotted_match:
        day, month, year = (int(group) for group in dotted_match.groups())
        try:
            return date(year, month, day).isoformat()
        except ValueError:
            return None

    month_name_match = _LEADING_MONTH_NAME_DATE_PATTERN.match(raw)
    if month_name_match:
        day_text, month_word, year_text = month_name_match.groups()
        month = MONTH_NAMES_BY_WORD.get(month_word.casefold())
        if month is None:
            return None
        try:
            return date(int(year_text), month, int(day_text)).isoformat()
        except ValueError:
            return None

    return None


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
        matches_plain = abs(expected - actual) <= TOTAL_TOLERANCE
        # Some German receipts print a net unit price (excluding VAT) next
        # to a gross line total (including VAT) -- e.g. a 2.23 unit price
        # with a 2.39 line total at 19% VAT. Treat that as consistent too,
        # in addition to the plain match above; a real mismatch still warns.
        matches_vat = any(
            abs(expected * (1 + rate) - actual) <= VAT_LINE_TOTAL_TOLERANCE for rate in GERMAN_VAT_RATES
        )
        if not matches_plain and not matches_vat:
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


DEFAULT_ITEM_SORT = "date_desc"
ALLOWED_ITEM_SORT_VALUES = ("date_desc", "date_asc", "amount_desc", "amount_asc", "store")


def sort_line_items(rows: list[LineItemRow], sort: str) -> list[LineItemRow]:
    """Sorts flattened GET /items rows. `rows` is expected already in the
    tie-break order (receipt created_at DESC, receipt_id ASC, line_index
    ASC -- the order list_matching_receipts/flatten_line_items naturally
    produce); Python's sort is stable, so sorting by just the primary
    criterion below reproduces that full tie-break order for free among
    rows that share the same primary key, without re-stating it.

    - "date_desc"/"date_asc": by the row's normalized purchase date;
      receipts without a valid date always sort LAST, in both directions
      (never interleaved by falling back to e.g. the raw text).
    - "amount_desc"/"amount_asc": by `line_total`, compared as
      `Decimal(str(value))` -- never a raw float; a null `line_total`
      always sorts last, in both directions. Mixed currencies are
      compared by number only (a deliberate simplification -- no currency
      conversion here).
    - "store": store name, `casefold()`-ed, A-Z; a null store name sorts
      last.
    """
    if sort == "store":
        undated = [row for row in rows if row.store_name is None]
        named = [row for row in rows if row.store_name is not None]
        named.sort(key=lambda row: row.store_name.casefold())
        return named + undated

    if sort in ("amount_desc", "amount_asc"):
        with_amount = [row for row in rows if row.line_total is not None]
        without_amount = [row for row in rows if row.line_total is None]
        with_amount.sort(key=lambda row: Decimal(str(row.line_total)), reverse=(sort == "amount_desc"))
        return with_amount + without_amount

    # "date_desc" (default) / "date_asc"
    dated = [row for row in rows if normalize_purchase_date(row.purchase_date) is not None]
    undated = [row for row in rows if normalize_purchase_date(row.purchase_date) is None]
    dated.sort(key=lambda row: normalize_purchase_date(row.purchase_date), reverse=(sort == "date_desc"))
    return dated + undated
