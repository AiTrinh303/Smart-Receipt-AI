"""Covers the uploads.content_sha256 migration: a database created under
the OLD schema (no content_sha256 column) must gain the column and its
index, with every existing row kept and its content_sha256 left NULL."""

import sqlite3

from adapters.sqlite_repository import SqliteReceiptRepository


def build_old_schema_uploads_row(db_path, receipt_id: str) -> None:
    """Hand-builds an uploads table exactly as it existed before
    content_sha256 was added, with one real row."""
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
            "INSERT INTO uploads (receipt_id, original_filename, stored_filename, content_type, "
            "created_at, apartment_id) VALUES (?, ?, ?, ?, ?, ?)",
            (receipt_id, "receipt.jpg", f"{receipt_id}.jpg", "image/jpeg", "2025-01-01T00:00:00+00:00", None),
        )
        conn.commit()
    finally:
        conn.close()


def test_migration_adds_column_and_index_and_keeps_existing_rows_with_null(tmp_path):
    db_path = tmp_path / "old.db"
    receipt_id = "11111111-1111-1111-1111-111111111111"
    build_old_schema_uploads_row(db_path, receipt_id)

    # When the repository is constructed against this old-schema database
    SqliteReceiptRepository(db_path)

    conn = sqlite3.connect(db_path)
    try:
        columns = {row[1] for row in conn.execute("PRAGMA table_info(uploads)")}
        assert "content_sha256" in columns

        indexes = {row[1] for row in conn.execute("PRAGMA index_list(uploads)")}
        assert "idx_uploads_content_sha256" in indexes

        row = conn.execute(
            "SELECT original_filename, content_sha256 FROM uploads WHERE receipt_id = ?",
            (receipt_id,),
        ).fetchone()
        assert row == ("receipt.jpg", None)
    finally:
        conn.close()


def test_migration_is_idempotent_on_a_second_construction(tmp_path):
    db_path = tmp_path / "old.db"
    build_old_schema_uploads_row(db_path, "22222222-2222-2222-2222-222222222222")

    SqliteReceiptRepository(db_path)
    # Should not raise (ALTER TABLE/CREATE INDEX both guarded) when run again.
    SqliteReceiptRepository(db_path)

    conn = sqlite3.connect(db_path)
    try:
        count = conn.execute("SELECT COUNT(*) FROM uploads").fetchone()[0]
        assert count == 1
    finally:
        conn.close()


def test_a_brand_new_database_already_has_the_column(tmp_path):
    db_path = tmp_path / "new.db"
    SqliteReceiptRepository(db_path)

    conn = sqlite3.connect(db_path)
    try:
        columns = {row[1] for row in conn.execute("PRAGMA table_info(uploads)")}
        assert "content_sha256" in columns
    finally:
        conn.close()
