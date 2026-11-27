import json
import sqlite3
import uuid
from datetime import date

import pytest
from fastapi.testclient import TestClient

import adapters.file_storage as file_storage
import main
from adapters.sqlite_repository import SqliteReceiptRepository
from api.routes import get_extractor, get_repository
from domain.models import Discount, LineItem, ReceiptData, Tax
from domain.rules import check_receipt, normalize_purchase_date

client = TestClient(main.app)


@pytest.fixture(autouse=True)
def temp_upload_dir(tmp_path, monkeypatch):
    monkeypatch.setattr(file_storage, "UPLOAD_DIR", tmp_path)
    return tmp_path


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


class FakeExtractor:
    def __init__(self, data: ReceiptData | None = None):
        self._data = data

    def extract(self, file_path):
        return self._data


def override_extractor(extractor: FakeExtractor):
    main.app.dependency_overrides[get_extractor] = lambda: extractor


def store_file(upload_dir, extension: str = ".jpg") -> str:
    receipt_id = str(uuid.uuid4())
    (upload_dir / f"{receipt_id}{extension}").write_bytes(b"fake-bytes")
    return receipt_id


def mk_item(name="Item", quantity=1.0, unit_price=10.0, line_total=10.0):
    return LineItem(name=name, quantity=quantity, unit_price=unit_price, line_total=line_total)


# --- normalize_purchase_date -------------------------------------------------


@pytest.mark.parametrize(
    "raw, expected",
    [
        ("2025-06-26", "2025-06-26"),
        ("2025-06-26 11", "2025-06-26"),
        ("2025-06-26T11:04:00", "2025-06-26"),
        ("26/06/2025", None),
        ("06/26/2025", None),
        ("2025-13-45", None),
        ("yesterday", None),
        ("", None),
        (None, None),
        ("2025-06-26 11 22", None),
        # Dotted German dates (D.M.YYYY / DD.MM.YYYY), added for Issue
        # "recognize dotted German dates":
        ("02.06.2026", "2026-06-02"),
        ("2.6.2026", "2026-06-02"),
        ("29.02.2024", "2024-02-29"),  # 2024 is a leap year
        ("02.06.2026 11:04", "2026-06-02"),  # one trailing token, same as ISO
        ("29.02.2025", None),  # 2025 is not a leap year
        ("31.04.2026", None),  # April has 30 days
        ("02/06/2026", None),  # slash dates stay out of scope
        ("02.06.26", "2026-06-02"),  # 2-digit year, read as 20YY (Ticket AY)
        ("2026.06.02", None),  # year-first dotted order is not recognized
        # Month-name dates (German/English, full/abbreviated), added for
        # Issue "recognize month-name dates":
        ("02 Juni 2026", "2026-06-02"),
        ("2. Dezember 2025", "2025-12-02"),
        ("15 Mär 2026", "2026-03-15"),
        ("15. Mrz. 2026", "2026-03-15"),
        ("3 MAI 2026", "2026-05-03"),
        ("1 March 2026", "2026-03-01"),
        ("02 Juni 2026 11:04", "2026-06-02"),
        ("02 Junix 2026", None),  # unknown month word
        ("31 Februar 2026", None),  # February has no 31st
        ("02 Juni 26", None),  # 2-digit years stay out of scope
        ("Juni 2026", None),  # no day
        ("02/06/2026", None),  # slash dates stay out of scope (month names too)
    ],
)
def test_normalize_purchase_date(raw, expected):
    # Given each documented raw date value
    # When it is normalized
    # Then it matches the documented expected result
    assert normalize_purchase_date(raw) == expected


def test_normalize_purchase_date_never_raises_on_garbage():
    for raw in ["\n", "2025", "2025-06", "2025-06-26-26", "   ", "2025/06/26", "99.99.9999", "0.0.2026"]:
        normalize_purchase_date(raw)  # must not raise


# --- check_receipt -----------------------------------------------------------


