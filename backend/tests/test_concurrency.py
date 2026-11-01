import io
import logging
import sqlite3
import time
import uuid
from concurrent.futures import ThreadPoolExecutor, as_completed

import pytest
from fastapi.testclient import TestClient

import adapters.file_storage as file_storage
import main
from adapters.sqlite_repository import SqliteReceiptRepository
from api.routes import get_extractor, get_repository
from domain.models import ReceiptData
from _upload_helper import OTHER_APARTMENT_ID, VALID_APARTMENT_ID, upload_with_apartment

client = TestClient(main.app)

APARTMENTS = [VALID_APARTMENT_ID, OTHER_APARTMENT_ID]

SAMPLE_DATA = ReceiptData(
    store_name="Corner Store",
    purchase_date="2026-01-15",
    currency="USD",
    items=[],
    discounts=[],
    taxes=[],
    total=9.99,
)


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


class SlowFakeExtractor:
    """A tiny artificial delay so concurrent extract requests genuinely
    overlap in time, rather than each finishing before the next starts --
    never the real OpenAI API, never the real database."""

    def __init__(self, data: ReceiptData):
        self._data = data

    def extract(self, file_path):
        time.sleep(0.02)
        return self._data


def override_slow_extractor():
    main.app.dependency_overrides[get_extractor] = lambda: SlowFakeExtractor(SAMPLE_DATA)


def upload_and_extract(index: int) -> dict:
    """One full upload+extract sequence, alternating between the two
    apartments. Never raises on a non-2xx response -- the caller inspects
    the returned statuses instead, so one failed sequence doesn't hide the
    results of the other eleven."""
    apartment_id = APARTMENTS[index % 2]
    files = {
        "file": (f"receipt{index}.jpg", io.BytesIO(f"fake-bytes-{index}".encode()), "image/jpeg")
    }
    upload_response = upload_with_apartment(client, files, apartment_id=apartment_id)

    receipt_id = None
    extract_status = None
    extract_body = ""
    if upload_response.status_code == 201:
        receipt_id = upload_response.json()["receipt_id"]
        extract_response = client.post(f"/receipts/{receipt_id}/extract")
        extract_status = extract_response.status_code
        extract_body = extract_response.text

    return {
        "index": index,
        "apartment_id": apartment_id,
        "upload_status": upload_response.status_code,
        "upload_body": upload_response.text,
        "receipt_id": receipt_id,
        "extract_status": extract_status,
        "extract_body": extract_body,
    }


def test_twelve_parallel_upload_and_extract_sequences_are_safe(temp_upload_dir, temp_repository, caplog):
    # Given 12 independent upload+extract sequences, alternating apartments,
    # run 4 at a time against the running app
    override_slow_extractor()

    with caplog.at_level(logging.DEBUG):
        with ThreadPoolExecutor(max_workers=4) as executor:
            futures = [executor.submit(upload_and_extract, i) for i in range(12)]
            results = [f.result() for f in as_completed(futures)]

    # Then every upload returned 201 and every extract 200
    for result in results:
        assert result["upload_status"] == 201, result["upload_body"]
        assert result["extract_status"] == 200, result["extract_body"]

    # And no response body ever mentions a database lock or an exception
    for result in results:
        assert "locked" not in result["upload_body"].lower()
        assert "locked" not in result["extract_body"].lower()
        assert "traceback" not in result["upload_body"].lower()
        assert "traceback" not in result["extract_body"].lower()

    # And there are 12 distinct receipt ids -- no collision, no mixed-up data
    receipt_ids = [r["receipt_id"] for r in results]
    assert len(receipt_ids) == 12
    assert len(set(receipt_ids)) == 12

    # And there are exactly 12 rows in both receipts and uploads
    conn = sqlite3.connect(temp_repository._database_path)
    receipts_count = conn.execute("SELECT COUNT(*) FROM receipts").fetchone()[0]
    uploads_count = conn.execute("SELECT COUNT(*) FROM uploads").fetchone()[0]
    stored_apartments = dict(conn.execute("SELECT receipt_id, apartment_id FROM receipts").fetchall())
    conn.close()
    assert receipts_count == 12
    assert uploads_count == 12

    # And each saved receipt has the exact apartment that sequence sent --
    # never another sequence's apartment (no data mixed up under contention)
    expected_apartment_by_id = {r["receipt_id"]: r["apartment_id"] for r in results}
    assert stored_apartments == expected_apartment_by_id

    # And there are 12 files with UUID-shaped names on disk
    stored_files = list(temp_upload_dir.glob("*.jpg"))
    assert len(stored_files) == 12
    for stored_file in stored_files:
        uuid.UUID(stored_file.stem)  # raises ValueError if not a valid UUID

    # And nothing was logged about a lock or an unhandled exception
    assert "locked" not in caplog.text.lower()
    assert "traceback" not in caplog.text.lower()


def test_apartment_put_and_list_are_safe_concurrently_with_extracts(temp_upload_dir, temp_repository, caplog):
    # Given 6 receipts already uploaded (not yet extracted), alternating apartments
    override_slow_extractor()
    receipt_ids = []
    for i in range(6):
        files = {
            "file": (f"receipt{i}.jpg", io.BytesIO(f"fake-bytes-{i}".encode()), "image/jpeg")
        }
        response = upload_with_apartment(client, files, apartment_id=APARTMENTS[i % 2])
        assert response.status_code == 201
        receipt_ids.append(response.json()["receipt_id"])

    def do_extract(receipt_id):
        return client.post(f"/receipts/{receipt_id}/extract")

    def do_put_apartment(receipt_id):
        # May race ahead of (or behind) its own extract -- a 404 ("receipt
        # not found" because it hasn't been extracted yet) is a legitimate
        # outcome here, not a bug; only a 500 or "locked" text would be.
        return client.put(
            f"/receipts/{receipt_id}/apartment", json={"apartment_id": OTHER_APARTMENT_ID}
        )

    def do_list():
        return client.get("/receipts")

    # When all three kinds of request run concurrently against the same database
    with caplog.at_level(logging.DEBUG):
        with ThreadPoolExecutor(max_workers=4) as executor:
            futures = [executor.submit(do_extract, rid) for rid in receipt_ids]
            futures += [executor.submit(do_put_apartment, rid) for rid in receipt_ids]
            futures += [executor.submit(do_list) for _ in range(6)]
            results = [f.result() for f in as_completed(futures)]

    # Then nothing ever fails with a server error or a database-lock error
    for response in results:
        assert response.status_code != 500, response.text
        assert "locked" not in response.text.lower()

    # And every extract that did happen still succeeded
    extract_results = [r for r in results if r.request.method == "POST"]
    assert extract_results  # sanity: the extract calls did run
    for response in extract_results:
        assert response.status_code == 200, response.text

    # And GET /receipts always returned a well-formed list, never an error
    list_results = [r for r in results if r.request.method == "GET"]
    for response in list_results:
        assert response.status_code == 200
        assert "count" in response.json()

    assert "locked" not in caplog.text.lower()
