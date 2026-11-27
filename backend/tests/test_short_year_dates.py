"""Covers recognizing dotted dates with a 2-digit year (D.M.YY / DD.MM.YY,
read as 20YY), alone or followed by a time, and that a date followed by a
time is accepted for every shape -- the time is dropped. End to end: a
legacy row whose stored text is such a date shows the ISO date on read and
loses its "not a standard date" warning, without its stored row changing."""

import uuid
from datetime import date

import pytest
from fastapi.testclient import TestClient

import main
from adapters.sqlite_repository import SqliteReceiptRepository
from api.routes import get_repository
from domain.models import ReceiptData
from domain.rules import check_receipt, normalize_purchase_date
from _upload_helper import VALID_APARTMENT_ID

client = TestClient(main.app)


@pytest.mark.parametrize(
    "raw, expected",
    [
        # DD.MM.YY and D.M.YY -> 20YY-MM-DD
        ("27.06.26", "2026-06-27"),
        ("1.2.26", "2026-02-01"),
        ("26.02.25", "2025-02-26"),
        # ... followed by a time (HH:MM or HH:MM:SS), which is dropped
        ("27.06.26 09:52", "2026-06-27"),
        ("06.06.26 12:32:39", "2026-06-06"),
        ("31.07.26 14:20", "2026-07-31"),
        # Every existing shape followed by a time still works
        ("06.06.2026 12:32:39", "2026-06-06"),
        ("06.06.2026 12:32", "2026-06-06"),
        ("2026-06-06 12:32:39", "2026-06-06"),
        ("2026-06-06T12:32:39", "2026-06-06"),
        ("02 Juni 2026 11:04", "2026-06-02"),
        # Leap years are checked against the real calendar
        ("29.02.28", "2028-02-29"),
    ],
)
def test_short_year_and_time_shapes_are_recognized(raw, expected):
    # Given a raw date in one of the newly accepted shapes
    # When it is normalized
    # Then the ISO date comes back, with any time dropped
    assert normalize_purchase_date(raw) == expected


@pytest.mark.parametrize(
    "raw",
    [
        "31.02.26",  # February has no 31st
        "29.02.27",  # 2027 is not a leap year
        "31.04.26",  # April has 30 days
        "27.06.26 25:00",  # not a time of day
        "27.06.26 09:60",  # not a time of day
        "27.06.26 abc",  # a short year allows only a time after it
        "27.06.26 09:52 extra",  # ... and nothing after the time
        "27.06.2",  # a 1-digit year
        "27/06/26",  # slash dates stay out of scope
        "02 Juni 26",  # month-name dates still need a 4-digit year
    ],
)
def test_impossible_or_unsupported_short_year_dates_stay_unrecognized(raw):
    # Given an impossible date, or a short-year shape this rule doesn't accept
    # When it is normalized
    # Then it is not recognized (never guessed)
    assert normalize_purchase_date(raw) is None


def test_check_receipt_no_longer_flags_a_short_year_date_with_a_time():
    # Given receipt data whose date is "27.06.26 09:52"
    data = ReceiptData(
        store_name="Store",
        purchase_date="27.06.26 09:52",
        currency="EUR",
        items=[],
        discounts=[],
        taxes=[],
        total=1.0,
    )

    # When the data-quality checks run
    codes = {w.code for w in check_receipt(data, date(2026, 11, 27))}

    # Then there is no "not a standard date" (or missing date) warning
    assert "DATE_NOT_STANDARD" not in codes
    assert "MISSING_DATE" not in codes


@pytest.fixture
def temp_repository(tmp_path_factory):
    db_dir = tmp_path_factory.mktemp("db")
    repository = SqliteReceiptRepository(db_dir / "test.db")
    main.app.dependency_overrides[get_repository] = lambda: repository
    yield repository
    main.app.dependency_overrides.clear()


def test_a_legacy_short_year_row_reads_as_dated_and_its_stored_row_is_unchanged(temp_repository):
    # Given a stored receipt whose purchase_date is the raw "27.06.26 09:52"
    # (written via direct SQL, exactly as an old row looks on disk)
    receipt_id = str(uuid.uuid4())
    data = ReceiptData(
        store_name="Store",
        purchase_date="27.06.26 09:52",
        currency="EUR",
        items=[],
        discounts=[],
        taxes=[],
        total=1.0,
    )
    raw_json = data.model_dump_json()
    with temp_repository._connect() as conn:
        conn.execute(
            """
            INSERT INTO receipts (
                receipt_id, store_name, purchase_date, currency, total,
                extracted_json, ai_result_json, created_at, updated_at, edited_at,
                apartment_id, status
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'), NULL, ?, 'needs_review')
            """,
            (receipt_id, "Store", "27.06.26 09:52", "EUR", "1.0", raw_json, raw_json, VALID_APARTMENT_ID),
        )
        conn.commit()

    # When it is read one by one and in the list
    body = client.get(f"/receipts/{receipt_id}").json()
    listed = client.get("/receipts?year=2026").json()

    # Then it shows the ISO date with no "not a standard date" warning, and the year filter finds it
    assert body["purchase_date"] == "2026-06-27"
    assert all(w["code"] != "DATE_NOT_STANDARD" for w in body["warnings"])
    assert any(r["receipt_id"] == receipt_id and r["purchase_date"] == "2026-06-27" for r in listed["items"])

    # And the stored row itself was never rewritten
    with temp_repository._connect() as conn:
        stored = conn.execute(
            "SELECT purchase_date, extracted_json FROM receipts WHERE receipt_id = ?", (receipt_id,)
        ).fetchone()
    assert stored == ("27.06.26 09:52", raw_json)
