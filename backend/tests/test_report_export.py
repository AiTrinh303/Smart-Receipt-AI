"""Covers domain.report_export (pure CSV building), adapters.report_export
(ZIP building, real PDF generation) and the two GET /reports/yearly/export.*
routes. Temp db and temp uploads dir only, FakeExtractor-style direct saves
(no real OpenAI call) -- never the real database or uploads folder."""

import csv
import io
import uuid
import zipfile
from datetime import date
from decimal import Decimal

import pytest
from fastapi.testclient import TestClient
from PIL import Image

import adapters.file_storage as file_storage
import api.routes as routes
import main
from adapters.sqlite_repository import SqliteReceiptRepository
from api.routes import get_repository
from domain.models import Apartment, ReceiptData, StatusAssignment
from domain.report_export import format_amount, not_included_rows, receipts_rows, sanitize_cell, summary_rows, to_csv
from domain.rules import classify_receipt

client = TestClient(main.app)

OBERAUDORF = "oberaudorf-bergblick"
WALDGLUECK = "sankt-englmar-waldglueck"
TODAY = date(2026, 6, 1)


@pytest.fixture(autouse=True)
def temp_upload_dir(tmp_path_factory, monkeypatch):
    upload_dir = tmp_path_factory.mktemp("uploads")
    monkeypatch.setattr(file_storage, "UPLOAD_DIR", upload_dir)
    return upload_dir


@pytest.fixture(autouse=True)
def temp_repository(tmp_path_factory):
    db_dir = tmp_path_factory.mktemp("db")
    repository = SqliteReceiptRepository(db_dir / "test.db")
    main.app.dependency_overrides[get_repository] = lambda: repository
    return repository


@pytest.fixture(autouse=True)
def clear_dependency_overrides():
    yield
    main.app.dependency_overrides.clear()


def make_png(path, size=(20, 20), color=(10, 20, 30)):
    Image.new("RGB", size, color).save(path, format="PNG")


def make_jpeg_with_rotation(path, size=(30, 60), color=(50, 60, 70)):
    img = Image.new("RGB", size, color)
    exif = img.getexif()
    exif[0x0112] = 6  # rotate 90 CW
    img.save(path, format="JPEG", exif=exif)


def make_pdf(path):
    path.write_bytes(b"%PDF-1.4\n%fake receipt pdf\n%%EOF")


def seed_receipt(
    repository,
    upload_dir,
    *,
    store_name="Store",
    purchase_date="2026-01-15",
    total=19.99,
    currency="EUR",
    apartment_id=OBERAUDORF,
    status="needs_review",
    original_filename="receipt.png",
    file_extension=".png",
    with_file=True,
    corrupt_file=False,
):
    receipt_id = str(uuid.uuid4())
    if with_file:
        path = upload_dir / f"{receipt_id}{file_extension}"
        if corrupt_file:
            path.write_bytes(b"not a real image at all")
        elif file_extension == ".pdf":
            make_pdf(path)
        elif file_extension in (".jpg", ".jpeg"):
            make_jpeg_with_rotation(path)
        else:
            make_png(path)

    data = ReceiptData(
        store_name=store_name,
        purchase_date=purchase_date,
        currency=currency,
        items=[],
        discounts=[],
        taxes=[],
        total=total,
    )
    repository.save_receipt(receipt_id, data, apartment_id=apartment_id)

    # save_receipt always stores original_filename as None (it's set by
    # the upload step, which this helper bypasses) -- write it directly so
    # receipts_rows' "source file" column has something to show.
    with repository._connect() as conn:
        conn.execute(
            "UPDATE uploads SET original_filename = ?, content_type = ? WHERE receipt_id = ?",
            (original_filename, "image/png", receipt_id),
        )
        conn.commit()

    if status == "approved":
        repository.set_receipt_status(receipt_id, "approved")

    return receipt_id


def parse_csv_text(text, delimiter):
    return list(csv.reader(io.StringIO(text), delimiter=delimiter))


# --- domain.report_export: format_amount / sanitize_cell -------------------


