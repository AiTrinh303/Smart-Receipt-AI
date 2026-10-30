import io
import sqlite3
import uuid

import pytest
from fastapi.testclient import TestClient

import adapters.file_storage as file_storage
import main
from adapters.sqlite_repository import SqliteReceiptRepository
from api.routes import get_extractor, get_repository
from domain.models import DEFAULT_CATEGORIES, ReceiptData, ReceiptStatus
from _upload_helper import OTHER_APARTMENT_ID, VALID_APARTMENT_ID, upload_with_apartment

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


SAMPLE_DATA = ReceiptData(
    store_name="Corner Store",
    purchase_date="2026-01-15",
    currency="USD",
    items=[],
    discounts=[],
    taxes=[],
    total=10.0,
)


def upload_file(apartment_id: str = VALID_APARTMENT_ID) -> str:
    files = {"file": ("receipt.jpg", io.BytesIO(b"fake-bytes"), "image/jpeg")}
    response = upload_with_apartment(client, files, apartment_id=apartment_id)
    assert response.status_code == 201
    return response.json()["receipt_id"]


def extract(receipt_id: str, data: ReceiptData = SAMPLE_DATA):
    override_extractor(FakeExtractor(data=data))
    response = client.post(f"/receipts/{receipt_id}/extract")
    assert response.status_code == 200
    return response


def set_category_and_status_directly(repository, receipt_id: str, category_id: str, status: str) -> None:
    """Sets category/status directly via SQL -- PUT /receipts/{id}/category
    and PUT /receipts/{id}/status don't exist yet in this commit."""
    with repository._connect() as conn:
        conn.execute(
            "UPDATE receipts SET category_id = ?, status = ? WHERE receipt_id = ?",
            (category_id, status, receipt_id),
        )
        conn.commit()


# --- Seeding and migration ----------------------------------------------


def test_seed_gives_exactly_ten_categories_and_is_idempotent(tmp_path):
    # Given a freshly constructed repository (seeding happens on construction)
    db_path = tmp_path / "seed.db"
    repo = SqliteReceiptRepository(db_path)

    # When the categories table is read directly
    with repo._connect() as conn:
        rows = conn.execute("SELECT id, name, sort_order, active FROM categories ORDER BY sort_order").fetchall()

    # Then there are exactly the 10 expected rows, in order
    assert len(rows) == 10
    expected = [(c.id, c.name, c.sort_order, int(c.active)) for c in DEFAULT_CATEGORIES]
    assert rows == expected

    # And constructing a second repository against the same file changes nothing
    SqliteReceiptRepository(db_path)
    with sqlite3.connect(db_path) as conn:
        count = conn.execute("SELECT COUNT(*) FROM categories").fetchone()[0]
    assert count == 10


def test_migration_on_an_old_schema_database_with_rows_keeps_them_and_needs_review(tmp_path):
    # Given a database file built with the schema from before categories/status
    # existed (apartments already present, but no categories table and no
    # category_id/status columns), containing one receipt row
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
                updated_at TEXT NOT NULL,
                edited_at TEXT NULL,
                apartment_id TEXT NULL
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
                created_at TEXT,
                apartment_id TEXT NULL
            )
            """
        )
        old_data = ReceiptData(
            store_name="Old Store", purchase_date="2025-01-01", currency="USD",
            items=[], discounts=[], taxes=[], total=10.0,
        )
        payload = old_data.model_dump_json()
        conn.execute(
            """
            INSERT INTO receipts (receipt_id, store_name, purchase_date, currency, total,
                extracted_json, ai_result_json, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            ("old-id", "Old Store", "2025-01-01", "USD", "10.0", payload, payload,
             "2025-01-01T00:00:00+00:00", "2025-01-01T00:00:00+00:00"),
        )
        conn.commit()

    # When a repository is constructed against that same file
    repository = SqliteReceiptRepository(db_path)

    # Then the categories table and category_id/status columns were added,
    # categories were seeded, and the existing row keeps its data with a
    # null category and 'needs_review' status
    with sqlite3.connect(db_path) as conn:
        receipts_columns = {row[1] for row in conn.execute("PRAGMA table_info(receipts)")}
        category_count = conn.execute("SELECT COUNT(*) FROM categories").fetchone()[0]
    assert "category_id" in receipts_columns
    assert "status" in receipts_columns
    assert category_count == 10

    saved = repository.get_receipt("old-id")
    assert saved is not None
    assert saved.store_name == "Old Store"
    assert saved.category_id is None
    assert saved.category_name is None
    assert saved.status == ReceiptStatus.NEEDS_REVIEW


# --- GET /categories ---------------------------------------------------


def test_get_categories_returns_all_ten_in_sort_order():
    # Given the default seed data
    # When the categories are listed
    response = client.get("/categories")

    # Then all 10 are returned in sort_order, with only id and name
    assert response.status_code == 200
    body = response.json()
    assert body["count"] == 10
    assert body["items"] == [{"id": c.id, "name": c.name} for c in DEFAULT_CATEGORIES]


def test_inactive_category_is_not_listed(temp_repository):
    # Given one category has been deactivated directly
    with temp_repository._connect() as conn:
        conn.execute("UPDATE categories SET active = 0 WHERE id = ?", ("cleaning",))
        conn.commit()

    # When the categories are listed
    response = client.get("/categories")

    # Then only the active ones are returned
    body = response.json()
    assert body["count"] == 9
    assert "cleaning" not in [item["id"] for item in body["items"]]


