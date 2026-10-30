import io
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


def make_data(**overrides) -> ReceiptData:
    defaults = dict(
        store_name="Corner Store",
        purchase_date="2026-01-15",
        currency="USD",
        items=[],
        discounts=[],
        taxes=[],
        total=19.99,
    )
    defaults.update(overrides)
    return ReceiptData(**defaults)


def upload_file(apartment_id: str = VALID_APARTMENT_ID) -> str:
    files = {"file": ("receipt.jpg", io.BytesIO(b"fake-bytes"), "image/jpeg")}
    response = upload_with_apartment(client, files, apartment_id=apartment_id)
    assert response.status_code == 201
    return response.json()["receipt_id"]


def store_file_without_upload(upload_dir, extension: str = ".jpg") -> str:
    """A receipt file on disk with no uploads row at all -- extracting it
    saves a null apartment_id, same as test_apartments.py's own pattern."""
    receipt_id = str(uuid.uuid4())
    (upload_dir / f"{receipt_id}{extension}").write_bytes(b"fake-bytes")
    return receipt_id


def extract(receipt_id: str, data: ReceiptData) -> dict:
    override_extractor(FakeExtractor(data=data))
    response = client.post(f"/receipts/{receipt_id}/extract")
    assert response.status_code == 200
    return response.json()


def set_category(receipt_id: str, category_id: str = "cleaning"):
    return client.put(f"/receipts/{receipt_id}/category", json={"category_id": category_id})


def set_status(receipt_id: str, status: str):
    return client.put(f"/receipts/{receipt_id}/status", json={"status": status})


def complete_receipt(upload_dir) -> str:
    """A receipt with everything approval requires: apartment, category,
    valid ISO date, total."""
    receipt_id = upload_file()
    extract(receipt_id, make_data())
    response = set_category(receipt_id)
    assert response.status_code == 200
    return receipt_id


# --- PUT /receipts/{id}/category ------------------------------------------


def test_set_then_change_category_shows_in_get_and_list(temp_upload_dir):
    # Given an extracted receipt
    receipt_id = upload_file()
    extract(receipt_id, make_data())

    # When its category is set, then changed
    first_response = set_category(receipt_id, "cleaning")
    second_response = set_category(receipt_id, "repairs")

    # Then both GET and the list reflect the latest category
    assert first_response.status_code == 200
    assert first_response.json()["category_id"] == "cleaning"
    assert second_response.status_code == 200
    assert second_response.json()["category_id"] == "repairs"
    assert second_response.json()["category_name"] == "Repairs and maintenance"

    get_body = client.get(f"/receipts/{receipt_id}").json()
    assert get_body["category_id"] == "repairs"

    list_item = next(i for i in client.get("/receipts").json()["items"] if i["receipt_id"] == receipt_id)
    assert list_item["category_id"] == "repairs"
    assert list_item["category_name"] == "Repairs and maintenance"


def test_category_update_non_uuid_id_returns_400():
    response = set_category("not-a-uuid")
    assert response.status_code == 400


def test_category_update_unknown_receipt_returns_404():
    response = set_category(str(uuid.uuid4()))
    assert response.status_code == 404


def test_category_update_uploaded_but_never_extracted_returns_404(temp_upload_dir):
    receipt_id = upload_file()
    response = set_category(receipt_id)
    assert response.status_code == 404


def test_category_update_unknown_category_returns_422(temp_upload_dir):
    receipt_id = upload_file()
    extract(receipt_id, make_data())
    response = set_category(receipt_id, "does-not-exist")
    assert response.status_code == 422


def test_category_update_inactive_category_returns_422(temp_upload_dir, temp_repository):
    receipt_id = upload_file()
    extract(receipt_id, make_data())
    with temp_repository._connect() as conn:
        conn.execute("UPDATE categories SET active = 0 WHERE id = ?", ("cleaning",))
        conn.commit()

    response = set_category(receipt_id, "cleaning")
    assert response.status_code == 422


