import json
import sqlite3
import zipfile
from pathlib import Path

import pytest

from scripts._common import BACKUP_GLOB_PATTERN, DB_ARCNAME, MANIFEST_FILENAME, UPLOADS_PREFIX, sha256_file
from scripts.backup import BackupError, run_backup


def _seed_database(db_path: Path) -> None:
    conn = sqlite3.connect(db_path)
    conn.execute(
        "CREATE TABLE receipts (receipt_id TEXT PRIMARY KEY, store_name TEXT, "
        "extracted_json TEXT NOT NULL, ai_result_json TEXT NOT NULL, created_at TEXT NOT NULL, "
        "updated_at TEXT NOT NULL)"
    )
    conn.execute(
        "CREATE TABLE uploads (receipt_id TEXT PRIMARY KEY, original_filename TEXT, "
        "stored_filename TEXT, content_type TEXT, created_at TEXT)"
    )
    conn.execute("CREATE TABLE apartments (id TEXT PRIMARY KEY, name TEXT NOT NULL)")
    conn.execute(
        "INSERT INTO receipts VALUES (?, ?, ?, ?, ?, ?)",
        ("r1", "Store A", "{}", "{}", "2026-01-01T00:00:00+00:00", "2026-01-01T00:00:00+00:00"),
    )
    conn.execute(
        "INSERT INTO receipts VALUES (?, ?, ?, ?, ?, ?)",
        ("r2", "Store B", "{}", "{}", "2026-01-02T00:00:00+00:00", "2026-01-02T00:00:00+00:00"),
    )
    conn.execute("INSERT INTO uploads VALUES (?, ?, ?, ?, ?)", ("r1", "a.jpg", "r1.jpg", "image/jpeg", "2026-01-01"))
    conn.execute("INSERT INTO apartments VALUES (?, ?)", ("apt-1", "Apartment One"))
    conn.commit()
    conn.close()


def _seed_uploads(uploads_dir: Path) -> None:
    uploads_dir.mkdir(parents=True, exist_ok=True)
    (uploads_dir / "r1.jpg").write_bytes(b"fake-jpeg-bytes")
    (uploads_dir / "r2.pdf").write_bytes(b"fake-pdf-bytes")
    (uploads_dir / ".gitkeep").write_bytes(b"")


def test_backup_creates_one_zip_with_db_files_and_matching_manifest(tmp_path):
    # Given a seeded temp database with 2 receipts and 2 upload files
    db_path = tmp_path / "receipts.db"
    uploads_dir = tmp_path / "uploads"
    out_dir = tmp_path / "backups"
    _seed_database(db_path)
    _seed_uploads(uploads_dir)

    # When a backup is run
    summary = run_backup(db_path, uploads_dir, out_dir)

    # Then exactly one zip is created containing receipts.db, both files and a manifest
    zips = list(out_dir.glob(BACKUP_GLOB_PATTERN))
    assert len(zips) == 1
    zip_path = zips[0]
    assert summary["zip_path"] == str(zip_path)

    with zipfile.ZipFile(zip_path) as zf:
        names = set(zf.namelist())
        assert names == {DB_ARCNAME, f"{UPLOADS_PREFIX}r1.jpg", f"{UPLOADS_PREFIX}r2.pdf", MANIFEST_FILENAME}

        manifest = json.loads(zf.read(MANIFEST_FILENAME))
        assert manifest["counts"] == {"receipts": 2, "uploads": 1, "apartments": 1}
        assert manifest["file_count"] == 2
        assert manifest["missing_files"] == []

        # And every hash in the manifest matches the actual zip contents
        for arcname, expected_hash in manifest["hashes"].items():
            from scripts._common import sha256_bytes

            assert sha256_bytes(zf.read(arcname)) == expected_hash


def test_env_file_next_to_db_is_never_included_in_the_backup(tmp_path):
    # Given a .env file sitting right next to the database
    db_path = tmp_path / "receipts.db"
    uploads_dir = tmp_path / "uploads"
    out_dir = tmp_path / "backups"
    _seed_database(db_path)
    _seed_uploads(uploads_dir)
    (tmp_path / ".env").write_text("OPENAI_API_KEY=super-secret-value\n")

    # When a backup is run
    run_backup(db_path, uploads_dir, out_dir)

    # Then the .env file (and its contents) are not in the zip
    zip_path = next(out_dir.glob(BACKUP_GLOB_PATTERN))
    with zipfile.ZipFile(zip_path) as zf:
        assert ".env" not in zf.namelist()
        all_bytes = b"".join(zf.read(name) for name in zf.namelist())
        assert b"super-secret-value" not in all_bytes