def test_format_amount_rounds_and_uses_comma_for_excel_de():
    assert format_amount(Decimal("19.995"), "excel_de") == "20,00"  # ROUND_HALF_UP, not banker's rounding
    assert format_amount(Decimal("19.99"), "excel_de") == "19,99"
    assert format_amount(Decimal("19.99"), "plain") == "19.99"
    assert format_amount(Decimal("-12.50"), "excel_de") == "-12,50"
    assert format_amount(Decimal("1234.5"), "plain") == "1234.50"  # no thousands separator


def test_sanitize_cell_neutralizes_formula_prefixes_but_not_plain_text():
    assert sanitize_cell(None) == ""
    assert sanitize_cell('=HYPERLINK("http://x","y")') == '\'=HYPERLINK("http://x","y")'
    assert sanitize_cell("+1") == "'+1"
    assert sanitize_cell("-1") == "'-1"
    assert sanitize_cell("@a") == "'@a"
    assert sanitize_cell("\tx") == "'\tx"
    assert sanitize_cell("\rx") == "'\rx"
    assert sanitize_cell("Café Straße ß") == "Café Straße ß"
    assert sanitize_cell("Normal Store") == "Normal Store"


def test_sanitize_cell_never_applied_to_amounts():
    # A negative amount legitimately starts with "-"; format_amount never
    # runs it through sanitize_cell, so it is never quote-prefixed.
    assert format_amount(Decimal("-5.00"), "plain") == "-5.00"


# --- classify_receipt / not_included_rows -----------------------------------


def test_not_included_rows_lists_each_excluded_reason_once_never_counted_or_other_year(temp_repository, temp_upload_dir):
    counted_id = seed_receipt(temp_repository, temp_upload_dir, purchase_date="2026-01-15")
    other_year_id = seed_receipt(temp_repository, temp_upload_dir, purchase_date="2025-01-15")
    undated_id = seed_receipt(temp_repository, temp_upload_dir, purchase_date="not a date")
    no_total_id = seed_receipt(temp_repository, temp_upload_dir, total=None)
    no_currency_id = seed_receipt(temp_repository, temp_upload_dir, currency=None)
    no_apartment_id = seed_receipt(temp_repository, temp_upload_dir, apartment_id=None)

    receipts = temp_repository.list_matching_receipts()
    rows = not_included_rows(receipts, 2026, "all", "plain")
    ids_listed = [row[-1] for row in rows]

    assert counted_id not in ids_listed
    assert other_year_id not in ids_listed
    assert undated_id in ids_listed
    assert no_total_id in ids_listed
    assert no_currency_id in ids_listed
    assert no_apartment_id in ids_listed
    assert len(ids_listed) == len(set(ids_listed))  # each listed exactly once


def test_undated_receipt_appears_in_not_included_for_every_year(temp_repository, temp_upload_dir):
    undated_id = seed_receipt(temp_repository, temp_upload_dir, purchase_date=None)
    receipts = temp_repository.list_matching_receipts()
    for year in (2024, 2025, 2026, 2030):
        ids_listed = [row[-1] for row in not_included_rows(receipts, year, "all", "plain")]
        assert undated_id in ids_listed


def test_not_approved_only_excluded_under_basis_approved(temp_repository, temp_upload_dir):
    receipt_id = seed_receipt(temp_repository, temp_upload_dir, status="needs_review")
    receipts = temp_repository.list_matching_receipts()
    assert classify_receipt(receipts[0], 2026, "all") == "counted"
    assert classify_receipt(receipts[0], 2026, "approved") == "not_approved"


# --- receipts_rows: ordering, edited totals, legacy dates -------------------


def test_receipts_rows_ordered_by_date_then_store_then_id(temp_repository, temp_upload_dir):
    seed_receipt(temp_repository, temp_upload_dir, store_name="Zebra", purchase_date="2026-01-01")
    seed_receipt(temp_repository, temp_upload_dir, store_name="Apple", purchase_date="2026-01-01")
    seed_receipt(temp_repository, temp_upload_dir, store_name="Middle", purchase_date="2025-12-31")

    receipts = temp_repository.list_matching_receipts()
    rows = receipts_rows(receipts, 2026, "all", "plain", TODAY, {})
    stores = [row[2] for row in rows]
    assert stores == ["Apple", "Zebra"]  # 2025 store excluded by year


