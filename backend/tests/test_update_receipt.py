import json
import sqlite3
import time
import uuid

import pytest
from fastapi.testclient import TestClient

import main
from adapters.sqlite_repository import SqliteReceiptRepository
from api.routes import get_repository
from domain.models import ReceiptData, ReceiptUpdate

client = TestClient(main.app)


@pytest.fixture(autouse=True)
def temp_repository(tmp_path):
    repository = SqliteReceiptRepository(tmp_path / "test.db")
    main.app.dependency_overrides[get_repository] = lambda: repository
    yield repository
    main.app.dependency_overrides.clear()


def seed_receipt(repository, receipt_id: str | None = None, **overrides) -> str:
    receipt_id = receipt_id or str(uuid.uuid4())
    data = ReceiptData(
        store_name="Corner Store",
        purchase_date="2026-01-15",
        currency="USD",
        items=[{"name": "Milk", "quantity": 1, "unit_price": 2.5, "line_total": 2.5}],
        discounts=[],
        taxes=[],
        total=2.5,
    )
    data = data.model_copy(update=overrides) if overrides else data
    repository.save_receipt(receipt_id, data)
    return receipt_id


def valid_update_body(**overrides) -> dict:
    body = {
        "store_name": "Corrected Store",
        "purchase_date": "2026-01-16",
        "currency": "EUR",
        "items": [{"name": "Bread", "quantity": 2, "unit_price": 3.0, "line_total": 6.0}],
        "discounts": [],
        "taxes": [],
        "total": 6.0,
    }
    body.update(overrides)
    return body


def test_put_corrected_values_then_get_returns_corrected_values(temp_repository):
    # Given a saved receipt
    receipt_id = seed_receipt(temp_repository)

    # When the user PUTs a corrected store_name and total
    put_response = client.put(
        f"/receipts/{receipt_id}",
        json=valid_update_body(store_name="Fixed Store", total=99.0),
    )

    # Then the response is 200, and a following GET returns the corrected values
    assert put_response.status_code == 200
    get_response = client.get(f"/receipts/{receipt_id}")
    assert get_response.status_code == 200
    body = get_response.json()
    assert body["store_name"] == "Fixed Store"
    assert body["total"] == 99.0


def test_persistence_across_new_repository_instance(tmp_path):
    # Given a corrected receipt saved via one repository instance
    db_path = tmp_path / "persist.db"
    repository = SqliteReceiptRepository(db_path)
    receipt_id = seed_receipt(repository)
    repository.update_receipt(
        receipt_id,
        ReceiptUpdate(**valid_update_body(store_name="Persisted Store")),
    )

    # When a brand new repository instance is created against the same file
    restarted = SqliteReceiptRepository(db_path)
    saved = restarted.get_receipt(receipt_id)

    # Then the corrected data is still there
    assert saved is not None
    assert saved.store_name == "Persisted Store"


def test_ai_result_json_is_byte_for_byte_identical_before_and_after_put(temp_repository):
    # Given a saved receipt
    receipt_id = seed_receipt(temp_repository)
    db_path = temp_repository._database_path
    conn = sqlite3.connect(db_path)
    before = conn.execute(
        "SELECT ai_result_json FROM receipts WHERE receipt_id = ?", (receipt_id,)
    ).fetchone()[0]
    conn.close()

    # When the receipt is corrected via PUT
    response = client.put(f"/receipts/{receipt_id}", json=valid_update_body())
    assert response.status_code == 200

    # Then ai_result_json is byte-for-byte unchanged
    conn = sqlite3.connect(db_path)
    after = conn.execute(
        "SELECT ai_result_json FROM receipts WHERE receipt_id = ?", (receipt_id,)
    ).fetchone()[0]
    conn.close()
    assert before == after