def test_category_update_null_category_returns_422(temp_upload_dir):
    receipt_id = upload_file()
    extract(receipt_id, make_data())
    response = client.put(f"/receipts/{receipt_id}/category", json={"category_id": None})
    assert response.status_code == 422


def test_category_update_missing_category_id_returns_422(temp_upload_dir):
    receipt_id = upload_file()
    extract(receipt_id, make_data())
    response = client.put(f"/receipts/{receipt_id}/category", json={})
    assert response.status_code == 422


def test_category_update_rejects_unknown_fields(temp_upload_dir):
    receipt_id = upload_file()
    extract(receipt_id, make_data())
    response = client.put(
        f"/receipts/{receipt_id}/category",
        json={"category_id": "cleaning", "store_name": "Sneaky"},
    )
    assert response.status_code == 422


def test_category_update_repository_failure_returns_500(temp_upload_dir, temp_repository):
    receipt_id = upload_file()
    extract(receipt_id, make_data())

    class FlakyRepository:
        def __init__(self, real):
            self._real = real

        def __getattr__(self, name):
            return getattr(self._real, name)

        def set_receipt_category(self, receipt_id, category_id):
            raise RuntimeError("disk full: /some/internal/path leaked here")

    main.app.dependency_overrides[get_repository] = lambda: FlakyRepository(temp_repository)

    response = set_category(receipt_id, "cleaning")

    assert response.status_code == 500
    assert "disk full" not in response.text
    assert "/some/internal/path" not in response.text


def test_category_update_leaves_extracted_ai_result_edited_at_and_created_at_unchanged(
    temp_upload_dir, temp_repository
):
    # Given an extracted, then edited, receipt
    receipt_id = upload_file()
    extract(receipt_id, make_data())
    client.put(
        f"/receipts/{receipt_id}",
        json={
            "store_name": "Edited Store", "purchase_date": "2026-01-15", "currency": "USD",
            "items": [], "discounts": [], "taxes": [], "total": 10.0,
        },
    )
    with temp_repository._connect() as conn:
        before = conn.execute(
            "SELECT extracted_json, ai_result_json, edited_at, created_at FROM receipts WHERE receipt_id = ?",
            (receipt_id,),
        ).fetchone()

    # When its category is changed
    response = set_category(receipt_id, "repairs")
    assert response.status_code == 200

    # Then extracted_json, ai_result_json, edited_at and created_at are all unchanged
    with temp_repository._connect() as conn:
        after = conn.execute(
            "SELECT extracted_json, ai_result_json, edited_at, created_at FROM receipts WHERE receipt_id = ?",
            (receipt_id,),
        ).fetchone()
    assert after == before


# --- PUT /receipts/{id}/status ---------------------------------------------


def test_approve_a_complete_receipt_succeeds(temp_upload_dir):
    # Given a receipt with apartment, category, a valid date and a total
    receipt_id = complete_receipt(temp_upload_dir)

    # When it is approved
    response = set_status(receipt_id, ReceiptStatus.APPROVED)

    # Then it succeeds
    assert response.status_code == 200
    assert response.json()["status"] == ReceiptStatus.APPROVED


def test_approve_missing_apartment_returns_422_with_missing_list(temp_upload_dir):
    # Given a receipt extracted without ever going through upload (no
    # apartment), but with category, date and total present
    receipt_id = store_file_without_upload(temp_upload_dir)
    extract(receipt_id, make_data())
    set_category(receipt_id)

    # When it is approved
    response = set_status(receipt_id, ReceiptStatus.APPROVED)

    # Then it is rejected, listing only "apartment" as missing
    assert response.status_code == 422
    detail = response.json()["detail"]
    assert detail["missing"] == ["apartment"]
    assert "message" in detail


def test_approve_missing_category_returns_422_with_missing_list(temp_upload_dir):
    # Given a complete receipt except no category was ever set
    receipt_id = upload_file()
    extract(receipt_id, make_data())

    # When it is approved
    response = set_status(receipt_id, ReceiptStatus.APPROVED)

    # Then it is rejected, listing only "category" as missing
    assert response.status_code == 422
    assert response.json()["detail"]["missing"] == ["category"]