def test_receipts_rows_uses_edited_working_copy_total(temp_repository, temp_upload_dir):
    receipt_id = seed_receipt(temp_repository, temp_upload_dir, total=10.0)
    from domain.models import ReceiptUpdate

    temp_repository.update_receipt(
        receipt_id,
        ReceiptUpdate(
            store_name="Store",
            purchase_date="2026-01-15",
            currency="EUR",
            items=[],
            discounts=[],
            taxes=[],
            total=42.5,
        ),
    )
    receipts = temp_repository.list_matching_receipts()
    rows = receipts_rows(receipts, 2026, "all", "plain", TODAY, {})
    assert rows[0][5] == "42.50"
    assert rows[0][7] == "yes"  # Edited


def test_receipts_rows_legacy_dotted_date_lands_in_right_year(temp_repository, temp_upload_dir):
    seed_receipt(temp_repository, temp_upload_dir, purchase_date="26.06.2026")
    receipts = temp_repository.list_matching_receipts()
    rows_2026 = receipts_rows(receipts, 2026, "all", "excel_de", TODAY, {})
    assert len(rows_2026) == 1
    assert rows_2026[0][1] == "26.06.2026"


def test_two_currencies_never_merged(temp_repository, temp_upload_dir):
    seed_receipt(temp_repository, temp_upload_dir, currency="EUR", total=10.0, apartment_id=OBERAUDORF)
    seed_receipt(temp_repository, temp_upload_dir, currency="USD", total=20.0, apartment_id=OBERAUDORF)
    receipts = temp_repository.list_matching_receipts()
    apartments = temp_repository.list_apartments()
    from domain.rules import summarize_year

    summary = summarize_year(receipts, apartments, 2026, "all", TODAY)
    currencies = {ct.currency for a in summary.apartments for ct in a.by_currency}
    assert currencies == {"EUR", "USD"}


# --- CSV format per style ----------------------------------------------------


def test_to_csv_excel_de_style_has_bom_semicolons_german_headers_comma_decimal(
    temp_repository, temp_upload_dir
):
    seed_receipt(temp_repository, temp_upload_dir, total=19.99, purchase_date="2026-03-05")
    receipts = temp_repository.list_matching_receipts()
    from domain.report_export import RECEIPTS_HEADERS

    text = to_csv(
        RECEIPTS_HEADERS["excel_de"],
        receipts_rows(receipts, 2026, "all", "excel_de", TODAY, {}),
        "excel_de",
    )
    assert text.startswith("﻿")
    assert "\r\n" in text
    stripped = text[1:]
    rows = parse_csv_text(stripped, ";")
    assert rows[0] == RECEIPTS_HEADERS["excel_de"]
    assert rows[0][0] == "Nr"
    assert "19,99" in rows[1]
    assert "05.03.2026" in rows[1]


def test_to_csv_plain_style_has_no_bom_commas_english_headers_dot_decimal(temp_repository, temp_upload_dir):
    seed_receipt(temp_repository, temp_upload_dir, total=19.99, purchase_date="2026-03-05")
    receipts = temp_repository.list_matching_receipts()
    from domain.report_export import RECEIPTS_HEADERS

    text = to_csv(
        RECEIPTS_HEADERS["plain"],
        receipts_rows(receipts, 2026, "all", "plain", TODAY, {}),
        "plain",
    )
    assert not text.startswith("﻿")
    rows = parse_csv_text(text, ",")
    assert rows[0] == RECEIPTS_HEADERS["plain"]
    assert rows[0][0] == "No"
    assert "19.99" in rows[1]
    assert "2026-03-05" in rows[1]


def test_special_characters_round_trip_through_csv(temp_repository, temp_upload_dir):
    store_name = 'A;B"C\nD üß'
    seed_receipt(temp_repository, temp_upload_dir, store_name=store_name)
    receipts = temp_repository.list_matching_receipts()
    from domain.report_export import RECEIPTS_HEADERS

    text = to_csv(
        RECEIPTS_HEADERS["plain"], receipts_rows(receipts, 2026, "all", "plain", TODAY, {}), "plain"
    )
    rows = parse_csv_text(text, ",")
    assert rows[1][2] == store_name


# --- summary_rows ------------------------------------------------------------