def test_created_at_unchanged_updated_at_changed(temp_repository):
    # Given a saved receipt
    receipt_id = seed_receipt(temp_repository)
    first = temp_repository.get_receipt(receipt_id)

    # When it is corrected via PUT a moment later
    time.sleep(0.01)
    response = client.put(f"/receipts/{receipt_id}", json=valid_update_body())
    assert response.status_code == 200

    # Then created_at is unchanged and updated_at has changed
    second = temp_repository.get_receipt(receipt_id)
    assert second.created_at == first.created_at
    assert second.updated_at != first.updated_at


def test_list_shows_corrected_values_after_put(temp_repository):
    # Given a saved receipt
    receipt_id = seed_receipt(temp_repository)

    # When it is corrected via PUT
    response = client.put(
        f"/receipts/{receipt_id}", json=valid_update_body(store_name="Listed Store", total=42.0)
    )
    assert response.status_code == 200

    # Then the history list shows the corrected store_name and total
    list_response = client.get("/receipts")
    item = next(i for i in list_response.json()["items"] if i["receipt_id"] == receipt_id)
    assert item["store_name"] == "Listed Store"
    assert item["total"] == 42.0


def test_put_and_get_responses_share_key_set_and_types(temp_repository):
    # Given a saved receipt
    receipt_id = seed_receipt(temp_repository)

    # When it is corrected via PUT
    put_response = client.put(f"/receipts/{receipt_id}", json=valid_update_body())
    get_response = client.get(f"/receipts/{receipt_id}")

    put_body = put_response.json()
    get_body = get_response.json()

    # Then both responses have the same key set and the same JSON types
    assert set(put_body.keys()) == set(get_body.keys())
    for key in put_body:
        assert type(put_body[key]) is type(get_body[key])


def test_unknown_valid_uuid_returns_404(temp_repository):
    # Given a syntactically valid UUID with nothing saved for it
    unknown_id = str(uuid.uuid4())

    # When it is PUT
    response = client.put(f"/receipts/{unknown_id}", json=valid_update_body())

    # Then the response is 404 and no record was created
    assert response.status_code == 404
    assert temp_repository.get_receipt(unknown_id) is None


def test_non_uuid_id_is_rejected(temp_repository):
    # Given a receipt_id that is not a valid UUID and contains a path-traversal attempt
    # When it is PUT
    response = client.put("/receipts/..%2F..%2Fetc%2Fpasswd", json=valid_update_body())

    # Then the request is rejected (400 for an invalid UUID, or 404 if routing splits
    # the segments), and nothing is created
    assert response.status_code in (400, 404)


def test_uploaded_but_never_extracted_returns_404(temp_repository):
    # Given an uploads row exists but no receipts row (never extracted)
    receipt_id = str(uuid.uuid4())
    temp_repository.save_upload(
        receipt_id=receipt_id,
        original_filename="receipt.jpg",
        stored_filename=f"{receipt_id}.jpg",
        content_type="image/jpeg",
    )

    # When it is PUT
    response = client.put(f"/receipts/{receipt_id}", json=valid_update_body())

    # Then the response is 404 and no receipt record was created
    assert response.status_code == 404
    assert temp_repository.get_receipt(receipt_id) is None


@pytest.mark.parametrize(
    "overrides",
    [
        {"purchase_date": "13/45/2026"},
        {"purchase_date": "tomorrow"},
        {"total": "abc"},
        {"items": [{"name": "Milk", "quantity": 0, "unit_price": 1.0, "line_total": 1.0}]},
        {"items": [{"name": "Milk", "quantity": -1, "unit_price": 1.0, "line_total": 1.0}]},
        {"items": [{"name": "", "quantity": 1, "unit_price": 1.0, "line_total": 1.0}]},
        {"unexpected_field": "oops"},
        {"items": [{"name": "Milk", "quantity": 1, "unit_price": 1.0, "line_total": 1.0}] * 201},
    ],
)
def test_invalid_input_returns_422_and_leaves_data_unchanged(temp_repository, overrides):
    # Given a saved receipt
    receipt_id = seed_receipt(temp_repository)
    before = temp_repository.get_receipt(receipt_id)

    # When an invalid correction is PUT
    response = client.put(f"/receipts/{receipt_id}", json=valid_update_body(**overrides))

    # Then the response is 422 and the stored data is unchanged
    assert response.status_code == 422
    after = temp_repository.get_receipt(receipt_id)
    assert after.store_name == before.store_name
    assert after.total == before.total
    assert after.updated_at == before.updated_at


