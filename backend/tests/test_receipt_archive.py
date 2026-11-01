import io
import uuid

import pytest
from fastapi.testclient import TestClient
from PIL import Image

import adapters.file_storage as file_storage
import main
from adapters.sqlite_repository import SqliteReceiptRepository
from api.routes import get_extractor, get_repository
from domain.models import ReceiptData
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


def make_png_bytes(size=(100, 100)) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", size, (255, 0, 0)).save(buf, format="PNG")
    return buf.getvalue()


def make_jpeg_bytes_with_orientation(orientation: int, size=(100, 200)) -> bytes:
    img = Image.new("RGB", size, (0, 255, 0))
    exif = img.getexif()
    exif[0x0112] = orientation
    buf = io.BytesIO()
    img.save(buf, format="JPEG", exif=exif)
    return buf.getvalue()


PDF_BYTES = b"%PDF-1.4 fake but good enough for tests"


def upload_and_extract(
    contents: bytes, filename: str, content_type: str, data: ReceiptData = SAMPLE_RECEIPT_DATA
) -> str:
    files = {"file": (filename, io.BytesIO(contents), content_type)}
    upload_response = upload_with_apartment(client, files, apartment_id=VALID_APARTMENT_ID)
    assert upload_response.status_code == 201
    receipt_id = upload_response.json()["receipt_id"]

    override_extractor(FakeExtractor(data=data))
    extract_response = client.post(f"/receipts/{receipt_id}/extract")
    assert extract_response.status_code == 200
    return receipt_id


# --- Happy paths -----------------------------------------------------------


def test_png_receipt_archive_is_a_pdf_with_the_right_headers(temp_upload_dir):
    # Given a saved receipt whose original is a PNG
    receipt_id = upload_and_extract(make_png_bytes(), "receipt.png", "image/png")

    # When its archive PDF is requested
    response = client.get(f"/receipts/{receipt_id}/archive.pdf")

    # Then it is 200 with PDF bytes and the right headers
    assert response.status_code == 200
    assert response.content.startswith(b"%PDF-")
    assert response.headers["content-type"] == "application/pdf"
    assert response.headers["x-content-type-options"] == "nosniff"
    assert response.headers["cache-control"] == "private, no-cache"
    disposition = response.headers["content-disposition"]
    assert disposition.startswith("attachment; filename=")
    assert "oberaudorf-bergblick" in disposition
    assert "2026-01-15" in disposition
    assert "corner-store" in disposition


def test_jpg_receipt_with_exif_rotation_archive_is_a_pdf(temp_upload_dir):
    # Given a saved receipt whose original is a JPG with an EXIF rotation
    receipt_id = upload_and_extract(
        make_jpeg_bytes_with_orientation(6), "receipt.jpg", "image/jpeg"
    )

    # When its archive PDF is requested
    response = client.get(f"/receipts/{receipt_id}/archive.pdf")

    # Then it is 200 with PDF bytes
    assert response.status_code == 200
    assert response.content.startswith(b"%PDF-")


def test_pdf_receipt_returns_the_exact_original_bytes(temp_upload_dir):
    # Given a saved receipt whose original is already a PDF
    receipt_id = upload_and_extract(PDF_BYTES, "receipt.pdf", "application/pdf")

    # When its archive PDF is requested
    response = client.get(f"/receipts/{receipt_id}/archive.pdf")

    # Then the exact original bytes come back unchanged
    assert response.status_code == 200
    assert response.content == PDF_BYTES


def test_original_files_hash_is_unchanged_after_the_call(temp_upload_dir):
    import hashlib

    # Given a saved PNG receipt
    receipt_id = upload_and_extract(make_png_bytes(), "receipt.png", "image/png")
    stored_file = next(temp_upload_dir.glob(f"{receipt_id}.*"))
    before_hash = hashlib.sha256(stored_file.read_bytes()).hexdigest()

    # When its archive PDF is requested
    response = client.get(f"/receipts/{receipt_id}/archive.pdf")
    assert response.status_code == 200

    # Then the original file on disk is byte-for-byte unchanged
    after_hash = hashlib.sha256(stored_file.read_bytes()).hexdigest()
    assert after_hash == before_hash