def test_summary_rows_match_report_including_both_row(temp_repository, temp_upload_dir):
    seed_receipt(temp_repository, temp_upload_dir, apartment_id=OBERAUDORF, total=10.0, currency="EUR")
    seed_receipt(temp_repository, temp_upload_dir, apartment_id=WALDGLUECK, total=5.0, currency="EUR")
    receipts = temp_repository.list_matching_receipts()
    apartments = temp_repository.list_apartments()
    from domain.rules import summarize_year

    summary = summarize_year(receipts, apartments, 2026, "all", TODAY)
    rows = summary_rows(summary, "plain")
    both_rows = [row for row in rows if row[0] == "Both apartments"]
    assert len(both_rows) == 1
    assert both_rows[0][3] == "15.00"


def test_summary_rows_omit_both_row_when_apartment_filter_active(temp_repository, temp_upload_dir):
    seed_receipt(temp_repository, temp_upload_dir, apartment_id=OBERAUDORF, total=10.0)
    seed_receipt(temp_repository, temp_upload_dir, apartment_id=WALDGLUECK, total=5.0)
    receipts = temp_repository.list_matching_receipts()
    apartments = temp_repository.list_apartments()
    from domain.rules import summarize_year

    summary = summarize_year(receipts, apartments, 2026, "all", TODAY)
    rows = summary_rows(summary, "plain", apartment_id=OBERAUDORF)
    assert all(row[0] != "Both apartments" for row in rows)
    assert all(row[0] == "Fewo JoJo - Oberaudorf - Bergblick" for row in rows)


# --- amount sums equal the report's own totals -------------------------------


def test_receipts_csv_amount_sum_equals_report_total(temp_repository, temp_upload_dir):
    seed_receipt(temp_repository, temp_upload_dir, total=10.5, currency="EUR", apartment_id=OBERAUDORF)
    seed_receipt(temp_repository, temp_upload_dir, total=5.25, currency="EUR", apartment_id=OBERAUDORF)
    seed_receipt(temp_repository, temp_upload_dir, total=3.0, currency="USD", apartment_id=WALDGLUECK)

    response = client.get("/reports/yearly", params={"year": "2026", "basis": "all"})
    assert response.status_code == 200
    report = response.json()
    report_totals = {ct["currency"]: Decimal(ct["total"]) for ct in report["overall"]}

    csv_response = client.get(
        "/reports/yearly/export.csv", params={"year": "2026", "basis": "all", "style": "plain"}
    )
    assert csv_response.status_code == 200
    rows = parse_csv_text(csv_response.text, ",")
    sums: dict[str, Decimal] = {}
    for row in rows[1:]:
        currency = row[4]
        sums.setdefault(currency, Decimal("0"))
        sums[currency] += Decimal(row[5])

    assert sums == report_totals


# --- API routes: validation --------------------------------------------------


def test_export_csv_requires_year():
    response = client.get("/reports/yearly/export.csv")
    assert response.status_code == 422


def test_export_csv_rejects_bad_basis_and_style():
    assert client.get("/reports/yearly/export.csv", params={"year": "2026", "basis": "bogus"}).status_code == 422
    assert client.get("/reports/yearly/export.csv", params={"year": "2026", "style": "bogus"}).status_code == 422


def test_export_csv_rejects_unknown_apartment():
    response = client.get(
        "/reports/yearly/export.csv", params={"year": "2026", "apartment_id": "does-not-exist"}
    )
    assert response.status_code == 422


def test_export_csv_rejects_bad_year():
    assert client.get("/reports/yearly/export.csv", params={"year": "20xx"}).status_code == 422
    assert client.get("/reports/yearly/export.csv", params={"year": "1999"}).status_code == 422


def test_export_csv_headers_and_filename(temp_repository, temp_upload_dir):
    seed_receipt(temp_repository, temp_upload_dir)
    response = client.get("/reports/yearly/export.csv", params={"year": "2026"})
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/csv")
    assert "charset=utf-8" in response.headers["content-type"]
    assert response.headers["x-content-type-options"] == "nosniff"
    assert response.headers["cache-control"] == "private, no-cache"
    assert 'filename="receipts-2026-all-apartments.csv"' in response.headers["content-disposition"]


def test_export_csv_filename_includes_apartment_id(temp_repository, temp_upload_dir):
    seed_receipt(temp_repository, temp_upload_dir, apartment_id=OBERAUDORF)
    response = client.get("/reports/yearly/export.csv", params={"year": "2026", "apartment_id": OBERAUDORF})
    assert f'filename="receipts-2026-{OBERAUDORF}.csv"' in response.headers["content-disposition"]


