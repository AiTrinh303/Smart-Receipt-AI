import io
import uuid

import pytest
from fastapi.testclient import TestClient

import adapters.file_storage as file_storage
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
    def __init__(self, data: ReceiptData | None = None):
        self._data = data

    def extract(self, file_path):
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


def upload_and_extract(contents: bytes, filename: str, content_type: str) -> str:
    """Goes through the real upload + extract endpoints so both an uploads
    row and a receipts row exist, and a real file sits in the uploads dir."""
    files = {"file": (filename, io.BytesIO(contents), content_type)}
    upload_response = client.post("/receipts/upload", files=files)
    assert upload_response.status_code == 201
    receipt_id = upload_response.json()["receipt_id"]

    override_extractor(FakeExtractor(data=SAMPLE_RECEIPT_DATA))
    extract_response = client.post(f"/receipts/{receipt_id}/extract")
    assert extract_response.status_code == 200
    return receipt_id


PNG_BYTES = b"\x89PNG\r\n\x1a\nfake-but-good-enough-for-tests"
JPG_BYTES = b"\xff\xd8\xff\xe0fake-but-good-enough-for-tests"
PDF_BYTES = b"%PDF-1.4 fake but good enough for tests"


def test_png_file_is_served_with_the_fixed_media_type(temp_upload_dir):
    # Given a saved receipt whose original upload was a PNG
    receipt_id = upload_and_extract(PNG_BYTES, "receipt.png", "image/png")

    # When its file is fetched
    response = client.get(f"/receipts/{receipt_id}/file")

    # Then the response is the original bytes with the expected headers
    assert response.status_code == 200
    assert response.content == PNG_BYTES
    assert response.headers["content-type"] == "image/png"
    assert response.headers["x-content-type-options"] == "nosniff"
    assert response.headers["content-disposition"] == "inline"
    assert response.headers["cache-control"] == "private, no-cache"


def test_jpg_file_is_served_with_the_fixed_media_type(temp_upload_dir):
    # Given a saved receipt whose original upload was a JPG
    receipt_id = upload_and_extract(JPG_BYTES, "receipt.jpg", "image/jpeg")

    # When its file is fetched
    response = client.get(f"/receipts/{receipt_id}/file")

    # Then the response is the original bytes with the expected content type
    assert response.status_code == 200
    assert response.content == JPG_BYTES
    assert response.headers["content-type"] == "image/jpeg"


def test_pdf_file_is_served_with_the_fixed_media_type(temp_upload_dir):
    # Given a saved receipt whose original upload was a PDF
    receipt_id = upload_and_extract(PDF_BYTES, "receipt.pdf", "application/pdf")

    # When its file is fetched
    response = client.get(f"/receipts/{receipt_id}/file")

    # Then the response is the original bytes with the expected content type
    assert response.status_code == 200
    assert response.content == PDF_BYTES
    assert response.headers["content-type"] == "application/pdf"


def test_hostile_stored_content_type_is_ignored_in_favor_of_the_extension(temp_upload_dir):
    # Given an upload whose stored content_type claims to be text/html, even
    # though the upload endpoint itself would reject that -- simulate a
    # pre-existing/legacy row by writing one directly via save_upload.
    receipt_id = upload_and_extract(PNG_BYTES, "receipt.png", "image/png")

    # When the stored upload row's content_type is poisoned directly
    import sqlite3

    repository = main.app.dependency_overrides[get_repository]()
    with sqlite3.connect(repository._database_path) as conn:
        conn.execute(
            "UPDATE uploads SET content_type = ? WHERE receipt_id = ?",
            ("text/html", receipt_id),
        )
        conn.commit()

    # Then the file endpoint still serves the fixed, extension-derived type
    response = client.get(f"/receipts/{receipt_id}/file")
    assert response.status_code == 200
    assert response.headers["content-type"] == "image/png"


def test_unknown_valid_uuid_returns_404(temp_upload_dir):
    unknown_id = str(uuid.uuid4())
    response = client.get(f"/receipts/{unknown_id}/file")
    assert response.status_code == 404


def test_non_uuid_id_rejected_and_sentinel_file_outside_uploads_untouched(
    temp_upload_dir, tmp_path_factory
):
    # Given a sentinel file placed outside the uploads directory
    sentinel_dir = tmp_path_factory.mktemp("outside")
    sentinel_file = sentinel_dir / "etc_passwd_sentinel"
    sentinel_file.write_text("do-not-touch")

    # When a path-traversal-looking, non-UUID id is requested
    response = client.get("/receipts/..%2F..%2Fetc%2Fpasswd/file")

    # Then the request is rejected and the sentinel file is untouched
    assert response.status_code in (400, 404)
    assert sentinel_file.read_text() == "do-not-touch"


def test_uploaded_but_never_extracted_returns_404_and_file_not_served(temp_upload_dir):
    # Given a receipt that was uploaded but never extracted
    files = {"file": ("receipt.jpg", io.BytesIO(JPG_BYTES), "image/jpeg")}
    upload_response = client.post("/receipts/upload", files=files)
    receipt_id = upload_response.json()["receipt_id"]

    # When its file is requested
    response = client.get(f"/receipts/{receipt_id}/file")

    # Then it is 404, not the file bytes
    assert response.status_code == 404
    assert response.content != JPG_BYTES


def test_record_exists_but_file_removed_from_disk_returns_404(temp_upload_dir):
    # Given a saved receipt whose file has since been removed from disk
    receipt_id = upload_and_extract(PNG_BYTES, "receipt.png", "image/png")
    for stored_file in temp_upload_dir.glob(f"{receipt_id}.*"):
        stored_file.unlink()

    # When its file is requested
    response = client.get(f"/receipts/{receipt_id}/file")

    # Then it is 404
    assert response.status_code == 404


def test_file_endpoint_404_after_delete(temp_upload_dir):
    # Given a saved receipt that is then deleted
    receipt_id = upload_and_extract(PNG_BYTES, "receipt.png", "image/png")
    delete_response = client.delete(f"/receipts/{receipt_id}")
    assert delete_response.status_code == 204

    # When its file is requested afterwards
    response = client.get(f"/receipts/{receipt_id}/file")

    # Then it is 404
    assert response.status_code == 404


def test_response_never_contains_the_original_filename(temp_upload_dir):
    # Given a saved receipt uploaded under a distinctive original filename
    receipt_id = upload_and_extract(PNG_BYTES, "my-secret-grocery-run.png", "image/png")

    # When its file is fetched
    response = client.get(f"/receipts/{receipt_id}/file")

    # Then no header or body mentions the original filename
    assert "my-secret-grocery-run" not in str(response.headers)
    assert response.headers["content-disposition"] == "inline"


def test_other_endpoints_still_work(temp_upload_dir):
    # Given a saved receipt
    receipt_id = upload_and_extract(PNG_BYTES, "receipt.png", "image/png")

    # When GET, PUT, GET list, DELETE and health are called
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