def test_filename_never_contains_the_original_filename(temp_upload_dir):
    # Given a receipt uploaded under a distinctive original filename
    receipt_id = upload_and_extract(make_png_bytes(), "my-secret-grocery-run.png", "image/png")

    # When its archive PDF is requested
    response = client.get(f"/receipts/{receipt_id}/archive.pdf")

    # Then no header mentions the original filename
    assert "my-secret-grocery-run" not in str(response.headers)


# --- Hostile store names -----------------------------------------------


@pytest.mark.parametrize(
    "hostile_store_name",
    [
        "x\r\nSet-Cookie: a=b",
        "../../a",
        'a"b\'c',
        "Waldglück ß",
    ],
)
def test_hostile_store_names_produce_safe_ascii_filenames(temp_upload_dir, hostile_store_name):
    # Given a receipt whose extracted store name is hostile
    data = ReceiptData(
        store_name=hostile_store_name, purchase_date="2026-01-15", currency="USD",
        items=[], discounts=[], taxes=[], total=9.99,
    )
    receipt_id = upload_and_extract(make_png_bytes(), "receipt.png", "image/png", data=data)

    # When its archive PDF is requested
    response = client.get(f"/receipts/{receipt_id}/archive.pdf")

    # Then the response is valid and the filename header is safe
    assert response.status_code == 200
    disposition = response.headers["content-disposition"]
    assert "\r" not in disposition
    assert "\n" not in disposition
    filename_value = disposition.split("filename=", 1)[1].strip('"')
    assert '"' not in filename_value
    assert all(ord(c) < 128 for c in disposition)
    assert "Set-Cookie" not in disposition


# --- Error cases -------------------------------------------------------


def test_corrupt_image_returns_422_with_generic_message(temp_upload_dir):
    # Given a saved receipt whose stored file is corrupt (not a real image)
    receipt_id = upload_and_extract(b"not a real png at all", "receipt.png", "image/png")

    # When its archive PDF is requested
    response = client.get(f"/receipts/{receipt_id}/archive.pdf")

    # Then it is 422 with a generic message, no internal detail leaked
    assert response.status_code == 422
    assert response.json() == {"detail": "This file could not be converted to PDF."}


def test_unknown_uuid_returns_404(temp_upload_dir):
    unknown_id = str(uuid.uuid4())
    response = client.get(f"/receipts/{unknown_id}/archive.pdf")
    assert response.status_code == 404


def test_non_uuid_id_returns_400_or_404(temp_upload_dir):
    response = client.get("/receipts/not-a-uuid/archive.pdf")
    assert response.status_code in (400, 404)


def test_never_extracted_upload_returns_404(temp_upload_dir):
    files = {"file": ("receipt.jpg", io.BytesIO(make_png_bytes()), "image/jpeg")}
    upload_response = upload_with_apartment(client, files, apartment_id=VALID_APARTMENT_ID)
    receipt_id = upload_response.json()["receipt_id"]

    response = client.get(f"/receipts/{receipt_id}/archive.pdf")
    assert response.status_code == 404


def test_deleted_receipt_returns_404(temp_upload_dir):
    receipt_id = upload_and_extract(make_png_bytes(), "receipt.png", "image/png")
    delete_response = client.delete(f"/receipts/{receipt_id}")
    assert delete_response.status_code == 204

    response = client.get(f"/receipts/{receipt_id}/archive.pdf")
    assert response.status_code == 404


def test_record_without_file_on_disk_returns_404(temp_upload_dir):
    receipt_id = upload_and_extract(make_png_bytes(), "receipt.png", "image/png")
    for stored_file in temp_upload_dir.glob(f"{receipt_id}.*"):
        stored_file.unlink()

    response = client.get(f"/receipts/{receipt_id}/archive.pdf")
    assert response.status_code == 404


# --- Regression: other routes still work ------------------------------


def test_file_endpoint_and_other_routes_still_work(temp_upload_dir):
    receipt_id = upload_and_extract(make_png_bytes(), "receipt.png", "image/png")

    file_response = client.get(f"/receipts/{receipt_id}/file")
    get_response = client.get(f"/receipts/{receipt_id}")
    list_response = client.get("/receipts")
    health_response = client.get("/health")

    assert file_response.status_code == 200
    assert get_response.status_code == 200
    assert list_response.status_code == 200
    assert health_response.status_code == 200
