import time
import uuid

import pytest
from fastapi.testclient import TestClient

import main
from adapters.sqlite_repository import SqliteReceiptRepository
from api.routes import get_extractor, get_repository
from domain.models import ReceiptData

client = TestClient(main.app)


@pytest.fixture(autouse=True)
def temp_repository(tmp_path):
    repository = SqliteReceiptRepository(tmp_path / "test.db")
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


def make_receipt_data(**overrides) -> ReceiptData:
    defaults = dict(
        store_name="Corner Store",
        purchase_date="2026-01-15",
        currency="USD",
        items=[{"name": "Milk", "quantity": 1, "unit_price": 2.5, "line_total": 2.5}],
        discounts=[],
        taxes=[],
        total=19.99,
    )
    defaults.update(overrides)
    return ReceiptData(**defaults)


def save_receipt(repository, data: ReceiptData | None = None) -> str:
    """Saves a receipt directly via the repository (no file/extractor needed)."""
    receipt_id = str(uuid.uuid4())
    repository.save_receipt(receipt_id, data if data is not None else make_receipt_data())
    return receipt_id


def test_empty_database_returns_200_with_empty_items_and_zero_count(temp_repository):
    # Given an empty database
    # When the list endpoint is called
    response = client.get("/receipts")

    # Then the response is 200 with an empty items list and count 0, never 404
    assert response.status_code == 200
    assert response.json() == {"items": [], "count": 0}


def test_three_receipts_saved_at_different_times_are_returned_newest_first(temp_repository):
    # Given three receipts saved at different times
    first_id = save_receipt(temp_repository, make_receipt_data(store_name="First"))
    time.sleep(0.01)
    second_id = save_receipt(temp_repository, make_receipt_data(store_name="Second"))
    time.sleep(0.01)
    third_id = save_receipt(temp_repository, make_receipt_data(store_name="Third"))

    # When the list endpoint is called
    response = client.get("/receipts")

    # Then the receipts are returned newest first
    assert response.status_code == 200
    body = response.json()
    assert [item["receipt_id"] for item in body["items"]] == [third_id, second_id, first_id]
    assert body["count"] == 3


def test_same_created_at_order_is_stable_and_repeatable(temp_repository, monkeypatch):
    # Given two receipts saved with the exact same created_at timestamp
    import adapters.sqlite_repository as sqlite_repository_module

    monkeypatch.setattr(sqlite_repository_module, "_utc_now_iso", lambda: "2026-01-01T00:00:00+00:00")
    first_id = save_receipt(temp_repository)
    second_id = save_receipt(temp_repository)

    # When the list endpoint is called twice
    response_a = client.get("/receipts")
    response_b = client.get("/receipts")

    # Then the order is identical both times (tie-broken by receipt_id)
    order_a = [item["receipt_id"] for item in response_a.json()["items"]]
    order_b = [item["receipt_id"] for item in response_b.json()["items"]]
    assert order_a == order_b
    assert set(order_a) == {first_id, second_id}
    assert order_a == sorted([first_id, second_id])


def test_limit_two_with_three_receipts_returns_only_the_newest_two(temp_repository):
    # Given three receipts
    first_id = save_receipt(temp_repository, make_receipt_data(store_name="First"))
    time.sleep(0.01)
    second_id = save_receipt(temp_repository, make_receipt_data(store_name="Second"))
    time.sleep(0.01)
    third_id = save_receipt(temp_repository, make_receipt_data(store_name="Third"))

    # When the list endpoint is called with limit=2
    response = client.get("/receipts?limit=2")

    # Then only the newest two are returned
    assert response.status_code == 200
    body = response.json()
    assert body["count"] == 2
    assert [item["receipt_id"] for item in body["items"]] == [third_id, second_id]
    assert first_id not in [item["receipt_id"] for item in body["items"]]


