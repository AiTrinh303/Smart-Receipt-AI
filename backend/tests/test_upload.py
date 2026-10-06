import io
import uuid

import pytest
from fastapi.testclient import TestClient

import main

client = TestClient(main.app)


@pytest.fixture(autouse=True)
def temp_upload_dir(tmp_path, monkeypatch):
    monkeypatch.setattr(main, "UPLOAD_DIR", tmp_path)
    return tmp_path


def make_files(content: bytes, content_type: str, filename: str):
    return {"file": (filename, io.BytesIO(content), content_type)}


def test_valid_jpg_upload(temp_upload_dir):
    # Given a valid JPG file
    files = make_files(b"jpg-bytes", "image/jpeg", "receipt.jpg")

    # When the file is uploaded
    response = client.post("/receipts/upload", files=files)

    # Then the response is 201, returns a receipt_id, and the file exists in the temp dir
    assert response.status_code == 201
    body = response.json()
    uuid.UUID(body["receipt_id"])
    assert body["filename"] == "receipt.jpg"
    assert body["content_type"] == "image/jpeg"
    assert body["size_bytes"] == len(b"jpg-bytes")
    stored = list(temp_upload_dir.iterdir())
    assert stored == [temp_upload_dir / f"{body['receipt_id']}.jpg"]


def test_valid_png_upload(temp_upload_dir):
    # Given a valid PNG file
    files = make_files(b"png-bytes", "image/png", "receipt.png")

    # When the file is uploaded
    response = client.post("/receipts/upload", files=files)

    # Then the response is 201
    assert response.status_code == 201
    body = response.json()
    assert list(temp_upload_dir.iterdir()) == [temp_upload_dir / f"{body['receipt_id']}.png"]


def test_valid_pdf_upload(temp_upload_dir):
    # Given a valid PDF file
    files = make_files(b"%PDF-1.4 fake pdf contents", "application/pdf", "receipt.pdf")

    # When the file is uploaded
    response = client.post("/receipts/upload", files=files)

    # Then the response is 201
    assert response.status_code == 201
    body = response.json()
    assert list(temp_upload_dir.iterdir()) == [temp_upload_dir / f"{body['receipt_id']}.pdf"]


def test_unsupported_file_type_rejected(temp_upload_dir):
    # Given a file with an unsupported type
    files = make_files(b"hello world", "text/plain", "notes.txt")

    # When the file is uploaded
    response = client.post("/receipts/upload", files=files)

    # Then the response is 400 and nothing is stored
    assert response.status_code == 400
    assert list(temp_upload_dir.iterdir()) == []


def test_file_over_max_size_rejected(temp_upload_dir):
    # Given a file larger than 10 MB
    big_content = b"a" * (10 * 1024 * 1024 + 1)
    files = make_files(big_content, "image/jpeg", "big.jpg")

    # When the file is uploaded
    response = client.post("/receipts/upload", files=files)

    # Then the response is 413 and nothing is stored
    assert response.status_code == 413
    assert list(temp_upload_dir.iterdir()) == []


def test_empty_file_rejected(temp_upload_dir):
    # Given an empty file
    files = make_files(b"", "image/jpeg", "empty.jpg")

    # When the file is uploaded
    response = client.post("/receipts/upload", files=files)

    # Then the response is 400 and nothing is stored
    assert response.status_code == 400
    assert list(temp_upload_dir.iterdir()) == []


def test_missing_file_returns_422(temp_upload_dir):
    # Given a request with no file field

    # When the request is sent without "file"
    response = client.post("/receipts/upload")

    # Then the response is 422
    assert response.status_code == 422


def test_malicious_filename_is_stored_under_uuid(temp_upload_dir):
    # Given a file with a path-traversal filename
    files = make_files(b"jpg-bytes", "image/jpeg", "../../evil.jpg")

    # When the file is uploaded
    response = client.post("/receipts/upload", files=files)

    # Then the response is 201 and the file is stored under a UUID name inside the temp dir only
    assert response.status_code == 201
    body = response.json()
    stored = list(temp_upload_dir.iterdir())
    assert stored == [temp_upload_dir / f"{body['receipt_id']}.jpg"]
    assert ".." not in stored[0].name