def test_consistent_receipt_tax_added_on_top_has_no_warnings():
    # Given items totalling 69.40, tax 10.00, and a total of 79.40
    data = ReceiptData(
        store_name="Store",
        purchase_date="2026-01-15",
        currency="USD",
        items=[mk_item(unit_price=69.40, quantity=1, line_total=69.40)],
        discounts=[],
        taxes=[Tax(description="Tax", amount=10.00)],
        total=79.40,
    )

    # When checked
    warnings = check_receipt(data, date(2026, 1, 20))

    # Then there are no warnings
    assert warnings == []


def test_tax_inclusive_receipt_has_no_warnings():
    # Given items/tax listed the same way, but the total already includes tax
    data = ReceiptData(
        store_name="Store",
        purchase_date="2026-01-15",
        currency="USD",
        items=[mk_item(unit_price=69.40, quantity=1, line_total=69.40)],
        discounts=[],
        taxes=[Tax(description="Tax", amount=10.00)],
        total=69.40,
    )

    # When checked
    warnings = check_receipt(data, date(2026, 1, 20))

    # Then there are no warnings (prices already include tax)
    assert warnings == []


def test_total_mismatch_warning_when_neither_formula_matches():
    # Given a total that matches neither tax-added-on-top nor tax-included
    data = ReceiptData(
        store_name="Store",
        purchase_date="2026-01-15",
        currency="USD",
        items=[mk_item(unit_price=69.40, quantity=1, line_total=69.40)],
        discounts=[],
        taxes=[Tax(description="Tax", amount=10.00)],
        total=80.00,
    )

    # When checked
    warnings = check_receipt(data, date(2026, 1, 20))

    # Then exactly one TOTAL_MISMATCH warning is raised
    codes = [w.code for w in warnings]
    assert codes.count("TOTAL_MISMATCH") == 1


def test_negative_discount_is_handled_via_absolute_value():
    # Given a discount recorded as a negative amount
    data = ReceiptData(
        store_name="Store",
        purchase_date="2026-01-15",
        currency="USD",
        items=[mk_item(unit_price=10.00, quantity=1, line_total=10.00)],
        discounts=[Discount(description="Discount", amount=-2.00)],
        taxes=[],
        total=8.00,
    )

    # When checked
    warnings = check_receipt(data, date(2026, 1, 20))

    # Then no crash and no TOTAL_MISMATCH (8.00 matches 10.00 - 2.00)
    assert "TOTAL_MISMATCH" not in [w.code for w in warnings]


def test_item_missing_an_amount_skips_total_mismatch_check():
    # Given an item with no usable amount at all
    data = ReceiptData(
        store_name="Store",
        purchase_date="2026-01-15",
        currency="USD",
        items=[LineItem(name="Mystery", quantity=None, unit_price=None, line_total=None)],
        discounts=[],
        taxes=[],
        total=999.00,
    )

    # When checked
    warnings = check_receipt(data, date(2026, 1, 20))

    # Then no TOTAL_MISMATCH is raised, since there's nothing to compare
    assert "TOTAL_MISMATCH" not in [w.code for w in warnings]


def test_line_mismatch_reports_the_item_index():
    # Given an item whose quantity x unit_price does not match its line_total
    data = ReceiptData(
        store_name="Store",
        purchase_date="2026-01-15",
        currency="USD",
        items=[mk_item(), mk_item(quantity=2, unit_price=5, line_total=20)],
        discounts=[],
        taxes=[],
        total=None,
    )

    # When checked
    warnings = check_receipt(data, date(2026, 1, 20))

    # Then a LINE_MISMATCH warning names the second item (index 1)
    line_mismatches = [w for w in warnings if w.code == "LINE_MISMATCH"]
    assert len(line_mismatches) == 1
    assert line_mismatches[0].details["index"] == "1"


