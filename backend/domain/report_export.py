"""Pure CSV-building logic for the yearly tax-advisor export (GET
/reports/yearly/export.csv and .zip). No file I/O, no PDF generation --
those live in adapters/report_export.py. Only the standard library's csv
and io modules are used here, alongside the existing domain.rules helpers.
"""

import csv
import io
from datetime import datetime
from decimal import ROUND_HALF_UP, Decimal

from domain.models import SavedReceipt, YearlySummary
from domain.rules import (
    EXCLUDED_BUCKETS,
    check_receipt,
    classify_receipt,
)
from domain.rules import normalize_purchase_date as _normalize_purchase_date

STYLES = ("excel_de", "plain")
DEFAULT_EXPORT_STYLE = "excel_de"

_BOM = "﻿"

# Leading characters that, in Excel/Sheets, could be read as the start of a
# formula -- a classic CSV/formula-injection vector. Prefixing a single
# quote neutralizes it without changing what a human sees (Excel shows the
# quote only in the formula bar, not the cell).
_DANGEROUS_LEADING_CHARS = ("=", "+", "-", "@", "\t", "\r")

RECEIPTS_HEADERS = {
    "excel_de": [
        "Nr", "Datum", "Geschäft", "Wohnung", "Währung", "Betrag brutto",
        "Status", "Bearbeitet", "Warnungen", "PDF", "Quelldatei", "Beleg-ID",
    ],
    "plain": [
        "No", "Date", "Store", "Apartment", "Currency", "Amount gross",
        "Status", "Edited", "Warnings", "PDF", "Source file", "Receipt ID",
    ],
}

NOT_INCLUDED_HEADERS = {
    "excel_de": ["Nr", "Datum", "Geschäft", "Wohnung", "Währung", "Betrag", "Status", "Grund", "Beleg-ID"],
    "plain": ["No", "Date", "Store", "Apartment", "Currency", "Amount", "Status", "Reason", "Receipt ID"],
}

SUMMARY_HEADERS = {
    "excel_de": ["Wohnung", "Währung", "Anzahl Belege", "Summe"],
    "plain": ["Apartment", "Currency", "Receipt count", "Total"],
}

_BOTH_APARTMENTS_LABEL = {"excel_de": "Beide Wohnungen", "plain": "Both apartments"}

_STATUS_LABELS = {
    "excel_de": {"approved": "geprüft", "needs_review": "nicht geprüft"},
    "plain": {"approved": "approved", "needs_review": "not reviewed"},
}

_EDITED_LABELS = {
    "excel_de": {True: "ja", False: "nein"},
    "plain": {True: "yes", False: "no"},
}

_REASON_LABELS = {
    "excel_de": {
        "undated": "Kein gültiges Datum",
        "not_approved": "Nicht geprüft",
        "no_total": "Kein Betrag",
        "no_currency": "Keine Währung",
        "no_apartment": "Keine Wohnung zugeordnet",
    },
    "plain": {
        "undated": "No valid date",
        "not_approved": "Not approved",
        "no_total": "No amount",
        "no_currency": "No currency",
        "no_apartment": "No apartment assigned",
    },
}


def format_amount(value: Decimal, style: str) -> str:
    """Quantizes `value` to 2 decimal places (ROUND_HALF_UP -- the same
    rounding rule the yearly report itself uses), renders it with str()
    (no thousands separator), and for excel_de replaces the decimal point
    with a comma. `value` must already be a Decimal -- never a float."""
    text = str(value.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP))
    if style == "excel_de":
        text = text.replace(".", ",")
    return text


def sanitize_cell(text: str | None) -> str:
    """For TEXT cells only (store name, source file name, apartment name)
    -- never a numeric/amount column. None becomes "". A value starting
    with "=", "+", "-", "@", a TAB, or a CR is prefixed with a single
    quote, the standard mitigation against a spreadsheet application
    reading the cell as a formula."""
    if text is None:
        return ""
    if text.startswith(_DANGEROUS_LEADING_CHARS):
        return "'" + text
    return text


def _format_date_for_style(iso_date: str, style: str) -> str:
    if style == "excel_de":
        year, month, day = iso_date.split("-")
        return f"{day}.{month}.{year}"
    return iso_date


def counted_receipts(
    receipts: list[SavedReceipt], year: int, basis: str, apartment_id: str | None = None
) -> list[SavedReceipt]:
    """Every receipt that classify_receipt buckets as "counted" for
    `year`/`basis`, optionally restricted to one apartment first (so a
    receipt with no apartment is excluded by the filter itself, never by
    classify_receipt). Shared by receipts_rows, the ZIP builder's PDF
    generation loop, and the API's MAX_EXPORT_RECEIPTS check, so all three
    agree on exactly the same set of receipts."""
    scoped = [r for r in receipts if apartment_id is None or r.apartment_id == apartment_id]
    return [r for r in scoped if classify_receipt(r, year, basis) == "counted"]