def test_restored_zip_database_opens_and_has_the_same_rows(tmp_path):
    # Given a seeded database backed up to a zip
    db_path = tmp_path / "receipts.db"
    uploads_dir = tmp_path / "uploads"
    out_dir = tmp_path / "backups"
    _seed_database(db_path)
    _seed_uploads(uploads_dir)
    run_backup(db_path, uploads_dir, out_dir)
    zip_path = next(out_dir.glob(BACKUP_GLOB_PATTERN))

    # When the database member is extracted from the zip and opened
    extract_dir = tmp_path / "extracted"
    extract_dir.mkdir()
    with zipfile.ZipFile(zip_path) as zf:
        zf.extract(DB_ARCNAME, extract_dir)

    # Then it has the same rows as the source database
    conn = sqlite3.connect(extract_dir / DB_ARCNAME)
    rows = conn.execute("SELECT receipt_id, store_name FROM receipts ORDER BY receipt_id").fetchall()
    conn.close()
    assert rows == [("r1", "Store A"), ("r2", "Store B")]


def test_keep_removes_only_older_matching_zips_and_leaves_other_files_alone(tmp_path):
    # Given an output directory with 3 older backup zips and one unrelated file
    db_path = tmp_path / "receipts.db"
    uploads_dir = tmp_path / "uploads"
    out_dir = tmp_path / "backups"
    _seed_database(db_path)
    out_dir.mkdir(parents=True)
    unrelated = out_dir / "notes.txt"
    unrelated.write_text("keep me")
    for name in [
        "receipts-backup-20260101-000000.zip",
        "receipts-backup-20260102-000000.zip",
        "receipts-backup-20260103-000000.zip",
    ]:
        (out_dir / name).write_bytes(b"old-fake-zip")

    # When a backup is run with --keep 2 (now 4 matching zips exist: the 3
    # old ones plus the one just created)
    summary = run_backup(db_path, uploads_dir, out_dir, keep=2)

    # Then only the 2 oldest matching zips are removed; the new backup and
    # the unrelated file are untouched
    remaining = {p.name for p in out_dir.glob(BACKUP_GLOB_PATTERN)}
    assert "receipts-backup-20260101-000000.zip" not in remaining
    assert "receipts-backup-20260102-000000.zip" not in remaining
    assert "receipts-backup-20260103-000000.zip" in remaining
    assert Path(summary["zip_path"]).name in remaining
    assert len(remaining) == 2
    assert unrelated.exists()
    assert unrelated.read_text() == "keep me"


def test_integrity_failure_exits_non_zero_and_leaves_no_final_zip(tmp_path, monkeypatch):
    # Given a backup run where the database copy fails its integrity check
    db_path = tmp_path / "receipts.db"
    uploads_dir = tmp_path / "uploads"
    out_dir = tmp_path / "backups"
    _seed_database(db_path)
    _seed_uploads(uploads_dir)

    import scripts.backup as backup_module

    def fail_integrity(_db_path):
        raise BackupError("Database copy failed integrity check: simulated corruption")

    monkeypatch.setattr(backup_module, "check_integrity", fail_integrity)

    # When the backup is run
    with pytest.raises(BackupError):
        backup_module.run_backup(db_path, uploads_dir, out_dir)

    # Then no final zip (or leftover .partial) is left behind
    assert list(out_dir.glob("receipts-backup-*")) == []


def test_missing_uploads_dir_is_handled_with_db_only_zip_and_zero_files(tmp_path):
    # Given a database but no uploads directory at all
    db_path = tmp_path / "receipts.db"
    uploads_dir = tmp_path / "uploads"  # never created
    out_dir = tmp_path / "backups"
    _seed_database(db_path)

    # When a backup is run
    summary = run_backup(db_path, uploads_dir, out_dir)

    # Then the zip contains only the database and manifest, and the manifest
    # reports 0 files
    assert summary["file_count"] == 0
    zip_path = Path(summary["zip_path"])
    with zipfile.ZipFile(zip_path) as zf:
        names = set(zf.namelist())
        assert names == {DB_ARCNAME, MANIFEST_FILENAME}
        manifest = json.loads(zf.read(MANIFEST_FILENAME))
        assert manifest["file_count"] == 0


def test_backup_does_not_modify_the_source_db_or_files(tmp_path):
    # Given a seeded database and upload files
    db_path = tmp_path / "receipts.db"
    uploads_dir = tmp_path / "uploads"
    out_dir = tmp_path / "backups"
    _seed_database(db_path)
    _seed_uploads(uploads_dir)

    db_hash_before = sha256_file(db_path)
    file_hashes_before = {p.name: sha256_file(p) for p in uploads_dir.iterdir() if p.is_file()}

    # When a backup is run
    run_backup(db_path, uploads_dir, out_dir)

    # Then the source database and files are byte-for-byte unchanged
    assert sha256_file(db_path) == db_hash_before
    file_hashes_after = {p.name: sha256_file(p) for p in uploads_dir.iterdir() if p.is_file()}
    assert file_hashes_after == file_hashes_before
