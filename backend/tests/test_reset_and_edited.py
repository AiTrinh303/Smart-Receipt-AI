import json
import sqlite3
import uuid

import pytest
from fastapi.testclient import TestClient

import adapters.file_storage as file_storage
import main
from adapters.sqlite_repository import SqliteReceiptRepository
from api.routes import get_extractor, get_repository
from domain.models import ReceiptData, ReceiptUpdate

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


def store_file(upload_dir, extension: str = ".jpg") -> str:
    receipt_id = str(uuid.uuid4())
    (upload_dir / f"{receipt_id}{extension}").write_bytes(b"fake-bytes")
    return receipt_id


SAMPLE_DATA = ReceiptData(
    store_name="Corner Store",
    purchase_date="2026-01-15",
    currency="USD",
    items=[{"name": "Milk", "quantity": 1, "unit_price": 2.5, "line_total": 2.5}],
    discounts=[],
    taxes=[],
    total=2.5,
)


def seed_receipt(repository, receipt_id: str | None = None) -> str:
    receipt_id = receipt_id or str(uuid.uuid4())
    repository.save_receipt(receipt_id, SAMPLE_DATA.model_copy(deep=True))
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


# --- Migration ----------------------------------------------------------------


def test_migration_adds_edited_at_column_and_keeps_existing_rows(tmp_path):
    # Given a database file created with the OLD schema (no edited_at) and
    # containing one row, built directly -- not through the repository
    db_path = tmp_path / "old_schema.db"
    with sqlite3.connect(db_path) as conn:
        conn.execute(
            """
            CREATE TABLE receipts (
                receipt_id TEXT PRIMARY KEY,
                store_name TEXT NULL,
                purchase_date TEXT NULL,
                currency TEXT NULL,
                total TEXT NULL,
                extracted_json TEXT NOT NULL,
                ai_result_json TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE uploads (
                receipt_id TEXT PRIMARY KEY,
                original_filename TEXT,
                stored_filename TEXT,
                content_type TEXT,
                created_at TEXT
            )
            """
        )
        payload = json.dumps(
            {
                "store_name": "Old Store", "purchase_date": "2025-01-01", "currency": "USD",
                "items": [], "discounts": [], "taxes": [], "total": 5.0,
            }
        )
        conn.execute(
            """
            INSERT INTO receipts (receipt_id, store_name, purchase_date, currency, total,
                extracted_json, ai_result_json, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            ("old-id", "Old Store", "2025-01-01", "USD", "5.0", payload, payload,
             "2025-01-01T00:00:00+00:00", "2025-01-01T00:00:00+00:00"),
        )
        conn.commit()

    # When a repository is constructed against that same database file
    repository = SqliteReceiptRepository(db_path)

    # Then the column was added and the existing row is still there, unedited
    with sqlite3.connect(db_path) as conn:
        columns = {row[1] for row in conn.execute("PRAGMA table_info(receipts)")}
    assert "edited_at" in columns

    saved = repository.get_receipt("old-id")
    assert saved is not None
    assert saved.store_name == "Old Store"
    assert saved.edited is False
    assert saved.edited_at is None


# --- edited flag lifecycle ------------------------------------------------


def test_put_marks_the_receipt_edited(temp_repository):
    # Given a freshly saved (unedited) receipt
    receipt_id = seed_receipt(temp_repository)
    assert temp_repository.get_receipt(receipt_id).edited is False

    # When it is corrected via PUT
    response = client.put(f"/receipts/{receipt_id}", json=valid_update_body())

    # Then the response and a following GET both show edited=true with a timestamp
    assert response.status_code == 200
    assert response.json()["edited"] is True
    assert response.json()["edited_at"]
    assert temp_repository.get_receipt(receipt_id).edited is True


def test_re_extracting_clears_the_edited_flag(temp_upload_dir, temp_repository):
    # Given a receipt that has been edited
    receipt_id = store_file(temp_upload_dir)
    override_extractor(FakeExtractor(data=SAMPLE_DATA.model_copy(deep=True)))
    client.post(f"/receipts/{receipt_id}/extract")
    client.put(f"/receipts/{receipt_id}", json=valid_update_body())
    assert temp_repository.get_receipt(receipt_id).edited is True

    # When it is extracted again (e.g. Retry)
    response = client.post(f"/receipts/{receipt_id}/extract")

    # Then edited is false again
    assert response.status_code == 200
    assert response.json()["edited"] is False
    assert response.json()["edited_at"] is None
    assert temp_repository.get_receipt(receipt_id).edited is False


# --- reset endpoint -----------------------------------------------------------


def test_reset_restores_ai_values_after_several_edits_and_clears_edited(
    temp_upload_dir, temp_repository
):
    # Given a receipt extracted, then edited more than once
    receipt_id = store_file(temp_upload_dir)
    override_extractor(FakeExtractor(data=SAMPLE_DATA.model_copy(deep=True)))
    client.post(f"/receipts/{receipt_id}/extract")
    created_at_before = temp_repository.get_receipt(receipt_id).created_at

    client.put(f"/receipts/{receipt_id}", json=valid_update_body(store_name="First edit"))
    client.put(f"/receipts/{receipt_id}", json=valid_update_body(store_name="Second edit"))
    assert temp_repository.get_receipt(receipt_id).store_name == "Second edit"

    with sqlite3.connect(temp_repository._database_path) as conn:
        ai_result_before = conn.execute(
            "SELECT ai_result_json FROM receipts WHERE receipt_id = ?", (receipt_id,)
        ).fetchone()[0]

    # When the receipt is reset
    response = client.post(f"/receipts/{receipt_id}/reset")

    # Then the AI values are restored, edited is cleared, created_at is kept,
    # and ai_result_json itself is byte-for-byte unchanged
    assert response.status_code == 200
    body = response.json()
    assert body["store_name"] == "Corner Store"
    assert body["edited"] is False
    assert body["edited_at"] is None
    assert body["created_at"] == created_at_before

    with sqlite3.connect(temp_repository._database_path) as conn:
        ai_result_after = conn.execute(
            "SELECT ai_result_json FROM receipts WHERE receipt_id = ?", (receipt_id,)
        ).fetchone()[0]
    assert ai_result_after == ai_result_before


def test_reset_makes_the_history_list_show_restored_values(temp_upload_dir, temp_repository):
    # Given an extracted-then-edited receipt
    receipt_id = store_file(temp_upload_dir)
    override_extractor(FakeExtractor(data=SAMPLE_DATA.model_copy(deep=True)))
    client.post(f"/receipts/{receipt_id}/extract")
    client.put(f"/receipts/{receipt_id}", json=valid_update_body(store_name="Edited Store"))

    # When it is reset
    client.post(f"/receipts/{receipt_id}/reset")

    # Then the history list shows the restored (original) store name
    list_body = client.get("/receipts").json()
    item = next(i for i in list_body["items"] if i["receipt_id"] == receipt_id)
    assert item["store_name"] == "Corner Store"


def test_resetting_an_unedited_receipt_is_idempotent(temp_upload_dir):
    # Given a receipt that was never edited
    receipt_id = store_file(temp_upload_dir)
    override_extractor(FakeExtractor(data=SAMPLE_DATA.model_copy(deep=True)))
    client.post(f"/receipts/{receipt_id}/extract")

    # When it is reset
    response = client.post(f"/receipts/{receipt_id}/reset")

    # Then it still succeeds with 200
    assert response.status_code == 200
    assert response.json()["edited"] is False


def test_resetting_twice_is_fine(temp_upload_dir):
    # Given an edited receipt
    receipt_id = store_file(temp_upload_dir)
    override_extractor(FakeExtractor(data=SAMPLE_DATA.model_copy(deep=True)))
    client.post(f"/receipts/{receipt_id}/extract")
    client.put(f"/receipts/{receipt_id}", json=valid_update_body())

    # When it is reset twice in a row
    first = client.post(f"/receipts/{receipt_id}/reset")
    second = client.post(f"/receipts/{receipt_id}/reset")

    # Then both calls succeed
    assert first.status_code == 200
    assert second.status_code == 200
    assert second.json()["store_name"] == "Corner Store"


def test_reset_unknown_id_returns_404(temp_repository):
    unknown_id = str(uuid.uuid4())
    response = client.post(f"/receipts/{unknown_id}/reset")
    assert response.status_code == 404


def test_reset_non_uuid_id_returns_400_or_404(temp_repository):
    response = client.post("/receipts/not-a-uuid/reset")
    assert response.status_code in (400, 404)


def test_reset_never_calls_extract(temp_upload_dir, temp_repository):
    # Given an edited receipt, and an extractor that would raise if ever called
    receipt_id = store_file(temp_upload_dir)
    override_extractor(FakeExtractor(data=SAMPLE_DATA.model_copy(deep=True)))
    client.post(f"/receipts/{receipt_id}/extract")
    client.put(f"/receipts/{receipt_id}", json=valid_update_body())

    class ExplodingExtractor:
        def extract(self, file_path):
            raise AssertionError("reset must never call the extractor")

    main.app.dependency_overrides[get_extractor] = lambda: ExplodingExtractor()

    # When it is reset
    response = client.post(f"/receipts/{receipt_id}/reset")

    # Then it succeeds without ever invoking the extractor
    assert response.status_code == 200


def test_reset_database_failure_returns_500_generic_message(temp_upload_dir, temp_repository):
    # Given an edited receipt and a repository whose reset_receipt fails
    receipt_id = store_file(temp_upload_dir)
    override_extractor(FakeExtractor(data=SAMPLE_DATA.model_copy(deep=True)))
    client.post(f"/receipts/{receipt_id}/extract")
    client.put(f"/receipts/{receipt_id}", json=valid_update_body())

    class FailingRepository:
        def __getattr__(self, name):
            return getattr(temp_repository, name)

        def reset_receipt(self, receipt_id):
            raise RuntimeError("disk full: /some/internal/path leaked here")

    main.app.dependency_overrides[get_repository] = lambda: FailingRepository()

    # When it is reset
    response = client.post(f"/receipts/{receipt_id}/reset")

    # Then a generic 500 is returned, with no internal detail leaked
    assert response.status_code == 500
    assert "disk full" not in response.text
    assert "/some/internal/path" not in response.text


def test_reset_preflight_is_allowed_by_cors():
    # Given a browser about to send the reset POST request
    # When it sends the CORS preflight OPTIONS request first
    response = client.options(
        "/receipts/11111111-1111-1111-1111-111111111111/reset",
        headers={
            "Origin": "http://localhost:5173",
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "content-type",
        },
    )

    # Then the preflight succeeds, echoes the allowed origin, and allows POST
    assert response.status_code in (200, 204)
    assert response.headers.get("access-control-allow-origin") == "http://localhost:5173"
    assert "POST" in response.headers.get("access-control-allow-methods", "")
