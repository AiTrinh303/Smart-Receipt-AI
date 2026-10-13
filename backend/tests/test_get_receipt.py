import io
import uuid

import pytest
from fastapi.testclient import TestClient

import adapters.file_storage as file_storage
import main
from adapters.sqlite_repository import SqliteReceiptRepository
from api.routes import get_extractor, get_repository
from domain.models import ReceiptData
from domain.ports import ExtractionError

client = TestClient(main.app)


@pytest.fixture(autouse=True)
def temp_upload_dir(tmp_path, monkeypatch):
    monkeypatch.setattr(file_storage, "UPLOAD_DIR", tmp_path)
    return tmp_path


@pytest.fixture(autouse=True)
def temp_repository(tmp_path_factory):
    # Uses a directory separate from temp_upload_dir's tmp_path so the
    # database file never shows up in any uploads-directory listing.
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


def store_file(upload_dir, extension: str, content: bytes = b"fake-bytes") -> str:
    receipt_id = str(uuid.uuid4())
    (upload_dir / f"{receipt_id}{extension}").write_bytes(content)
    return receipt_id


def upload_file(
    extension: str = ".jpg",
    original_filename: str = "receipt.jpg",
    content_type: str = "image/jpeg",
) -> str:
    """Goes through the real upload endpoint so an uploads row is recorded."""
    files = {"file": (original_filename, io.BytesIO(b"fake-bytes"), content_type)}
    response = client.post("/receipts/upload", files=files)
    assert response.status_code == 201
    return response.json()["receipt_id"]


SAMPLE_RECEIPT_DATA = ReceiptData(
    store_name="Corner Store",
    purchase_date="2026-01-15",
    currency="USD",
    items=[{"name": "Milk", "quantity": 1, "unit_price": 2.5, "line_total": 2.5}],
    discounts=[{"description": "Loyalty discount", "amount": 0.5}],
    taxes=[{"description": "Sales tax", "amount": 0.2}],
    total=19.99,
)

EXTRACTED_FIELD_NAMES = [
    "receipt_id",
    "store_name",
    "purchase_date",
    "currency",
    "items",
    "discounts",
    "taxes",
    "total",
]


def test_extract_then_get_returns_saved_data(temp_upload_dir):
    # Given a receipt uploaded through the real upload endpoint (so an uploads row exists)
    # and the extractor returns valid data
    receipt_id = upload_file()
    override_extractor(FakeExtractor(data=SAMPLE_RECEIPT_DATA))

    # When the receipt is extracted and then fetched
    extract_response = client.post(f"/receipts/{receipt_id}/extract")
    assert extract_response.status_code == 200
    get_response = client.get(f"/receipts/{receipt_id}")

    # Then GET returns 200 with the saved data
    assert get_response.status_code == 200
    body = get_response.json()
    assert body["receipt_id"] == receipt_id
    assert body["original_filename"] == "receipt.jpg"
    assert body["content_type"] == "image/jpeg"
    assert body["store_name"] == "Corner Store"
    assert body["total"] == 19.99
    assert body["created_at"]
    assert body["updated_at"]


def test_extract_and_get_responses_share_key_set_and_types_for_extracted_fields(
    temp_upload_dir,
):
    # Given a receipt uploaded and extracted
    receipt_id = upload_file()
    override_extractor(FakeExtractor(data=SAMPLE_RECEIPT_DATA))
    extract_response = client.post(f"/receipts/{receipt_id}/extract")
    get_response = client.get(f"/receipts/{receipt_id}")

    extract_body = extract_response.json()
    get_body = get_response.json()

    # Then every extracted field is present in both responses with the same value type
    for field in EXTRACTED_FIELD_NAMES:
        assert field in extract_body
        assert field in get_body
        assert type(extract_body[field]) is type(get_body[field])

    # And the actual values for the extracted fields match exactly
    assert extract_body["receipt_id"] == get_body["receipt_id"]
    assert extract_body["total"] == get_body["total"]
    assert extract_body["items"] == get_body["items"]
    assert extract_body["discounts"] == get_body["discounts"]
    assert extract_body["taxes"] == get_body["taxes"]


def test_unknown_valid_uuid_returns_404(temp_upload_dir):
    # Given a syntactically valid UUID with nothing ever saved for it
    unknown_id = str(uuid.uuid4())

    # When it is fetched
    response = client.get(f"/receipts/{unknown_id}")

    # Then the response is 404
    assert response.status_code == 404


def test_uploaded_but_never_extracted_returns_404(temp_upload_dir):
    # Given a receipt that was uploaded but never extracted
    receipt_id = upload_file()

    # When it is fetched
    response = client.get(f"/receipts/{receipt_id}")

    # Then the response is 404
    assert response.status_code == 404


def test_non_uuid_id_is_rejected(temp_upload_dir):
    # Given a receipt_id that is not a valid UUID and contains a path-traversal attempt
    # When it is fetched
    response = client.get("/receipts/..%2F..%2Fetc%2Fpasswd")

    # Then the request is rejected (400 for an invalid UUID, or 404 if routing splits
    # the segments), and nothing outside the data is ever read
    assert response.status_code in (400, 404)


def test_extractor_error_saves_nothing(temp_upload_dir, temp_repository):
    # Given a stored receipt and an extractor that fails
    receipt_id = store_file(temp_upload_dir, ".jpg")
    override_extractor(FakeExtractor(error=ExtractionError("boom")))

    # When the extract endpoint is called
    response = client.post(f"/receipts/{receipt_id}/extract")

    # Then the response is 502 and nothing was saved
    assert response.status_code == 502
    assert temp_repository.get_receipt(receipt_id) is None


def test_repository_save_failure_returns_500_with_generic_message(temp_upload_dir):
    # Given a stored receipt, a working extractor, and a repository whose save_receipt fails
    receipt_id = store_file(temp_upload_dir, ".jpg")
    override_extractor(FakeExtractor(data=SAMPLE_RECEIPT_DATA))

    class FailingRepository:
        def save_upload(self, *args, **kwargs):
            pass

        def get_upload(self, receipt_id):
            return None

        def save_receipt(self, receipt_id, data):
            raise RuntimeError("disk full: /some/internal/path leaked here")

        def get_receipt(self, receipt_id):
            return None

    main.app.dependency_overrides[get_repository] = lambda: FailingRepository()

    # When the extract endpoint is called
    response = client.post(f"/receipts/{receipt_id}/extract")

    # Then the response is 500 with a generic message, and no internal error text leaks
    assert response.status_code == 500
    assert "disk full" not in response.text
    assert "/some/internal/path" not in response.text


def test_extract_on_pre_existing_upload_without_uploads_row_saves_with_null_original_filename(
    temp_upload_dir,
):
    # Given a receipt file that exists on disk but was never recorded in the uploads
    # table (simulating a file uploaded before this feature existed)
    receipt_id = store_file(temp_upload_dir, ".jpg")
    override_extractor(FakeExtractor(data=SAMPLE_RECEIPT_DATA))

    # When it is extracted and then fetched
    extract_response = client.post(f"/receipts/{receipt_id}/extract")
    get_response = client.get(f"/receipts/{receipt_id}")

    # Then extraction still succeeds, is saved, and original_filename is null
    assert extract_response.status_code == 200
    assert get_response.status_code == 200
    assert get_response.json()["original_filename"] is None
