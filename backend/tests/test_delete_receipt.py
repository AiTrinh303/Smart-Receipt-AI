import io
import uuid

import pytest
from fastapi.testclient import TestClient

import adapters.file_storage as file_storage
import api.routes as routes_module
import main
from adapters.sqlite_repository import SqliteReceiptRepository
from api.routes import get_extractor, get_repository
from domain.models import ReceiptData

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
    def __init__(self, data: ReceiptData | None = None, error: Exception | None = None):
        self._data = data
        self._error = error

    def extract(self, file_path):
        if self._error is not None:
            raise self._error
        return self._data


def override_extractor(extractor: FakeExtractor):
    main.app.dependency_overrides[get_extractor] = lambda: extractor


SAMPLE_RECEIPT_DATA = ReceiptData(
    store_name="Corner Store",
    purchase_date="2026-01-15",
    currency="USD",
    items=[],
    discounts=[],
    taxes=[],
    total=9.99,
)


def upload_and_extract(
    upload_dir, extension: str = ".jpg", content_type: str = "image/jpeg", filename: str = "receipt.jpg"
) -> str:
    """Goes through the real upload + extract endpoints so both an uploads
    row and a receipts row exist, and a real file sits in the uploads dir."""
    files = {"file": (filename, io.BytesIO(b"fake-bytes"), content_type)}
    upload_response = client.post("/receipts/upload", files=files)
    assert upload_response.status_code == 201
    receipt_id = upload_response.json()["receipt_id"]

    override_extractor(FakeExtractor(data=SAMPLE_RECEIPT_DATA))
    extract_response = client.post(f"/receipts/{receipt_id}/extract")
    assert extract_response.status_code == 200
    return receipt_id


def test_delete_a_fully_saved_receipt_removes_record_and_file(temp_upload_dir, temp_repository):
    # Given a receipt that has been uploaded and extracted
    receipt_id = upload_and_extract(temp_upload_dir)

    # When it is deleted
    response = client.delete(f"/receipts/{receipt_id}")

    # Then the response is 204
    assert response.status_code == 204
    assert response.text == ""

    # And GET for that id is now 404
    assert client.get(f"/receipts/{receipt_id}").status_code == 404

    # And it is absent from the history list
    list_body = client.get("/receipts").json()
    assert receipt_id not in [item["receipt_id"] for item in list_body["items"]]

    # And the file is gone from the uploads dir
    assert list(temp_upload_dir.glob(f"{receipt_id}.*")) == []

    # And both table rows are gone
    assert temp_repository.get_receipt(receipt_id) is None
    assert temp_repository.get_upload(receipt_id) is None


def test_deleting_the_same_id_twice_the_second_call_is_404(temp_upload_dir):
    # Given a receipt that has already been deleted once
    receipt_id = upload_and_extract(temp_upload_dir)
    first = client.delete(f"/receipts/{receipt_id}")
    assert first.status_code == 204

    # When it is deleted again
    second = client.delete(f"/receipts/{receipt_id}")

    # Then the second call is 404
    assert second.status_code == 404


def test_unknown_valid_uuid_returns_404_and_leaves_other_data_untouched(temp_upload_dir, temp_repository):
    # Given another, unrelated saved receipt
    other_id = upload_and_extract(temp_upload_dir, filename="other.jpg")
    unknown_id = str(uuid.uuid4())

    # When an unknown id is deleted
    response = client.delete(f"/receipts/{unknown_id}")

    # Then the response is 404, and the other receipt and its file are untouched
    assert response.status_code == 404
    assert temp_repository.get_receipt(other_id) is not None
    assert len(list(temp_upload_dir.glob(f"{other_id}.*"))) == 1


def test_deleting_one_receipt_leaves_a_second_receipt_intact(temp_upload_dir, temp_repository):
    # Given two saved receipts
    first_id = upload_and_extract(temp_upload_dir, filename="first.jpg")
    second_id = upload_and_extract(temp_upload_dir, filename="second.jpg")

    # When the first is deleted
    response = client.delete(f"/receipts/{first_id}")

    # Then the response is 204 and the second receipt's record and file are intact
    assert response.status_code == 204
    assert temp_repository.get_receipt(second_id) is not None
    assert len(list(temp_upload_dir.glob(f"{second_id}.*"))) == 1
    assert len(list(temp_upload_dir.glob(f"{first_id}.*"))) == 0


def test_non_uuid_id_is_rejected_and_sentinel_file_outside_uploads_is_untouched(
    temp_upload_dir, tmp_path_factory
):
    # Given a sentinel file placed outside the uploads directory
    sentinel_dir = tmp_path_factory.mktemp("outside")
    sentinel_file = sentinel_dir / "etc_passwd_sentinel"
    sentinel_file.write_text("do-not-touch")

    # When a path-traversal-looking, non-UUID id is deleted
    response = client.delete("/receipts/..%2F..%2Fetc%2Fpasswd")

    # Then the request is rejected (400 for an invalid UUID, or 404 if routing splits
    # the segments), and the sentinel file outside the uploads dir is untouched
    assert response.status_code in (400, 404)
    assert sentinel_file.read_text() == "do-not-touch"


