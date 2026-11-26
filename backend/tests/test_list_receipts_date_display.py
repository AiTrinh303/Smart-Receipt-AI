"""GET /receipts list rows show purchase_date normalized for display, the
same way GET /receipts/{id} and GET /items already do -- without ever
rewriting the stored row."""

import uuid

import pytest
from fastapi.testclient import TestClient

import main
from adapters.sqlite_repository import SqliteReceiptRepository
from api.routes import get_repository
from domain.models import ReceiptData
from _upload_helper import VALID_APARTMENT_ID

client = TestClient(main.app)


@pytest.fixture(autouse=True)
def temp_repository(tmp_path_factory):
    db_dir = tmp_path_factory.mktemp("db")
    repository = SqliteReceiptRepository(db_dir / "test.db")
    main.app.dependency_overrides[get_repository] = lambda: repository
    yield repository
    main.app.dependency_overrides.clear()


def insert_legacy_row(repository, raw_date: str) -> tuple[str, str]:
    """Writes a receipt whose stored purchase_date is the raw text, via direct
    SQL (bypassing save_receipt()'s own normalization), exactly as a row
    saved before a date format was recognized looks on disk. Returns
    (receipt_id, extracted_json as stored)."""
    receipt_id = str(uuid.uuid4())
    data = ReceiptData(
        store_name="Test Store",
        purchase_date=raw_date,
        currency="EUR",
        items=[],
        discounts=[],
        taxes=[],
        total=1.0,
    )
    raw_json = data.model_dump_json()
    with repository._connect() as conn:
        conn.execute(
            """
            INSERT INTO receipts (
                receipt_id, store_name, purchase_date, currency, total,
                extracted_json, ai_result_json, created_at, updated_at, edited_at,
                apartment_id, status
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'), NULL, ?, 'approved')
            """,
            (receipt_id, data.store_name, raw_date, "EUR", "1.0", raw_json, raw_json, VALID_APARTMENT_ID),
        )
        conn.commit()
    return receipt_id, raw_json


def stored_row(repository, receipt_id: str) -> tuple[str, str]:
    with repository._connect() as conn:
        return conn.execute(
            "SELECT purchase_date, extracted_json FROM receipts WHERE receipt_id = ?",
            (receipt_id,),
        ).fetchone()


def list_dates() -> dict[str, str | None]:
    response = client.get("/receipts?limit=50")
    assert response.status_code == 200
    return {row["receipt_id"]: row["purchase_date"] for row in response.json()["items"]}


@pytest.mark.parametrize(
    "raw_date",
    ["02 Juni 2026", "02.06.2026"],
)
def test_list_row_shows_a_recognized_legacy_date_as_iso(temp_repository, raw_date):
    # Given a stored receipt whose purchase_date is a raw, recognizable date
    receipt_id, _ = insert_legacy_row(temp_repository, raw_date)

    # When the receipt list is requested
    dates = list_dates()

    # Then its row shows the ISO date, matching GET /receipts/{id}
    assert dates[receipt_id] == "2026-06-02"
    assert client.get(f"/receipts/{receipt_id}").json()["purchase_date"] == "2026-06-02"


def test_list_row_keeps_an_unparseable_date_raw(temp_repository):
    # Given a stored receipt whose purchase_date cannot be read as a date
    receipt_id, _ = insert_legacy_row(temp_repository, "26/06/2025")

    # When the receipt list is requested
    dates = list_dates()

    # Then the raw text is shown unchanged, never hidden or guessed
    assert dates[receipt_id] == "26/06/2025"


def test_listing_never_rewrites_the_stored_row(temp_repository):
    # Given stored receipts with a recognizable and an unparseable raw date
    ids = {
        raw: insert_legacy_row(temp_repository, raw)
        for raw in ("02 Juni 2026", "02.06.2026", "26/06/2025")
    }

    # When the receipt list is requested
    list_dates()

    # Then every stored purchase_date column and extracted_json is byte-for-byte unchanged
    for raw, (receipt_id, raw_json) in ids.items():
        assert stored_row(temp_repository, receipt_id) == (raw, raw_json)