def test_approve_missing_date_returns_422_with_missing_list(temp_upload_dir):
    # Given a receipt with no purchase date at all
    receipt_id = upload_file()
    extract(receipt_id, make_data(purchase_date=None))
    set_category(receipt_id)

    # When it is approved
    response = set_status(receipt_id, ReceiptStatus.APPROVED)

    # Then it is rejected, listing only "date" as missing
    assert response.status_code == 422
    assert response.json()["detail"]["missing"] == ["date"]


def test_approve_non_iso_date_blocks_approval(temp_upload_dir):
    # Given a receipt whose date is free text that never normalizes to an ISO date
    receipt_id = upload_file()
    extract(receipt_id, make_data(purchase_date="26/06/2025"))
    set_category(receipt_id)

    # When it is approved
    response = set_status(receipt_id, ReceiptStatus.APPROVED)

    # Then it is rejected, listing "date" as missing
    assert response.status_code == 422
    assert response.json()["detail"]["missing"] == ["date"]


def test_approve_missing_total_returns_422_with_missing_list(temp_upload_dir):
    # Given a receipt with no total
    receipt_id = upload_file()
    extract(receipt_id, make_data(total=None))
    set_category(receipt_id)

    # When it is approved
    response = set_status(receipt_id, ReceiptStatus.APPROVED)

    # Then it is rejected, listing only "total" as missing
    assert response.status_code == 422
    assert response.json()["detail"]["missing"] == ["total"]


def test_approve_missing_everything_returns_422_with_all_missing_in_order(temp_upload_dir):
    # Given a receipt missing apartment, category, date and total all at once
    receipt_id = store_file_without_upload(temp_upload_dir)
    extract(receipt_id, make_data(purchase_date=None, total=None))

    # When it is approved
    response = set_status(receipt_id, ReceiptStatus.APPROVED)

    # Then all four are listed, in the fixed canonical order
    assert response.status_code == 422
    assert response.json()["detail"]["missing"] == ["apartment", "category", "date", "total"]


def test_approve_then_set_back_to_needs_review(temp_upload_dir):
    # Given an approved, complete receipt
    receipt_id = complete_receipt(temp_upload_dir)
    approve_response = set_status(receipt_id, ReceiptStatus.APPROVED)
    assert approve_response.json()["status"] == ReceiptStatus.APPROVED

    # When it is set back to needs_review
    response = set_status(receipt_id, ReceiptStatus.NEEDS_REVIEW)

    # Then it succeeds
    assert response.status_code == 200
    assert response.json()["status"] == ReceiptStatus.NEEDS_REVIEW


def test_setting_needs_review_is_always_allowed_even_when_incomplete(temp_upload_dir):
    # Given a receipt missing everything required for approval
    receipt_id = store_file_without_upload(temp_upload_dir)
    extract(receipt_id, make_data(purchase_date=None, total=None))

    # When it is set to needs_review (its current default)
    response = set_status(receipt_id, ReceiptStatus.NEEDS_REVIEW)

    # Then it succeeds -- needs_review is always allowed
    assert response.status_code == 200
    assert response.json()["status"] == ReceiptStatus.NEEDS_REVIEW


def test_warnings_do_not_block_approval(temp_upload_dir):
    # Given a complete receipt whose line total doesn't match quantity x unit
    # price, which triggers a LINE_MISMATCH warning
    receipt_id = upload_file()
    extract(
        receipt_id,
        make_data(items=[{"name": "Milk", "quantity": 1, "unit_price": 2.5, "line_total": 999.0}]),
    )
    set_category(receipt_id)
    get_body = client.get(f"/receipts/{receipt_id}").json()
    assert len(get_body["warnings"]) > 0

    # When it is approved
    response = set_status(receipt_id, ReceiptStatus.APPROVED)

    # Then it still succeeds -- the user decides despite the warning
    assert response.status_code == 200
    assert response.json()["status"] == ReceiptStatus.APPROVED
    assert len(response.json()["warnings"]) > 0


def test_status_update_non_uuid_id_returns_400():
    response = set_status("not-a-uuid", ReceiptStatus.APPROVED)
    assert response.status_code == 400