# --- Category and status through the receipt lifecycle -------------------


def test_new_receipt_has_null_category_and_needs_review_status(temp_upload_dir):
    # Given a freshly extracted receipt
    receipt_id = upload_file()

    # When it is extracted
    response = extract(receipt_id)

    # Then it has no category and is 'needs_review'
    body = response.json()
    assert body["category_id"] is None
    assert body["category_name"] is None
    assert body["status"] == ReceiptStatus.NEEDS_REVIEW


def test_re_extract_keeps_category_and_apartment_but_resets_status(temp_upload_dir, temp_repository):
    # Given an extracted receipt that has a category assigned and is approved
    receipt_id = upload_file(apartment_id=OTHER_APARTMENT_ID)
    extract(receipt_id)
    set_category_and_status_directly(temp_repository, receipt_id, "cleaning", ReceiptStatus.APPROVED)

    # When it is extracted again (e.g. Retry)
    response = extract(receipt_id)

    # Then the category and apartment are kept, but status is reset
    body = response.json()
    assert body["category_id"] == "cleaning"
    assert body["category_name"] == "Cleaning and supplies"
    assert body["apartment_id"] == OTHER_APARTMENT_ID
    assert body["status"] == ReceiptStatus.NEEDS_REVIEW


def test_put_keeps_category_status_and_apartment(temp_upload_dir, temp_repository):
    # Given an extracted receipt with a category assigned and approved
    receipt_id = upload_file(apartment_id=OTHER_APARTMENT_ID)
    extract(receipt_id)
    set_category_and_status_directly(temp_repository, receipt_id, "repairs", ReceiptStatus.APPROVED)

    # When it is corrected via PUT
    response = client.put(
        f"/receipts/{receipt_id}",
        json={
            "store_name": "Fixed Store", "purchase_date": "2026-01-15", "currency": "USD",
            "items": [], "discounts": [], "taxes": [], "total": 10.0,
        },
    )

    # Then category, status and apartment are all unchanged
    assert response.status_code == 200
    body = response.json()
    assert body["category_id"] == "repairs"
    assert body["status"] == ReceiptStatus.APPROVED
    assert body["apartment_id"] == OTHER_APARTMENT_ID


def test_reset_keeps_category_status_and_apartment(temp_upload_dir, temp_repository):
    # Given an extracted, then edited, receipt with a category assigned and approved
    receipt_id = upload_file(apartment_id=OTHER_APARTMENT_ID)
    extract(receipt_id)
    client.put(
        f"/receipts/{receipt_id}",
        json={
            "store_name": "Edited Store", "purchase_date": "2026-01-15", "currency": "USD",
            "items": [], "discounts": [], "taxes": [], "total": 10.0,
        },
    )
    set_category_and_status_directly(temp_repository, receipt_id, "repairs", ReceiptStatus.APPROVED)

    # When it is reset
    response = client.post(f"/receipts/{receipt_id}/reset")

    # Then category, status and apartment are all unchanged
    assert response.status_code == 200
    body = response.json()
    assert body["category_id"] == "repairs"
    assert body["status"] == ReceiptStatus.APPROVED
    assert body["apartment_id"] == OTHER_APARTMENT_ID


def test_list_shows_category_name(temp_upload_dir, temp_repository):
    # Given an extracted receipt with a category assigned
    receipt_id = upload_file()
    extract(receipt_id)
    set_category_and_status_directly(temp_repository, receipt_id, "linen", ReceiptStatus.NEEDS_REVIEW)

    # When the history list is fetched
    response = client.get("/receipts")

    # Then the item shows the category id, name and status
    item = next(i for i in response.json()["items"] if i["receipt_id"] == receipt_id)
    assert item["category_id"] == "linen"
    assert item["category_name"] == "Linen and textiles"
    assert item["status"] == ReceiptStatus.NEEDS_REVIEW


# --- Contract: category/status fields have the same key set and types everywhere --


def test_category_and_status_fields_have_the_same_key_set_and_types_everywhere(temp_upload_dir, temp_repository):
    # Given a receipt uploaded, extracted, given a category, corrected and reset
    receipt_id = upload_file()
    extract_response = extract(receipt_id)
    set_category_and_status_directly(temp_repository, receipt_id, "other", ReceiptStatus.NEEDS_REVIEW)
    get_response = client.get(f"/receipts/{receipt_id}")
    put_response = client.put(
        f"/receipts/{receipt_id}",
        json={
            "store_name": "Fixed", "purchase_date": "2026-01-15", "currency": "USD",
            "items": [], "discounts": [], "taxes": [], "total": 10.0,
        },
    )
    reset_response = client.post(f"/receipts/{receipt_id}/reset")
    list_response = client.get("/receipts")
    list_item = next(i for i in list_response.json()["items"] if i["receipt_id"] == receipt_id)

    bodies = {
        "extract": extract_response.json(),
        "get": get_response.json(),
        "put": put_response.json(),
        "reset": reset_response.json(),
        "list_item": list_item,
    }

    for name, body in bodies.items():
        assert "category_id" in body, name
        assert "category_name" in body, name
        assert "status" in body, name
        assert isinstance(body["status"], str), name

    # category_id/name are null right after extraction (set directly after),
    # so only check get/put/reset/list_item (which ran after the direct set)
    for name in ["get", "put", "reset", "list_item"]:
        body = bodies[name]
        assert body["category_id"] == "other", name
        assert body["category_name"] == "Other", name