@pytest.mark.parametrize(
    "quantity, unit_price, line_total, expect_warning",
    [
        # Net unit price vs. gross line total at German VAT rates -- no warning
        (1, 2.23, 2.39, False),
        (1, 9.80, 11.66, False),
        (1, 16.80, 19.99, False),
        (1, 1.86, 1.99, False),
        (2, 3.50, 7.49, False),
        # A real mismatch, not explained by either VAT rate -- still warns
        (1, 2.23, 2.60, True),
    ],
)
def test_line_mismatch_vat_tolerance(quantity, unit_price, line_total, expect_warning):
    # Given one item at the given quantity/unit_price/line_total
    data = ReceiptData(
        store_name="Store",
        purchase_date="2026-01-15",
        currency="EUR",
        items=[mk_item(quantity=quantity, unit_price=unit_price, line_total=line_total)],
        discounts=[],
        taxes=[],
        total=None,
    )

    # When checked
    warnings = check_receipt(data, date(2026, 1, 20))

    # Then LINE_MISMATCH is raised only when expected
    codes = [w.code for w in warnings]
    assert ("LINE_MISMATCH" in codes) == expect_warning


def test_line_mismatch_with_null_quantity_is_unaffected_by_vat_tolerance():
    # Given an item with a null quantity (existing behaviour: LINE_MISMATCH
    # is never computed at all when quantity is missing)
    data = ReceiptData(
        store_name="Store",
        purchase_date="2026-01-15",
        currency="EUR",
        items=[LineItem(name="Item", quantity=None, unit_price=2.23, line_total=2.39)],
        discounts=[],
        taxes=[],
        total=None,
    )

    # When checked
    warnings = check_receipt(data, date(2026, 1, 20))

    # Then no LINE_MISMATCH warning is raised (quantity is null, skipped)
    assert all(w.code != "LINE_MISMATCH" for w in warnings)


def test_future_date_warning_with_injected_today():
    # Given a purchase date in the future relative to an injected "today"
    data = ReceiptData(
        store_name="Store", purchase_date="2026-02-01", currency="USD",
        items=[], discounts=[], taxes=[], total=None,
    )

    # When checked against an earlier injected today
    warnings = check_receipt(data, date(2026, 1, 15))

    # Then a FUTURE_DATE warning is raised
    assert "FUTURE_DATE" in [w.code for w in warnings]


def test_all_null_receipt_has_missing_warnings_and_does_not_crash():
    # Given a receipt with every field null/empty
    data = ReceiptData(
        store_name=None, purchase_date=None, currency=None,
        items=[], discounts=[], taxes=[], total=None,
    )

    # When checked
    warnings = check_receipt(data, date(2026, 1, 20))

    # Then the expected missing-field warnings are raised, nothing else, no crash
    codes = {w.code for w in warnings}
    assert codes == {"MISSING_STORE", "MISSING_DATE", "MISSING_TOTAL"}


def test_decimal_math_handles_0_1_plus_0_2_exactly():
    # Given amounts that are classic floating-point trouble (0.1 + 0.2)
    data = ReceiptData(
        store_name="Store", purchase_date="2026-01-15", currency="USD",
        items=[mk_item(unit_price=0.1, quantity=1, line_total=0.1), mk_item(unit_price=0.2, quantity=1, line_total=0.2)],
        discounts=[], taxes=[], total=0.3,
    )

    # When checked
    warnings = check_receipt(data, date(2026, 1, 20))

    # Then there is no spurious TOTAL_MISMATCH from float imprecision
    assert "TOTAL_MISMATCH" not in [w.code for w in warnings]


# --- API-level: date normalization on save and read -------------------------


def test_extracting_a_messy_date_stores_normalized_but_keeps_raw_in_ai_result(
    temp_upload_dir, temp_repository
):
    # Given a receipt whose AI-extracted date is "2025-06-26 11"
    receipt_id = store_file(temp_upload_dir)
    messy_data = ReceiptData(
        store_name="Store", purchase_date="2025-06-26 11", currency="USD",
        items=[], discounts=[], taxes=[], total=10.0,
    )
    override_extractor(FakeExtractor(data=messy_data))

    # When it is extracted
    response = client.post(f"/receipts/{receipt_id}/extract")
    assert response.status_code == 200

    # Then the response and extracted_json show the normalized date...
    assert response.json()["purchase_date"] == "2025-06-26"
    with sqlite3.connect(temp_repository._database_path) as conn:
        row = conn.execute(
            "SELECT purchase_date, extracted_json, ai_result_json FROM receipts WHERE receipt_id = ?",
            (receipt_id,),
        ).fetchone()
    assert row[0] == "2025-06-26"
    assert json.loads(row[1])["purchase_date"] == "2025-06-26"

    # ...but ai_result_json keeps the original, unparsed AI value
    assert json.loads(row[2])["purchase_date"] == "2025-06-26 11"