def test_export_csv_has_no_receipt_count_limit(temp_repository, temp_upload_dir, monkeypatch):
    monkeypatch.setattr(routes, "MAX_EXPORT_RECEIPTS", 1)
    seed_receipt(temp_repository, temp_upload_dir)
    seed_receipt(temp_repository, temp_upload_dir)
    response = client.get("/reports/yearly/export.csv", params={"year": "2026"})
    assert response.status_code == 200
    rows = parse_csv_text(response.text, ",")
    assert len(rows) - 1 == 2  # both receipts present despite the (CSV-irrelevant) low max


# --- ZIP export: validation, limit ------------------------------------------


def test_export_zip_requires_year_and_validates_same_as_csv():
    assert client.get("/reports/yearly/export.zip").status_code == 422
    assert client.get("/reports/yearly/export.zip", params={"year": "2026", "basis": "bogus"}).status_code == 422
    assert client.get("/reports/yearly/export.zip", params={"year": "2026", "style": "bogus"}).status_code == 422
    assert (
        client.get(
            "/reports/yearly/export.zip", params={"year": "2026", "apartment_id": "nope"}
        ).status_code
        == 422
    )


def test_export_zip_enforces_max_export_receipts(temp_repository, temp_upload_dir, monkeypatch):
    monkeypatch.setattr(routes, "MAX_EXPORT_RECEIPTS", 1)
    seed_receipt(temp_repository, temp_upload_dir)
    seed_receipt(temp_repository, temp_upload_dir)
    response = client.get("/reports/yearly/export.zip", params={"year": "2026"})
    assert response.status_code == 422
    assert "apartment" in response.json()["detail"].lower() or "csv" in response.json()["detail"].lower()


def test_export_zip_under_max_succeeds(temp_repository, temp_upload_dir, monkeypatch):
    monkeypatch.setattr(routes, "MAX_EXPORT_RECEIPTS", 5)
    seed_receipt(temp_repository, temp_upload_dir)
    response = client.get("/reports/yearly/export.zip", params={"year": "2026"})
    assert response.status_code == 200


# --- ZIP export: contents, PDFs, problems.txt --------------------------------


def test_zip_contains_expected_files_and_pdf_for_each_counted_receipt(temp_repository, temp_upload_dir):
    seed_receipt(temp_repository, temp_upload_dir, file_extension=".png")
    seed_receipt(temp_repository, temp_upload_dir, file_extension=".jpg")
    seed_receipt(temp_repository, temp_upload_dir, file_extension=".pdf")

    response = client.get("/reports/yearly/export.zip", params={"year": "2026"})
    assert response.status_code == 200
    archive = zipfile.ZipFile(io.BytesIO(response.content))
    names = archive.namelist()

    assert "receipts.csv" in names
    assert "summary.csv" in names
    assert "not_included.csv" in names
    assert "README.txt" in names
    assert "problems.txt" not in names

    pdf_names = [n for n in names if n.startswith("documents/") and n.endswith(".pdf")]
    assert len(pdf_names) == 3
    for name in pdf_names:
        assert ".." not in name
        assert not name.startswith("/")
        name.encode("ascii")  # raises if non-ASCII


def test_pdf_names_unique_for_same_store_date_total(temp_repository, temp_upload_dir):
    seed_receipt(
        temp_repository, temp_upload_dir, store_name="Same", purchase_date="2026-01-01", total=9.99
    )
    seed_receipt(
        temp_repository, temp_upload_dir, store_name="Same", purchase_date="2026-01-01", total=9.99
    )
    response = client.get("/reports/yearly/export.zip", params={"year": "2026"})
    archive = zipfile.ZipFile(io.BytesIO(response.content))
    pdf_names = [n for n in archive.namelist() if n.endswith(".pdf")]
    assert len(pdf_names) == 2
    assert len(set(pdf_names)) == 2


def test_pdf_original_comes_back_byte_identical(temp_repository, temp_upload_dir):
    receipt_id = seed_receipt(temp_repository, temp_upload_dir, file_extension=".pdf")
    original_bytes = (temp_upload_dir / f"{receipt_id}.pdf").read_bytes()

    response = client.get("/reports/yearly/export.zip", params={"year": "2026"})
    archive = zipfile.ZipFile(io.BytesIO(response.content))
    pdf_name = next(n for n in archive.namelist() if n.endswith(".pdf"))
    assert archive.read(pdf_name) == original_bytes


