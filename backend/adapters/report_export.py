"""Builds the yearly tax-advisor export ZIP: receipts.csv, summary.csv,
not_included.csv, README.txt and one archive PDF per counted receipt under
documents/<apartment_id>/. A missing file or a conversion failure never
aborts the export -- it is recorded in problems.txt instead. Pure stdlib
(tempfile, zipfile) plus the existing Pillow-based adapters.pdf_archive and
adapters.file_storage -- no new dependency."""

import tempfile
import uuid
import zipfile
from datetime import date, datetime, timezone
from pathlib import Path

from adapters.file_storage import find_file
from adapters.pdf_archive import ArchiveError, make_archive_pdf
from domain.models import Apartment, SavedReceipt, YearlySummary
from domain.report_export import (
    NOT_INCLUDED_HEADERS,
    RECEIPTS_HEADERS,
    SUMMARY_HEADERS,
    counted_receipts,
    not_included_rows,
    readme_text,
    receipts_rows,
    summary_rows,
    to_csv,
)
from domain.rules import archive_filename, normalize_purchase_date, summarize_year


def _pdf_member_name(receipt: SavedReceipt) -> str:
    """The ZIP member path for one counted receipt's archive PDF:
    documents/<apartment_id>/<archive_filename without ".pdf">_<first 8
    chars of the receipt id>.pdf -- the receipt-id suffix keeps two
    receipts with the same store/date/total from colliding. Every part
    archive_filename() builds is already ASCII-only and slash-free; the
    apartment_id directory segment is one of the app's own fixed,
    slug-like ids, never client text."""
    base_name = archive_filename(
        apartment_id=receipt.apartment_id,
        purchase_date=normalize_purchase_date(receipt.purchase_date),
        store_name=receipt.store_name,
        total=receipt.total,
        currency=receipt.currency,
    )
    stem = base_name[: -len(".pdf")] if base_name.endswith(".pdf") else base_name
    file_name = f"{stem}_{receipt.receipt_id[:8]}.pdf"
    return f"documents/{receipt.apartment_id}/{file_name}"


def build_zip(
    receipts: list[SavedReceipt],
    apartments: list[Apartment],
    year: int,
    basis: str,
    style: str,
    apartment_id: str | None,
    today: date,
    upload_dir: Path,
) -> Path:
    """Returns the path of a temporary ZIP file holding the export. The
    caller is responsible for deleting it once the response has been
    sent (e.g. via a FastAPI BackgroundTask)."""
    counted = counted_receipts(receipts, year, basis, apartment_id)

    pdf_paths: dict[str, str] = {}
    problems: list[str] = []

    temp_file = tempfile.NamedTemporaryFile(prefix="smart-receipt-export-", suffix=".zip", delete=False)
    temp_file.close()
    zip_path = Path(temp_file.name)

    upload_dir = upload_dir.resolve()

    with zipfile.ZipFile(zip_path, mode="w", compression=zipfile.ZIP_DEFLATED) as archive:
        for receipt in counted:
            try:
                validated_id = uuid.UUID(receipt.receipt_id)
            except ValueError:
                problems.append(f"{receipt.receipt_id}: invalid receipt id")
                continue

            file_path = find_file(validated_id)
            if file_path is None:
                problems.append(f"{receipt.receipt_id}: receipt file not found")
                continue

            # Defense in depth: file_storage.find_file already restricts the
            # lookup to its own UPLOAD_DIR, but this confirms the resolved
            # path never escapes the uploads folder this export was asked
            # to read from before any bytes are touched.
            if not file_path.resolve().is_relative_to(upload_dir):
                problems.append(f"{receipt.receipt_id}: receipt file not found")
                continue

            try:
                pdf_bytes = make_archive_pdf(file_path)
            except ArchiveError:
                problems.append(f"{receipt.receipt_id}: could not be converted to PDF")
                continue

            member_name = _pdf_member_name(receipt)
            archive.writestr(member_name, pdf_bytes)
            pdf_paths[receipt.receipt_id] = member_name

        summary = summarize_year(receipts, apartments, year, basis, today)
        counts = {
            "counted": len(counted),
            "with_warnings": summary.with_warnings,
            "possible_duplicate_groups": summary.possible_duplicate_groups,
            **summary.excluded.model_dump(),
        }

        receipts_csv = to_csv(
            RECEIPTS_HEADERS[style],
            receipts_rows(receipts, year, basis, style, today, pdf_paths, apartment_id),
            style,
        )
        summary_csv = to_csv(SUMMARY_HEADERS[style], summary_rows(summary, style, apartment_id), style)
        not_included_csv = to_csv(
            NOT_INCLUDED_HEADERS[style],
            not_included_rows(receipts, year, basis, style, apartment_id),
            style,
        )
        readme = readme_text(year, basis, style, datetime.now(timezone.utc), counts)

        archive.writestr("receipts.csv", receipts_csv)
        archive.writestr("summary.csv", summary_csv)
        archive.writestr("not_included.csv", not_included_csv)
        archive.writestr("README.txt", readme)
        if problems:
            archive.writestr("problems.txt", "\n".join(problems) + "\n")

    return zip_path