def test_unparseable_date_is_kept_raw_and_flagged(temp_upload_dir):
    # Given a receipt whose AI-extracted date cannot be parsed at all
    receipt_id = store_file(temp_upload_dir)
    data = ReceiptData(
        store_name="Store", purchase_date="whenever", currency="USD",
        items=[], discounts=[], taxes=[], total=10.0,
    )
    override_extractor(FakeExtractor(data=data))

    # When it is extracted
    response = client.post(f"/receipts/{receipt_id}/extract")

    # Then the raw text is kept (not discarded) and flagged
    body = response.json()
    assert body["purchase_date"] == "whenever"
    assert "DATE_NOT_STANDARD" in [w["code"] for w in body["warnings"]]


def test_old_saved_row_with_raw_date_comes_back_normalized_from_get(temp_repository):
    # Given a row saved as if by an older version of the app, with a raw
    # (non-ISO) date already sitting in extracted_json/ai_result_json/the
    # purchase_date column -- written directly, bypassing normalization
    receipt_id = str(uuid.uuid4())
    raw_data = {
        "store_name": "Store", "purchase_date": "2025-06-26 11", "currency": "USD",
        "items": [], "discounts": [], "taxes": [], "total": 10.0,
    }
    now = "2026-01-15T10:00:00+00:00"
    with sqlite3.connect(temp_repository._database_path) as conn:
        conn.execute(
            """
            INSERT INTO receipts (receipt_id, store_name, purchase_date, currency, total,
                extracted_json, ai_result_json, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (receipt_id, "Store", "2025-06-26 11", "USD", "10.0",
             json.dumps(raw_data), json.dumps(raw_data), now, now),
        )
        conn.commit()

    # When it is fetched via GET
    response = client.get(f"/receipts/{receipt_id}")

    # Then the date comes back normalized, with no migration of the stored row
    assert response.status_code == 200
    assert response.json()["purchase_date"] == "2025-06-26"
    with sqlite3.connect(temp_repository._database_path) as conn:
        stored = conn.execute(
            "SELECT purchase_date FROM receipts WHERE receipt_id = ?", (receipt_id,)
        ).fetchone()[0]
    assert stored == "2025-06-26 11"  # unchanged in storage


# --- API-level: warnings on extract, GET and PUT -----------------------------


def test_warnings_appear_in_extract_get_and_put_and_change_after_a_fix(
    temp_upload_dir,
):
    # Given a receipt whose total does not match its items
    receipt_id = store_file(temp_upload_dir)
    mismatched = ReceiptData(
        store_name="Store", purchase_date="2026-01-15", currency="USD",
        items=[mk_item(unit_price=10.0, quantity=1, line_total=10.0)],
        discounts=[], taxes=[], total=50.0,
    )
    override_extractor(FakeExtractor(data=mismatched))

    # When extracted
    extract_body = client.post(f"/receipts/{receipt_id}/extract").json()
    assert "TOTAL_MISMATCH" in [w["code"] for w in extract_body["warnings"]]

    # Then GET shows the same warning
    get_body = client.get(f"/receipts/{receipt_id}").json()
    assert "TOTAL_MISMATCH" in [w["code"] for w in get_body["warnings"]]

    # When the user corrects the total via PUT
    put_response = client.put(
        f"/receipts/{receipt_id}",
        json={
            "store_name": "Store", "purchase_date": "2026-01-15", "currency": "USD",
            "items": [{"name": "Item", "quantity": 1, "unit_price": 10.0, "line_total": 10.0}],
            "discounts": [], "taxes": [], "total": 10.0,
        },
    )

    # Then the PUT response no longer shows the warning
    assert put_response.status_code == 200
    assert "TOTAL_MISMATCH" not in [w["code"] for w in put_response.json()["warnings"]]