def _sort_key(receipt: SavedReceipt) -> tuple[str, str, str]:
    normalized_date = _normalize_purchase_date(receipt.purchase_date) or ""
    return (normalized_date, (receipt.store_name or "").casefold(), receipt.receipt_id)


def receipts_rows(
    receipts: list[SavedReceipt],
    year: int,
    basis: str,
    style: str,
    today,
    pdf_paths: dict[str, str],
    apartment_id: str | None = None,
) -> list[list[str]]:
    """The rows for counted receipts, ordered by normalized purchase date
    ascending, then store name (casefolded), then receipt_id. `pdf_paths`
    maps a receipt_id to its relative path inside the ZIP (built by
    adapters.report_export.build_zip); a receipt missing from it gets an
    empty PDF column. The amount is the working-copy total as printed
    (gross) -- no total row."""
    counted = sorted(counted_receipts(receipts, year, basis, apartment_id), key=_sort_key)

    rows: list[list[str]] = []
    for index, receipt in enumerate(counted, start=1):
        normalized_date = _normalize_purchase_date(receipt.purchase_date)
        warnings = check_receipt(receipt, today)
        status_labels = _STATUS_LABELS[style]
        rows.append(
            [
                str(index),
                _format_date_for_style(normalized_date, style) if normalized_date else "",
                sanitize_cell(receipt.store_name),
                sanitize_cell(receipt.apartment_name),
                receipt.currency or "",
                format_amount(Decimal(str(receipt.total)), style),
                status_labels.get(receipt.status, receipt.status),
                _EDITED_LABELS[style][bool(receipt.edited)],
                " ".join(warning.code for warning in warnings),
                pdf_paths.get(receipt.receipt_id, ""),
                sanitize_cell(receipt.original_filename),
                receipt.receipt_id,
            ]
        )
    return rows


def not_included_rows(
    receipts: list[SavedReceipt],
    year: int,
    basis: str,
    style: str,
    apartment_id: str | None = None,
) -> list[list[str]]:
    """Receipts whose bucket is undated, not_approved, no_total,
    no_currency or no_apartment (never other_year or counted). An undated
    receipt has no year of its own, so it appears in every year's
    not_included.csv -- see README.txt. Ordered by exclusion reason (the
    same fixed order classify_receipt checks them in), then normalized
    date, store (casefolded), receipt_id."""
    scoped = [r for r in receipts if apartment_id is None or r.apartment_id == apartment_id]
    classified = [(r, classify_receipt(r, year, basis)) for r in scoped]
    excluded = [(r, bucket) for r, bucket in classified if bucket in EXCLUDED_BUCKETS]
    excluded.sort(key=lambda pair: (EXCLUDED_BUCKETS.index(pair[1]), *_sort_key(pair[0])))

    status_labels = _STATUS_LABELS[style]
    reason_labels = _REASON_LABELS[style]

    rows: list[list[str]] = []
    for index, (receipt, bucket) in enumerate(excluded, start=1):
        normalized_date = _normalize_purchase_date(receipt.purchase_date)
        rows.append(
            [
                str(index),
                _format_date_for_style(normalized_date, style) if normalized_date else "",
                sanitize_cell(receipt.store_name),
                sanitize_cell(receipt.apartment_name),
                receipt.currency or "",
                format_amount(Decimal(str(receipt.total)), style) if receipt.total is not None else "",
                status_labels.get(receipt.status, receipt.status),
                reason_labels[bucket],
                receipt.receipt_id,
            ]
        )
    return rows


def summary_rows(summary: YearlySummary, style: str, apartment_id: str | None = None) -> list[list[str]]:
    """One row per apartment and currency, plus a "Both apartments" row
    per currency from the overall totals -- only when no apartment filter
    is active. Reuses the numbers summarize_year already computed
    (`summary`); never recomputes money differently."""
    apartments = summary.apartments
    if apartment_id is not None:
        apartments = [a for a in apartments if a.apartment_id == apartment_id]

    rows: list[list[str]] = []
    for apartment in apartments:
        for currency_total in apartment.by_currency:
            rows.append(
                [
                    sanitize_cell(apartment.apartment_name),
                    currency_total.currency,
                    str(currency_total.receipt_count),
                    format_amount(Decimal(currency_total.total), style),
                ]
            )

    if apartment_id is None:
        for currency_total in summary.overall:
            rows.append(
                [
                    _BOTH_APARTMENTS_LABEL[style],
                    currency_total.currency,
                    str(currency_total.receipt_count),
                    format_amount(Decimal(currency_total.total), style),
                ]
            )

    return rows