def test_image_becomes_pdf_starting_with_pdf_signature(temp_repository, temp_upload_dir):
    seed_receipt(temp_repository, temp_upload_dir, file_extension=".png")
    response = client.get("/reports/yearly/export.zip", params={"year": "2026"})
    archive = zipfile.ZipFile(io.BytesIO(response.content))
    pdf_name = next(n for n in archive.namelist() if n.endswith(".pdf"))
    assert archive.read(pdf_name).startswith(b"%PDF-")


def test_missing_file_and_corrupt_image_listed_in_problems_without_failing_export(
    temp_repository, temp_upload_dir
):
    seed_receipt(temp_repository, temp_upload_dir, with_file=False)
    seed_receipt(temp_repository, temp_upload_dir, file_extension=".png", corrupt_file=True)
    good_id = seed_receipt(temp_repository, temp_upload_dir, file_extension=".png")

    response = client.get("/reports/yearly/export.zip", params={"year": "2026"})
    assert response.status_code == 200
    archive = zipfile.ZipFile(io.BytesIO(response.content))
    assert "problems.txt" in archive.namelist()
    problems_text = archive.read("problems.txt").decode("utf-8")
    assert "Traceback" not in problems_text
    assert str(temp_upload_dir) not in problems_text
    pdf_names = [n for n in archive.namelist() if n.endswith(".pdf")]
    assert len(pdf_names) == 1
    assert good_id[:8] in pdf_names[0]


def test_no_problems_file_when_everything_converts(temp_repository, temp_upload_dir):
    seed_receipt(temp_repository, temp_upload_dir, file_extension=".png")
    response = client.get("/reports/yearly/export.zip", params={"year": "2026"})
    archive = zipfile.ZipFile(io.BytesIO(response.content))
    assert "problems.txt" not in archive.namelist()


def test_readme_language_and_basis(temp_repository, temp_upload_dir):
    seed_receipt(temp_repository, temp_upload_dir)
    response = client.get(
        "/reports/yearly/export.zip", params={"year": "2026", "basis": "approved", "style": "excel_de"}
    )
    archive = zipfile.ZipFile(io.BytesIO(response.content))
    readme = archive.read("README.txt").decode("utf-8")
    assert "Jahresexport" in readme
    assert "nur geprüfte Belege" in readme

    response_plain = client.get(
        "/reports/yearly/export.zip", params={"year": "2026", "basis": "all", "style": "plain"}
    )
    archive_plain = zipfile.ZipFile(io.BytesIO(response_plain.content))
    readme_plain = archive_plain.read("README.txt").decode("utf-8")
    assert "yearly export" in readme_plain
    assert "all receipts" in readme_plain


def test_uploads_folder_originals_unchanged(temp_repository, temp_upload_dir):
    import hashlib

    receipt_id = seed_receipt(temp_repository, temp_upload_dir, file_extension=".png")
    path = temp_upload_dir / f"{receipt_id}.png"
    before = hashlib.sha256(path.read_bytes()).hexdigest()

    client.get("/reports/yearly/export.zip", params={"year": "2026"})

    after = hashlib.sha256(path.read_bytes()).hexdigest()
    assert before == after


def test_temp_zip_file_removed_after_response(temp_repository, temp_upload_dir, tmp_path):
    import tempfile as tempfile_module

    seed_receipt(temp_repository, temp_upload_dir)
    before = set(p.name for p in __import__("pathlib").Path(tempfile_module.gettempdir()).glob("smart-receipt-export-*"))
    client.get("/reports/yearly/export.zip", params={"year": "2026"})
    after = set(p.name for p in __import__("pathlib").Path(tempfile_module.gettempdir()).glob("smart-receipt-export-*"))
    assert after - before == set()


def test_export_routes_do_not_break_existing_report_and_receipt_routes(temp_repository, temp_upload_dir):
    receipt_id = seed_receipt(temp_repository, temp_upload_dir)
    assert client.get("/reports/yearly", params={"year": "2026"}).status_code == 200
    assert client.get("/reports/years").status_code == 200
    assert client.get(f"/receipts/{receipt_id}").status_code == 200
