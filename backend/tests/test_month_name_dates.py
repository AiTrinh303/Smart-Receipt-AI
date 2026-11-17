"""Covers recognizing month-name dates ("D[.]? Month YYYY", German or
English, full or abbreviated) end to end: a legacy row whose stored text
predates this feature, and a brand new extraction that returns one."""

import json
import uuid

import pytest
from fastapi.testclient import TestClient

import adapters.file_storage as file_storage
import main
from adapters.sqlite_repository import SqliteReceiptRepository
from api.routes import get_extractor, get_repository
from domain.models import ReceiptData, ReceiptStatus
from _upload_helper import VALID_APARTMENT_ID, upload_with_apartment

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
    def __init__(self, data: ReceiptData):
        self._data = data

    def extract(self, file_path):
        return self._data


def override_extractor(extractor: FakeExtractor):
    main.app.dependency_overrides[get_extractor] = lambda: extractor


def upload_file() -> str:
    import io

    files = {"file": ("receipt.jpg", io.BytesIO(b"fake-bytes"), "image/jpeg")}
    response = upload_with_apartment(client, files, apartment_id=VALID_APARTMENT_ID)
    assert response.status_code == 201
    return response.json()["receipt_id"]


def make_data(**overrides) -> ReceiptData:
    defaults = dict(
        store_name="Amazon",
        purchase_date="02 Juni 2026",
        currency="EUR",
        items=[{"name": "Item", "quantity": 1, "unit_price": 2.5, "line_total": 2.5}],
        discounts=[],
        taxes=[],
        total=2.5,
    )
    defaults.update(overrides)
    return ReceiptData(**defaults)


def make_legacy_row_with_raw_month_name_date(temp_repository, temp_upload_dir) -> str:
    """Simulates a row saved *before* month-name-date recognition existed:
    the raw "02 Juni 2026" text sits untouched in extracted_json, the
    purchase_date column, and ai_result_json -- bypassing save_receipt()'s
    own (now month-name-aware) normalization entirely, via a direct SQL
    write, exactly as an old row on disk would actually look."""
    receipt_id = str(uuid.uuid4())
    (temp_upload_dir / f"{receipt_id}.jpg").write_bytes(b"fake-bytes")

    data = make_data()
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
            (
                receipt_id,
                data.store_name,
                data.purchase_date,
                data.currency,
                "2.5",
                raw_json,
                raw_json,
                VALID_APARTMENT_ID,
            ),
        )
        conn.commit()
    return receipt_id


def test_legacy_row_with_raw_month_name_date_behaves_as_dated(temp_upload_dir, temp_repository):
    # Given a legacy row whose stored text is the raw, un-normalized
    # "02 Juni 2026" (as if saved before this feature existed)
    receipt_id = make_legacy_row_with_raw_month_name_date(temp_repository, temp_upload_dir)

    # Then GET one shows the normalized ISO date
    get_body = client.get(f"/receipts/{receipt_id}").json()
    assert get_body["purchase_date"] == "2026-06-02"
    # And it carries no DATE_NOT_STANDARD warning
    assert all(w["code"] != "DATE_NOT_STANDARD" for w in get_body["warnings"])

    # And GET /items shows the same normalized date for its row
    items_body = client.get("/items").json()
    row = next(r for r in items_body["items"] if r["receipt_id"] == receipt_id)
    assert row["purchase_date"] == "2026-06-02"

    # And it is found by year=2026
    by_year = client.get("/receipts?year=2026").json()
    assert any(r["receipt_id"] == receipt_id for r in by_year["items"])

    # And it is absent from year=none and from has_undated
    by_none = client.get("/receipts?year=none").json()
    assert all(r["receipt_id"] != receipt_id for r in by_none["items"])
    facets = client.get("/receipts/facets").json()
    assert facets["has_undated"] is False
    assert 2026 in facets["years"]

    # And it sorts among dated receipts (date_desc), never last
    items_sorted = client.get("/items?sort=date_desc").json()["items"]
    dated_ids = [
        r["receipt_id"] for r in items_sorted if r["purchase_date"] is not None and "-" in r["purchase_date"]
    ]
    assert receipt_id in dated_ids

    # And it CAN be approved (apartment and total are already set)
    approve = client.put(f"/receipts/{receipt_id}/status", json={"status": ReceiptStatus.APPROVED})
    assert approve.status_code == 200
    assert approve.json()["status"] == ReceiptStatus.APPROVED


def test_a_new_extraction_with_a_month_name_date_stores_iso_but_keeps_the_raw_ai_result(
    temp_upload_dir, temp_repository
):
    # Given a receipt about to be extracted, where the AI returns a
    # month-name date
    receipt_id = upload_file()
    override_extractor(FakeExtractor(data=make_data(purchase_date="02 Juni 2026")))

    # When it is extracted
    response = client.post(f"/receipts/{receipt_id}/extract")
    assert response.status_code == 200
    assert response.json()["purchase_date"] == "2026-06-02"

    # Then the ISO date is stored in extracted_json and the purchase_date
    # column, but the raw AI text is kept, byte-for-byte, in ai_result_json
    with temp_repository._connect() as conn:
        row = conn.execute(
            "SELECT purchase_date, extracted_json, ai_result_json FROM receipts WHERE receipt_id = ?",
            (receipt_id,),
        ).fetchone()
    assert row[0] == "2026-06-02"
    assert json.loads(row[1])["purchase_date"] == "2026-06-02"
    assert json.loads(row[2])["purchase_date"] == "02 Juni 2026"