def test_total_nan_returns_422_and_leaves_data_unchanged(temp_repository):
    # Given a saved receipt
    receipt_id = seed_receipt(temp_repository)
    before = temp_repository.get_receipt(receipt_id)

    # When a correction with total: NaN is PUT (sent as raw JSON text, since
    # httpx's own JSON encoder refuses to serialize NaN at all -- this proves
    # the server rejects it, not just the client library)
    raw_body = json.dumps(valid_update_body(total=float("nan")), allow_nan=True)
    response = client.put(
        f"/receipts/{receipt_id}",
        content=raw_body,
        headers={"content-type": "application/json"},
    )

    # Then the response is 422 and the stored data is unchanged
    assert response.status_code == 422
    after = temp_repository.get_receipt(receipt_id)
    assert after.store_name == before.store_name
    assert after.total == before.total
    assert after.updated_at == before.updated_at


def test_all_fields_null_and_empty_lists_are_accepted(temp_repository):
    # Given a saved receipt
    receipt_id = seed_receipt(temp_repository)

    # When every field is corrected to null/empty
    response = client.put(
        f"/receipts/{receipt_id}",
        json={
            "store_name": None,
            "purchase_date": None,
            "currency": None,
            "items": [],
            "discounts": [],
            "taxes": [],
            "total": None,
        },
    )

    # Then the response is 200 and the nulls/empty lists are saved
    assert response.status_code == 200
    body = response.json()
    assert body["store_name"] is None
    assert body["purchase_date"] is None
    assert body["currency"] is None
    assert body["items"] == []
    assert body["discounts"] == []
    assert body["taxes"] == []
    assert body["total"] is None


def test_negative_discount_amount_is_accepted(temp_repository):
    # Given a saved receipt
    receipt_id = seed_receipt(temp_repository)

    # When a correction includes a negative discount amount (a valid refund/discount line)
    response = client.put(
        f"/receipts/{receipt_id}",
        json=valid_update_body(discounts=[{"description": "Loyalty discount", "amount": -1.5}]),
    )

    # Then the response is 200 and the negative amount is saved as-is
    assert response.status_code == 200
    assert response.json()["discounts"] == [{"description": "Loyalty discount", "amount": -1.5}]


def test_repository_failure_returns_500_with_generic_message(temp_repository):
    # Given a saved receipt and a repository whose update_receipt fails
    receipt_id = seed_receipt(temp_repository)

    class FailingRepository:
        def save_upload(self, *args, **kwargs):
            pass

        def get_upload(self, receipt_id):
            return None

        def save_receipt(self, receipt_id, data):
            pass

        def get_receipt(self, receipt_id):
            return temp_repository.get_receipt(receipt_id)

        def list_receipts(self, limit):
            return []

        def update_receipt(self, receipt_id, update):
            raise RuntimeError("disk full: /some/internal/path leaked here")

    main.app.dependency_overrides[get_repository] = lambda: FailingRepository()

    # When the update endpoint is called
    response = client.put(f"/receipts/{receipt_id}", json=valid_update_body())

    # Then the response is 500 with a generic message, and no internal error text leaks
    assert response.status_code == 500
    assert "disk full" not in response.text
    assert "/some/internal/path" not in response.text


def test_get_get_list_and_health_still_work(temp_repository):
    # Given a saved receipt
    receipt_id = seed_receipt(temp_repository)

    # When GET, GET list and health are called
    get_response = client.get(f"/receipts/{receipt_id}")
    list_response = client.get("/receipts")
    health_response = client.get("/health")

    # Then all three still work as before
    assert get_response.status_code == 200
    assert list_response.status_code == 200
    assert health_response.status_code == 200
    assert health_response.json() == {"status": "ok"}