def test_status_update_unknown_receipt_returns_404():
    response = set_status(str(uuid.uuid4()), ReceiptStatus.APPROVED)
    assert response.status_code == 404


def test_status_update_uploaded_but_never_extracted_returns_404(temp_upload_dir):
    receipt_id = upload_file()
    response = set_status(receipt_id, ReceiptStatus.APPROVED)
    assert response.status_code == 404


def test_status_update_invalid_status_value_returns_422(temp_upload_dir):
    receipt_id = upload_file()
    extract(receipt_id, make_data())
    response = client.put(f"/receipts/{receipt_id}/status", json={"status": "archived"})
    assert response.status_code == 422


def test_status_update_missing_status_returns_422(temp_upload_dir):
    receipt_id = upload_file()
    extract(receipt_id, make_data())
    response = client.put(f"/receipts/{receipt_id}/status", json={})
    assert response.status_code == 422


def test_status_update_rejects_unknown_fields(temp_upload_dir):
    receipt_id = upload_file()
    extract(receipt_id, make_data())
    response = client.put(
        f"/receipts/{receipt_id}/status",
        json={"status": ReceiptStatus.NEEDS_REVIEW, "store_name": "Sneaky"},
    )
    assert response.status_code == 422


def test_status_update_repository_failure_returns_500(temp_upload_dir, temp_repository):
    receipt_id = complete_receipt(temp_upload_dir)

    class FlakyRepository:
        def __init__(self, real):
            self._real = real

        def __getattr__(self, name):
            return getattr(self._real, name)

        def set_receipt_status(self, receipt_id, status):
            raise RuntimeError("disk full: /some/internal/path leaked here")

    main.app.dependency_overrides[get_repository] = lambda: FlakyRepository(temp_repository)

    response = set_status(receipt_id, ReceiptStatus.APPROVED)

    assert response.status_code == 500
    assert "disk full" not in response.text
    assert "/some/internal/path" not in response.text


def test_status_update_leaves_extracted_ai_result_edited_at_and_created_at_unchanged(
    temp_upload_dir, temp_repository
):
    # Given a complete, then edited, receipt
    receipt_id = complete_receipt(temp_upload_dir)
    client.put(
        f"/receipts/{receipt_id}",
        json={
            "store_name": "Edited Store", "purchase_date": "2026-01-15", "currency": "USD",
            "items": [], "discounts": [], "taxes": [], "total": 10.0,
        },
    )
    with temp_repository._connect() as conn:
        before = conn.execute(
            "SELECT extracted_json, ai_result_json, edited_at, created_at FROM receipts WHERE receipt_id = ?",
            (receipt_id,),
        ).fetchone()

    # When it is approved
    response = set_status(receipt_id, ReceiptStatus.APPROVED)
    assert response.status_code == 200

    # Then extracted_json, ai_result_json, edited_at and created_at are all unchanged
    with temp_repository._connect() as conn:
        after = conn.execute(
            "SELECT extracted_json, ai_result_json, edited_at, created_at FROM receipts WHERE receipt_id = ?",
            (receipt_id,),
        ).fetchone()
    assert after == before


# --- Editing an approved receipt (documents existing behavior, no new logic) --


def test_editing_an_approved_receipt_keeps_it_approved(temp_upload_dir):
    # Given an approved, complete receipt
    receipt_id = complete_receipt(temp_upload_dir)
    set_status(receipt_id, ReceiptStatus.APPROVED)

    # When its data is corrected via PUT /receipts/{id}
    response = client.put(
        f"/receipts/{receipt_id}",
        json={
            "store_name": "Corrected Store", "purchase_date": "2026-01-15", "currency": "USD",
            "items": [], "discounts": [], "taxes": [], "total": 25.0,
        },
    )

    # Then the receipt stays approved -- editing data never silently resets
    # the review status (this documents current behavior; no gate exists on
    # this endpoint, and the ticket deliberately asks for no new logic here)
    assert response.status_code == 200
    assert response.json()["status"] == ReceiptStatus.APPROVED