def test_uploaded_but_never_extracted_returns_404_and_its_file_is_untouched(temp_upload_dir, temp_repository):
    # Given a receipt that was uploaded but never extracted
    files = {"file": ("receipt.jpg", io.BytesIO(b"fake-bytes"), "image/jpeg")}
    upload_response = client.post("/receipts/upload", files=files)
    receipt_id = upload_response.json()["receipt_id"]

    # When it is deleted
    response = client.delete(f"/receipts/{receipt_id}")

    # Then the response is 404 and its file is untouched
    assert response.status_code == 404
    assert len(list(temp_upload_dir.glob(f"{receipt_id}.*"))) == 1
    assert temp_repository.get_upload(receipt_id) is not None


def test_record_exists_but_file_already_removed_from_disk_still_returns_204(
    temp_upload_dir, temp_repository
):
    # Given a saved receipt whose file has already been removed from disk
    receipt_id = upload_and_extract(temp_upload_dir)
    for stored_file in temp_upload_dir.glob(f"{receipt_id}.*"):
        stored_file.unlink()

    # When it is deleted
    response = client.delete(f"/receipts/{receipt_id}")

    # Then the response is still 204 and the record is gone
    assert response.status_code == 204
    assert temp_repository.get_receipt(receipt_id) is None


def test_file_removal_failure_returns_500_record_still_exists_retry_succeeds(
    temp_upload_dir, temp_repository, monkeypatch
):
    # Given a saved receipt and a file-removal step that fails once
    receipt_id = upload_and_extract(temp_upload_dir)

    call_count = {"n": 0}
    real_delete_file = routes_module.delete_file

    def flaky_delete_file(validated_id):
        call_count["n"] += 1
        if call_count["n"] == 1:
            raise PermissionError("permission denied: /some/internal/path")
        return real_delete_file(validated_id)

    monkeypatch.setattr(routes_module, "delete_file", flaky_delete_file)

    # When the delete endpoint is called
    response = client.delete(f"/receipts/{receipt_id}")

    # Then the response is 500 with a generic message, no internal text leaks,
    # and the record still exists
    assert response.status_code == 500
    assert "permission denied" not in response.text
    assert "/some/internal/path" not in response.text
    assert temp_repository.get_receipt(receipt_id) is not None

    # When the same delete is retried (the flaky step now succeeds)
    retry_response = client.delete(f"/receipts/{receipt_id}")

    # Then it completes with 204
    assert retry_response.status_code == 204


def test_database_removal_failure_returns_500_retry_then_succeeds(temp_upload_dir, temp_repository):
    # Given a saved receipt and a repository whose delete_receipt fails once
    receipt_id = upload_and_extract(temp_upload_dir)

    class FlakyRepository:
        def __init__(self, real):
            self._real = real
            self._calls = 0

        def save_upload(self, *args, **kwargs):
            return self._real.save_upload(*args, **kwargs)

        def get_upload(self, receipt_id):
            return self._real.get_upload(receipt_id)

        def save_receipt(self, receipt_id, data):
            return self._real.save_receipt(receipt_id, data)

        def get_receipt(self, receipt_id):
            return self._real.get_receipt(receipt_id)

        def list_receipts(self, limit):
            return self._real.list_receipts(limit)

        def update_receipt(self, receipt_id, update):
            return self._real.update_receipt(receipt_id, update)

        def delete_receipt(self, receipt_id):
            self._calls += 1
            if self._calls == 1:
                raise RuntimeError("disk full: /some/internal/path leaked here")
            return self._real.delete_receipt(receipt_id)

    flaky = FlakyRepository(temp_repository)
    main.app.dependency_overrides[get_repository] = lambda: flaky

    # When the delete endpoint is called
    response = client.delete(f"/receipts/{receipt_id}")

    # Then the response is 500 with a generic message and no internal text leaks
    assert response.status_code == 500
    assert "disk full" not in response.text
    assert "/some/internal/path" not in response.text

    # When the same delete is retried (the flaky repository now succeeds)
    retry_response = client.delete(f"/receipts/{receipt_id}")

    # Then it completes with 204
    assert retry_response.status_code == 204


def test_get_put_list_and_health_still_work(temp_upload_dir):
    # Given a saved receipt
    receipt_id = upload_and_extract(temp_upload_dir)

    # When GET, PUT, GET list and health are called
    get_response = client.get(f"/receipts/{receipt_id}")
    put_response = client.put(
        f"/receipts/{receipt_id}",
        json={
            "store_name": "Corner Store",
            "purchase_date": "2026-01-15",
            "currency": "USD",
            "items": [],
            "discounts": [],
            "taxes": [],
            "total": 9.99,
        },
    )
    list_response = client.get("/receipts")
    health_response = client.get("/health")

    # Then all of them still work as before
    assert get_response.status_code == 200
    assert put_response.status_code == 200
    assert list_response.status_code == 200
    assert health_response.status_code == 200
    assert health_response.json() == {"status": "ok"}
