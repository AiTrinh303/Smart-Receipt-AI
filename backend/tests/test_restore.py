import hashlib
import json
import sqlite3
import zipfile
from pathlib import Path

import pytest

from scripts._common import DB_ARCNAME, MANIFEST_FILENAME, UPLOADS_PREFIX
from scripts.backup import run_backup
from scripts.restore import RestoreError, run_restore


def _seed_database(db_path: Path) -> None:
    db_path.parent.mkdir(parents=True, exist_ok=True)
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
    conn.execute("INSERT INTO uploads VALUES (?, ?, ?, ?, ?)", ("r1", "a.jpg", "r1.jpg", "image/jpeg", "2026-01-01"))
    conn.execute("INSERT INTO apartments VALUES (?, ?)", ("apt-1", "Apartment One"))
    conn.commit()
    conn.close()


def _seed_uploads(uploads_dir: Path) -> None:
    uploads_dir.mkdir(parents=True, exist_ok=True)
    (uploads_dir / "r1.jpg").write_bytes(b"fake-jpeg-bytes")


def _make_backup(tmp_path: Path) -> Path:
    db_path = tmp_path / "source" / "receipts.db"
    uploads_dir = tmp_path / "source" / "uploads"
    out_dir = tmp_path / "backups"
    _seed_database(db_path)
    _seed_uploads(uploads_dir)
    summary = run_backup(db_path, uploads_dir, out_dir)
    return Path(summary["zip_path"])


def _sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def test_round_trip_restores_same_rows_and_file_hashes(tmp_path):
    # Given a backup of seeded source data
    db_path = tmp_path / "source" / "receipts.db"
    uploads_dir = tmp_path / "source" / "uploads"
    out_dir = tmp_path / "backups"
    _seed_database(db_path)
    _seed_uploads(uploads_dir)
    summary = run_backup(db_path, uploads_dir, out_dir)
    zip_path = Path(summary["zip_path"])

    # When it is restored into a new target folder
    target = tmp_path / "restored"
    restore_summary = run_restore(zip_path, target)

    # Then the database rows and file hashes match the source
    conn = sqlite3.connect(target / "receipts.db")
    rows = conn.execute("SELECT receipt_id, store_name FROM receipts").fetchall()
    conn.close()
    assert rows == [("r1", "Store A")]

    source_hash = _sha256((uploads_dir / "r1.jpg").read_bytes())
    restored_hash = _sha256((target / "uploads" / "r1.jpg").read_bytes())
    assert restored_hash == source_hash
    assert restore_summary["counts"] == {"receipts": 1, "uploads": 1, "apartments": 1}


def test_refuses_a_non_empty_target_without_force(tmp_path):
    # Given a backup and a target that already has a receipts.db in it
    zip_path = _make_backup(tmp_path)
    target = tmp_path / "restored"
    target.mkdir()
    (target / "receipts.db").write_bytes(b"pre-existing data")

    # When restoring without --force
    # Then it refuses and leaves the existing file untouched
    with pytest.raises(RestoreError):
        run_restore(zip_path, target, force=False)
    assert (target / "receipts.db").read_bytes() == b"pre-existing data"


def test_force_keeps_old_data_under_pre_restore_folder(tmp_path):
    # Given a backup and a target with pre-existing data
    zip_path = _make_backup(tmp_path)
    target = tmp_path / "restored"
    target.mkdir()
    (target / "receipts.db").write_bytes(b"old database bytes")
    (target / "uploads").mkdir()
    (target / "uploads" / "old-file.jpg").write_bytes(b"old upload bytes")

    # When restoring with --force
    summary = run_restore(zip_path, target, force=True)

    # Then the old data is kept under a pre-restore-* folder, not deleted
    aside_dir = Path(summary["moved_aside_to"])
    assert aside_dir.parent == target
    assert aside_dir.name.startswith("pre-restore-")
    assert (aside_dir / "receipts.db").read_bytes() == b"old database bytes"
    assert (aside_dir / "uploads" / "old-file.jpg").read_bytes() == b"old upload bytes"

    # And the new data is now in place
    conn = sqlite3.connect(target / "receipts.db")
    rows = conn.execute("SELECT receipt_id FROM receipts").fetchall()
    conn.close()
    assert rows == [("r1",)]


def test_path_traversal_member_is_rejected_and_nothing_written_outside_target(tmp_path):
    # Given a backup zip tampered to include a "../evil.txt" member
    zip_path = _make_backup(tmp_path)
    tampered_path = tmp_path / "tampered.zip"
    with zipfile.ZipFile(zip_path) as src, zipfile.ZipFile(tampered_path, "w") as dst:
        for name in src.namelist():
            dst.writestr(name, src.read(name))
        dst.writestr("../evil.txt", "malicious payload")

    target = tmp_path / "restored"
    outside_marker = tmp_path / "evil.txt"

    # When restoring the tampered zip
    # Then it is rejected and nothing is written outside (or inside) the target
    with pytest.raises(RestoreError):
        run_restore(tampered_path, target, force=False)
    assert not outside_marker.exists()
    assert not target.exists()


def test_tampered_file_hash_mismatch_is_rejected(tmp_path):
    # Given a backup zip whose receipts.db bytes were altered after the manifest was written
    zip_path = _make_backup(tmp_path)
    tampered_path = tmp_path / "tampered.zip"
    with zipfile.ZipFile(zip_path) as src, zipfile.ZipFile(tampered_path, "w") as dst:
        for name in src.namelist():
            data = src.read(name)
            if name == DB_ARCNAME:
                data = data + b"corruption"
            dst.writestr(name, data)

    target = tmp_path / "restored"

    # When restoring the tampered zip
    # Then it is rejected before anything is written
    with pytest.raises(RestoreError):
        run_restore(tampered_path, target, force=False)
    assert not target.exists()


def test_zip_without_manifest_is_rejected(tmp_path):
    # Given a zip with no manifest.json at all
    zip_path = _make_backup(tmp_path)
    no_manifest_path = tmp_path / "no-manifest.zip"
    with zipfile.ZipFile(zip_path) as src, zipfile.ZipFile(no_manifest_path, "w") as dst:
        for name in src.namelist():
            if name == MANIFEST_FILENAME:
                continue
            dst.writestr(name, src.read(name))

    target = tmp_path / "restored"

    # When restoring it
    # Then it is rejected
    with pytest.raises(RestoreError):
        run_restore(no_manifest_path, target, force=False)
    assert not target.exists()