@pytest.mark.parametrize("limit_value", ["0", "201", "abc", "-1"])
def test_invalid_limit_values_return_422(temp_repository, limit_value):
    # Given a limit value outside the allowed 1-200 integer range (or non-numeric)
    # When the list endpoint is called with that limit
    response = client.get(f"/receipts?limit={limit_value}")

    # Then the response is 422
    assert response.status_code == 422


def test_receipt_with_null_fields_is_listed_with_nulls_no_crash(temp_repository):
    # Given a receipt where every nullable field is null
    receipt_id = save_receipt(
        temp_repository,
        ReceiptData(
            store_name=None,
            purchase_date=None,
            currency=None,
            items=[],
            discounts=[],
            taxes=[],
            total=None,
        ),
    )

    # When the list endpoint is called
    response = client.get("/receipts")

    # Then the receipt is listed with nulls, with no crash
    assert response.status_code == 200
    body = response.json()
    assert body["count"] == 1
    item = body["items"][0]
    assert item["receipt_id"] == receipt_id
    assert item["store_name"] is None
    assert item["purchase_date"] is None
    assert item["currency"] is None
    assert item["total"] is None


def test_row_with_corrupted_extracted_json_is_skipped_rest_still_returned(temp_repository):
    # Given one good receipt and one receipt whose extracted_json is corrupted
    good_id = save_receipt(temp_repository, make_receipt_data(store_name="Good"))
    bad_id = str(uuid.uuid4())
    import sqlite3

    conn = sqlite3.connect(temp_repository._database_path)
    conn.execute(
        """
        INSERT INTO receipts (
            receipt_id, store_name, purchase_date, currency, total,
            extracted_json, ai_result_json, created_at, updated_at
        )
        VALUES (?, NULL, NULL, NULL, NULL, ?, ?, ?, ?)
        """,
        (bad_id, "{not valid json", "{not valid json", "2026-01-01T00:00:00+00:00", "2026-01-01T00:00:00+00:00"),
    )
    conn.commit()
    conn.close()

    # When the list endpoint is called
    response = client.get("/receipts")

    # Then the bad row is skipped and the good one is still returned
    assert response.status_code == 200
    body = response.json()
    assert body["count"] == 1
    assert body["items"][0]["receipt_id"] == good_id
    assert bad_id not in [item["receipt_id"] for item in body["items"]]


def test_upload_only_receipt_never_extracted_is_not_listed(temp_repository):
    # Given a receipt that was only uploaded (uploads row exists, no receipts row)
    temp_repository.save_upload(
        receipt_id=str(uuid.uuid4()),
        original_filename="receipt.jpg",
        stored_filename="abc.jpg",
        content_type="image/jpeg",
    )

    # When the list endpoint is called
    response = client.get("/receipts")

    # Then it is not listed
    assert response.status_code == 200
    assert response.json() == {"items": [], "count": 0}


def test_list_item_matches_get_receipt_values_and_types_for_shared_fields(temp_repository):
    # Given a receipt saved with a known set of values
    data = make_receipt_data(store_name="Corner Store", purchase_date="2026-01-15", currency="USD", total=19.99)
    receipt_id = save_receipt(temp_repository, data)

    # When the receipt is fetched via GET /receipts/{id} and listed via GET /receipts
    get_response = client.get(f"/receipts/{receipt_id}")
    list_response = client.get("/receipts")

    # Then store_name, purchase_date, currency and total match in value and JSON type
    get_body = get_response.json()
    list_item = next(item for item in list_response.json()["items"] if item["receipt_id"] == receipt_id)

    for field in ["store_name", "purchase_date", "currency", "total"]:
        assert get_body[field] == list_item[field]
        assert type(get_body[field]) is type(list_item[field])


def test_get_receipt_and_health_still_work(temp_repository):
    # Given a saved receipt
    receipt_id = save_receipt(temp_repository)

    # When GET /receipts/{id} and GET /health are called
    get_response = client.get(f"/receipts/{receipt_id}")
    health_response = client.get("/health")

    # Then both still work as before
    assert get_response.status_code == 200
    assert health_response.status_code == 200
    assert health_response.json() == {"status": "ok"}