def to_csv(headers: list[str], rows: list[list[str]], style: str) -> str:
    """Renders `headers` + `rows` as CSV text using the csv module --
    QUOTE_MINIMAL, "\\r\\n" line endings, ";" delimiter for excel_de
    (with a leading UTF-8 BOM) or "," for plain (no BOM)."""
    buffer = io.StringIO()
    delimiter = ";" if style == "excel_de" else ","
    writer = csv.writer(buffer, delimiter=delimiter, lineterminator="\r\n", quoting=csv.QUOTE_MINIMAL)
    writer.writerow(headers)
    writer.writerows(rows)
    text = buffer.getvalue()
    return (_BOM + text) if style == "excel_de" else text


def readme_text(
    year: int,
    basis: str,
    style: str,
    generated_at: datetime,
    counts: dict[str, int],
) -> str:
    """Short plain text (German for excel_de, English for plain)
    explaining what each file in the ZIP is, that amounts are the totals
    printed on the receipts including VAT and not tax advice, that
    possible duplicates are still counted, that undated receipts are
    listed in not_included.csv for every year, the basis used, the
    generation time (UTC) and the counts."""
    generated_text = generated_at.strftime("%Y-%m-%d %H:%M")

    if style == "excel_de":
        basis_text = "alle Belege" if basis == "all" else "nur geprüfte Belege"
        return (
            f"Smart Receipt AI – Jahresexport {year}\n"
            "\n"
            "Dateien in diesem ZIP:\n"
            f"- receipts.csv: eine Zeile pro gezähltem Beleg für {year} (Basis: {basis_text}).\n"
            "- summary.csv: Summen pro Wohnung und Währung.\n"
            "- not_included.csv: Belege, die nicht in receipts.csv/summary.csv gezählt wurden, "
            "mit Grund. Belege ohne gültiges Datum erscheinen hier in jedem Jahr, da sie keinem "
            "Jahr zugeordnet werden können.\n"
            "- documents/<Wohnung>/<Datei>.pdf: die Original-Belege als PDF.\n"
            "\n"
            "Die Beträge sind die auf den Belegen aufgedruckten Bruttobeträge (inkl. MwSt.) und "
            "keine Steuerberatung. Bitte den Steuerberater fragen, wie sie zu verwenden sind.\n"
            "Mögliche Duplikate werden weiterhin vollständig mitgezählt, bis der Eigentümer einen "
            "der Belege löscht.\n"
            "\n"
            f"Basis: {basis_text}\n"
            f"Erstellt am: {generated_text} UTC\n"
            "\n"
            f"Anzahl gezählter Belege: {counts.get('counted', 0)}\n"
            f"Belege mit Warnungen: {counts.get('with_warnings', 0)}\n"
            f"Mögliche Duplikatgruppen: {counts.get('possible_duplicate_groups', 0)}\n"
            f"Nicht gezählt - ohne gültiges Datum: {counts.get('undated', 0)}\n"
            f"Nicht gezählt - nicht geprüft: {counts.get('not_approved', 0)}\n"
            f"Nicht gezählt - ohne Betrag: {counts.get('no_total', 0)}\n"
            f"Nicht gezählt - ohne Währung: {counts.get('no_currency', 0)}\n"
            f"Nicht gezählt - ohne Wohnung: {counts.get('no_apartment', 0)}\n"
        )

    basis_text = "all receipts" if basis == "all" else "only approved receipts"
    return (
        f"Smart Receipt AI - yearly export {year}\n"
        "\n"
        "Files in this ZIP:\n"
        f"- receipts.csv: one row per counted receipt for {year} (basis: {basis_text}).\n"
        "- summary.csv: totals per apartment and currency.\n"
        "- not_included.csv: receipts that were not counted in receipts.csv/summary.csv, with a "
        "reason. Receipts without a valid date appear here for every year, since they cannot be "
        "assigned to one.\n"
        "- documents/<apartment>/<file>.pdf: the original receipts as PDF.\n"
        "\n"
        "Amounts are the gross totals printed on the receipts (including VAT) and are not tax "
        "advice. Ask your tax advisor how to use them.\n"
        "Possible duplicates are still fully counted until the owner deletes one of the "
        "receipts.\n"
        "\n"
        f"Basis: {basis_text}\n"
        f"Generated at: {generated_text} UTC\n"
        "\n"
        f"Counted receipts: {counts.get('counted', 0)}\n"
        f"Receipts with warnings: {counts.get('with_warnings', 0)}\n"
        f"Possible duplicate groups: {counts.get('possible_duplicate_groups', 0)}\n"
        f"Not counted - no valid date: {counts.get('undated', 0)}\n"
        f"Not counted - not approved: {counts.get('not_approved', 0)}\n"
        f"Not counted - no amount: {counts.get('no_total', 0)}\n"
        f"Not counted - no currency: {counts.get('no_currency', 0)}\n"
        f"Not counted - no apartment: {counts.get('no_apartment', 0)}\n"
    )
