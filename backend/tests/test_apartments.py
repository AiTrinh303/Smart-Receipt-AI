import io
import sqlite3
import uuid

import pytest
from fastapi.testclient import TestClient

import adapters.file_storage as file_storage
import main
from adapters.sqlite_repository import SqliteReceiptRepository
from api.routes import get_extractor, get_repository
from domain.models import ReceiptData
from _upload_helper import OTHER_APARTMENT_ID, VALID_APARTMENT_ID, upload_with_apartment

client = TestClient(main.app)

OBERAUDORF_NAME = "Fewo JoJo - Oberaudorf - Bergblick"
WALDGLUECK_NAME = "Fewo JoJo - Sankt Englmar - Waldglück"


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


def upload_file(apartment_id: str = VALID_APARTMENT_ID, filename: str = "receipt.jpg") -> str:
    files = {"file": (filename, io.BytesIO(b"fake-bytes"), "image/jpeg")}
    response = upload_with_apartment(client, files, apartment_id=apartment_id)
    assert response.status_code == 201
    return response.json()["receipt_id"]


def extract(receipt_id: str, data: ReceiptData = SAMPLE_DATA):
    override_extractor(FakeExtractor(data=data))
    response = client.post(f"/receipts/{receipt_id}/extract")
    assert response.status_code == 200
    return response


# --- Seeding and migration ----------------------------------------------


def test_seed_gives_exactly_two_apartments_with_the_exact_names(temp_repository):
    # Given a freshly constructed repository (seeding happens on construction)
    # When the apartments table is read directly
    with temp_repository._connect() as conn:
        rows = conn.execute("SELECT id, name, sort_order, active FROM apartments ORDER BY sort_order").fetchall()

    # Then there are exactly two rows with the exact ids and names
    assert len(rows) == 2
    assert rows[0] == ("oberaudorf-bergblick", OBERAUDORF_NAME, 1, 1)
    assert rows[1] == ("sankt-englmar-waldglueck", WALDGLUECK_NAME, 2, 1)


def test_seeding_is_idempotent(tmp_path):
    # Given a database that has already been seeded once
    db_path = tmp_path / "idempotent.db"
    SqliteReceiptRepository(db_path)

    # When a second repository is constructed against the same file
    SqliteReceiptRepository(db_path)

    # Then there are still exactly two apartment rows, not four
    with sqlite3.connect(db_path) as conn:
        count = conn.execute("SELECT COUNT(*) FROM apartments").fetchone()[0]
    assert count == 2


def test_migration_on_an_old_schema_database_with_rows_keeps_them(tmp_path):
    # Given a database file built with the OLD schema (no apartments table,
    # no apartment_id columns) and containing one receipt row
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

    # Then the apartments table and apartment_id columns were added, the
    # apartments were seeded, and the existing row is still there
    with sqlite3.connect(db_path) as conn:
        receipts_columns = {row[1] for row in conn.execute("PRAGMA table_info(receipts)")}
        uploads_columns = {row[1] for row in conn.execute("PRAGMA table_info(uploads)")}
    assert "apartment_id" in receipts_columns
    assert "apartment_id" in uploads_columns

    saved = repository.get_receipt("old-id")
    assert saved is not None
    assert saved.store_name == "Old Store"
    assert saved.apartment_id is None
    assert saved.apartment_name is None


# --- GET /apartments -------------------------------------------------------


def test_get_apartments_returns_both_in_sort_order():
    # Given the default seed data
    # When the apartments are listed
    response = client.get("/apartments")

    # Then both are returned in sort_order, with only id and name
    assert response.status_code == 200
    body = response.json()
    assert body["count"] == 2
    assert body["items"] == [
        {"id": "oberaudorf-bergblick", "name": OBERAUDORF_NAME},
        {"id": "sankt-englmar-waldglueck", "name": WALDGLUECK_NAME},
    ]


def test_inactive_apartment_is_not_listed(temp_repository):
    # Given one apartment has been deactivated directly
    with temp_repository._connect() as conn:
        conn.execute("UPDATE apartments SET active = 0 WHERE id = ?", (VALID_APARTMENT_ID,))
        conn.commit()

    # When the apartments are listed
    response = client.get("/apartments")

    # Then only the active one is returned
    body = response.json()
    assert body["count"] == 1
    assert body["items"] == [{"id": OTHER_APARTMENT_ID, "name": WALDGLUECK_NAME}]


# --- Apartment carried through the receipt lifecycle ------------------------


def test_extract_copies_the_uploads_apartment_id_to_the_receipt(temp_upload_dir):
    # Given a receipt uploaded for a specific apartment
    receipt_id = upload_file(apartment_id=OTHER_APARTMENT_ID)

    # When it is extracted
    response = extract(receipt_id)

    # Then the extract response carries that apartment
    body = response.json()
    assert body["apartment_id"] == OTHER_APARTMENT_ID
    assert body["apartment_name"] == WALDGLUECK_NAME


