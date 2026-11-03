"""Covers the category-removal migration contract (see
docs/adr/0004-remove-categories.md): a database created under the OLD schema
(categories table + receipts.category_id, with real rows) must keep working
untouched, while a brand-new database never gets that table or column."""

import sqlite3
import uuid
from datetime import datetime, timezone

import pytest
from fastapi.testclient import TestClient

import adapters.file_storage as file_storage
import main
from adapters.sqlite_repository import SqliteReceiptRepository
from api.routes import get_extractor, get_repository
from domain.models import ReceiptData, ReceiptStatus

client = TestClient(main.app)


@pytest.fixture(autouse=True)
def clear_dependency_overrides():
    yield
    main.app.dependency_overrides.clear()


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def build_old_schema_database(db_path, receipt_id: str) -> None:
    """Hand-builds a database exactly as the pre-removal app would have left
    it: the categories table, seeded rows, and one receipt with a
    category_id set and status='approved'."""
    conn = sqlite3.connect(db_path)
    try:
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
                apartment_id TEXT NULL,
                category_id TEXT NULL,
                status TEXT NOT NULL DEFAULT 'needs_review'
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE apartments (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                sort_order INTEGER NOT NULL,
                active INTEGER NOT NULL DEFAULT 1
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE categories (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                sort_order INTEGER NOT NULL,
                active INTEGER NOT NULL DEFAULT 1
            )
            """
        )
        conn.execute(
            "INSERT INTO apartments (id, name, sort_order, active) VALUES (?, ?, ?, ?)",
            ("oberaudorf-bergblick", "Fewo JoJo - Oberaudorf - Bergblick", 1, 1),
        )
        conn.execute(
            "INSERT INTO categories (id, name, sort_order, active) VALUES (?, ?, ?, ?)",
            ("cleaning", "Cleaning and supplies", 1, 1),
        )
        conn.execute(
            "INSERT INTO categories (id, name, sort_order, active) VALUES (?, ?, ?, ?)",
            ("repairs", "Repairs and maintenance", 2, 1),
        )

        data = ReceiptData(
            store_name="Corner Store",
            purchase_date="2026-01-15",
            currency="USD",
            items=[],
            discounts=[],
            taxes=[],
            total=19.99,
        )
        now = _utc_now_iso()
        extracted_json = data.model_dump_json()
        conn.execute(
            """
            INSERT INTO receipts (
                receipt_id, store_name, purchase_date, currency, total,
                extracted_json, ai_result_json, created_at, updated_at, edited_at,
                apartment_id, category_id, status
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)
            """,
            (
                receipt_id,
                data.store_name,
                data.purchase_date,
                data.currency,
                "19.99",
                extracted_json,
                extracted_json,
                now,
                now,
                "oberaudorf-bergblick",
                "cleaning",
                ReceiptStatus.APPROVED,
            ),
        )
        conn.commit()
    finally:
        conn.close()


def test_old_schema_database_opens_lists_gets_edits_approves_and_re_extracts_with_category_data_untouched(
    tmp_path, monkeypatch
):
    db_path = tmp_path / "old.db"
    receipt_id = str(uuid.uuid4())
    build_old_schema_database(db_path, receipt_id)

    # Snapshot the old category data before the app ever touches this database
    conn = sqlite3.connect(db_path)
    categories_before = conn.execute("SELECT id, name, sort_order, active FROM categories ORDER BY id").fetchall()
    category_id_before = conn.execute(
        "SELECT category_id FROM receipts WHERE receipt_id = ?", (receipt_id,)
    ).fetchone()[0]
    conn.close()
    assert categories_before == [
        ("cleaning", "Cleaning and supplies", 1, 1),
        ("repairs", "Repairs and maintenance", 2, 1),
    ]
    assert category_id_before == "cleaning"

    # Given the app opens this old-schema database (the additive migration
    # runs, but must not touch categories or receipts.category_id)
    repository = SqliteReceiptRepository(db_path)
    main.app.dependency_overrides[get_repository] = lambda: repository
    upload_dir = tmp_path / "uploads"
    upload_dir.mkdir()
    monkeypatch.setattr(file_storage, "UPLOAD_DIR", upload_dir)
    (upload_dir / f"{receipt_id}.jpg").write_bytes(b"fake-bytes")

    # It lists fine
    list_response = client.get("/receipts")
    assert list_response.status_code == 200
    assert any(item["receipt_id"] == receipt_id for item in list_response.json()["items"])

    # It gets fine, and carries no category fields in the response
    get_response = client.get(f"/receipts/{receipt_id}")
    assert get_response.status_code == 200
    get_body = get_response.json()
    assert "category_id" not in get_body
    assert "category_name" not in get_body
    assert get_body["status"] == ReceiptStatus.APPROVED

    # It edits fine
    edit_response = client.put(
        f"/receipts/{receipt_id}",
        json={
            "store_name": "Corrected Store",
            "purchase_date": "2026-01-15",
            "currency": "USD",
            "items": [],
            "discounts": [],
            "taxes": [],
            "total": 25.0,
        },
    )
    assert edit_response.status_code == 200
    assert edit_response.json()["store_name"] == "Corrected Store"

    # It approves fine (already approved; setting it again must still work)
    approve_response = client.put(f"/receipts/{receipt_id}/status", json={"status": "approved"})
    assert approve_response.status_code == 200
    assert approve_response.json()["status"] == ReceiptStatus.APPROVED

    # It re-extracts fine, keeping its apartment
    class FakeExtractor:
        def extract(self, file_path):
            return ReceiptData(
                store_name="Re-extracted Store",
                purchase_date="2026-01-16",
                currency="USD",
                items=[],
                discounts=[],
                taxes=[],
                total=30.0,
            )

    main.app.dependency_overrides[get_extractor] = lambda: FakeExtractor()
    reextract_response = client.post(f"/receipts/{receipt_id}/extract")
    assert reextract_response.status_code == 200
    reextract_body = reextract_response.json()
    assert reextract_body["apartment_id"] == "oberaudorf-bergblick"
    # A fresh save resets status to needs_review, same as any other re-extract
    assert reextract_body["status"] == ReceiptStatus.NEEDS_REVIEW
    assert "category_id" not in reextract_body

    # And the old category table/column data is completely untouched by any of this
    conn = sqlite3.connect(db_path)
    categories_after = conn.execute("SELECT id, name, sort_order, active FROM categories ORDER BY id").fetchall()
    category_id_after = conn.execute(
        "SELECT category_id FROM receipts WHERE receipt_id = ?", (receipt_id,)
    ).fetchone()[0]
    conn.close()
    assert categories_after == categories_before
    assert category_id_after == category_id_before


def test_a_new_database_has_no_categories_table_and_no_category_id_column(tmp_path):
    db_path = tmp_path / "new.db"
    SqliteReceiptRepository(db_path)

    conn = sqlite3.connect(db_path)
    try:
        tables = {row[0] for row in conn.execute("SELECT name FROM sqlite_master WHERE type = 'table'")}
        assert "categories" not in tables

        receipts_columns = {row[1] for row in conn.execute("PRAGMA table_info(receipts)")}
        assert "category_id" not in receipts_columns
    finally:
        conn.close()