def test_re_extracting_keeps_the_existing_apartment_id(temp_upload_dir):
    # Given a receipt extracted once for a specific apartment
    receipt_id = upload_file(apartment_id=OTHER_APARTMENT_ID)
    extract(receipt_id)

    # When it is extracted again (e.g. Retry) -- the uploads row still has
    # the same apartment, but this proves the receipts row isn't simply
    # overwritten blindly, it's the ON CONFLICT branch that must preserve it
    response = extract(receipt_id)

    # Then the apartment is unchanged, never nulled
    body = response.json()
    assert body["apartment_id"] == OTHER_APARTMENT_ID
    assert body["apartment_name"] == WALDGLUECK_NAME


def test_extract_without_an_uploads_row_saves_null_apartment(temp_upload_dir):
    # Given a receipt file that exists on disk but was never recorded via
    # the real upload endpoint (simulating a pre-existing file)
    receipt_id = str(uuid.uuid4())
    (temp_upload_dir / f"{receipt_id}.jpg").write_bytes(b"fake-bytes")

    # When it is extracted
    response = extract(receipt_id)

    # Then the apartment fields are null
    body = response.json()
    assert body["apartment_id"] is None
    assert body["apartment_name"] is None


def test_put_never_changes_the_apartment(temp_upload_dir):
    # Given an extracted receipt with a known apartment
    receipt_id = upload_file(apartment_id=OTHER_APARTMENT_ID)
    extract(receipt_id)

    # When it is corrected via PUT
    response = client.put(
        f"/receipts/{receipt_id}",
        json={
            "store_name": "Fixed Store", "purchase_date": "2026-01-15", "currency": "USD",
            "items": [], "discounts": [], "taxes": [], "total": 10.0,
        },
    )

    # Then the apartment is unchanged
    assert response.status_code == 200
    body = response.json()
    assert body["apartment_id"] == OTHER_APARTMENT_ID
    assert body["apartment_name"] == WALDGLUECK_NAME


def test_reset_never_changes_the_apartment(temp_upload_dir):
    # Given an extracted, then edited, receipt with a known apartment
    receipt_id = upload_file(apartment_id=OTHER_APARTMENT_ID)
    extract(receipt_id)
    client.put(
        f"/receipts/{receipt_id}",
        json={
            "store_name": "Edited Store", "purchase_date": "2026-01-15", "currency": "USD",
            "items": [], "discounts": [], "taxes": [], "total": 10.0,
        },
    )

    # When it is reset
    response = client.post(f"/receipts/{receipt_id}/reset")

    # Then the apartment is unchanged
    assert response.status_code == 200
    body = response.json()
    assert body["apartment_id"] == OTHER_APARTMENT_ID
    assert body["apartment_name"] == WALDGLUECK_NAME


def test_setting_the_apartment_on_first_save_does_not_mark_the_receipt_edited(temp_upload_dir):
    # Given a receipt uploaded for a specific apartment
    receipt_id = upload_file(apartment_id=OTHER_APARTMENT_ID)

    # When it is extracted (the first save, which sets the apartment)
    response = extract(receipt_id)

    # Then setting the apartment is not treated as an edit
    body = response.json()
    assert body["edited"] is False
    assert body["edited_at"] is None


def test_list_shows_apartment_name(temp_upload_dir):
    # Given an extracted receipt with a known apartment
    receipt_id = upload_file(apartment_id=OTHER_APARTMENT_ID)
    extract(receipt_id)

    # When the history list is fetched
    response = client.get("/receipts")

    # Then the item shows the apartment id and its name
    item = next(i for i in response.json()["items"] if i["receipt_id"] == receipt_id)
    assert item["apartment_id"] == OTHER_APARTMENT_ID
    assert item["apartment_name"] == WALDGLUECK_NAME


# --- Contract: apartment fields have the same key set and types everywhere --


def test_apartment_fields_have_the_same_key_set_and_types_everywhere(temp_upload_dir):
    # Given a receipt uploaded, extracted, corrected and reset
    files = {"file": ("receipt.jpg", io.BytesIO(b"fake-bytes"), "image/jpeg")}
    upload_response = upload_with_apartment(client, files, apartment_id=VALID_APARTMENT_ID)
    receipt_id = upload_response.json()["receipt_id"]
    extract_response = extract(receipt_id)
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
    list_item = next(
        i for i in list_response.json()["items"] if i["receipt_id"] == receipt_id
    )

    bodies = {
        "upload": upload_response.json(),
        "extract": extract_response.json(),
        "get": get_response.json(),
        "put": put_response.json(),
        "reset": reset_response.json(),
        "list_item": list_item,
    }

    # Then every one of them has "apartment_id" and "apartment_name" with
    # the same JSON types (both strings here, since a valid apartment was used)
    for name, body in bodies.items():
        assert "apartment_id" in body, name
        assert "apartment_name" in body, name
        assert isinstance(body["apartment_id"], str), name
        assert isinstance(body["apartment_name"], str), name
        assert body["apartment_id"] == VALID_APARTMENT_ID
        assert body["apartment_name"] == OBERAUDORF_NAME
