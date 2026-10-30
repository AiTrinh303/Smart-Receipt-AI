#!/usr/bin/env python3
"""Restore a receipts backup zip into a fresh target data directory.

Usage:
    python scripts/restore.py ZIPFILE --target DIR [--force]

Never restores into the live data directory automatically, and never
imports from domain/, adapters/ or api/. Every check below runs (and every
member is read into memory and verified) before anything is written to
--target, so a rejected zip leaves the target untouched.
"""
from __future__ import annotations

import argparse
import json
import shutil
import sqlite3
import sys
import tempfile
import zipfile
from datetime import datetime, timezone
from pathlib import Path

SCRIPTS_DIR = Path(__file__).resolve().parent
BACKEND_DIR = SCRIPTS_DIR.parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from scripts._common import (  # noqa: E402
    DB_ARCNAME,
    MANIFEST_FILENAME,
    TABLES_FOR_COUNTS,
    UPLOADS_PREFIX,
    sha256_bytes,
)


class RestoreError(RuntimeError):
    """Raised when a backup zip cannot be safely restored."""


def _is_safe_member_name(name: str) -> bool:
    # Zip-slip protection: no absolute paths, no Windows drive letters, no
    # ".." path segment anywhere in the member name.
    if not name or name.startswith("/") or name.startswith("\\"):
        return False
    if len(name) >= 2 and name[1] == ":":
        return False
    return ".." not in Path(name).parts


def _is_allowed_member(name: str) -> bool:
    if name in (DB_ARCNAME, MANIFEST_FILENAME):
        return True
    return name.startswith(UPLOADS_PREFIX) and name != UPLOADS_PREFIX


def _check_integrity(db_path: Path) -> None:
    conn = sqlite3.connect(db_path)
    try:
        result = conn.execute("PRAGMA integrity_check").fetchone()[0]
    finally:
        conn.close()
    if result != "ok":
        raise RestoreError(f"Restored database failed integrity check: {result}")


def _table_counts(db_path: Path) -> dict[str, int]:
    conn = sqlite3.connect(db_path)
    try:
        return {
            table: conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
            for table in TABLES_FOR_COUNTS
        }
    finally:
        conn.close()


def _target_has_existing_data(target: Path) -> bool:
    if (target / DB_ARCNAME).exists():
        return True
    uploads_dir = target / "uploads"
    return uploads_dir.is_dir() and any(uploads_dir.iterdir())


def _move_aside(target: Path) -> Path:
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    aside_dir = target / f"pre-restore-{timestamp}"
    aside_dir.mkdir(parents=True, exist_ok=True)

    db_path = target / DB_ARCNAME
    if db_path.exists():
        shutil.move(str(db_path), str(aside_dir / DB_ARCNAME))

    uploads_dir = target / "uploads"
    if uploads_dir.is_dir():
        shutil.move(str(uploads_dir), str(aside_dir / "uploads"))

    return aside_dir


def run_restore(zip_path: Path, target: Path, force: bool = False) -> dict:
    zip_path = Path(zip_path)
    target = Path(target)

    with zipfile.ZipFile(zip_path, "r") as zf:
        file_infos = [info for info in zf.infolist() if not info.is_dir()]
        names = {info.filename for info in file_infos}

        if MANIFEST_FILENAME not in names:
            raise RestoreError("Backup zip is missing manifest.json; refusing to restore")

        # Validate every member's path *and* that it is one of the expected
        # kinds before reading or writing anything.
        for info in file_infos:
            name = info.filename
            if not _is_safe_member_name(name):
                raise RestoreError(f"Unsafe path in backup zip: {name}")
            if not _is_allowed_member(name):
                raise RestoreError(f"Unexpected file in backup zip: {name}")

        manifest = json.loads(zf.read(MANIFEST_FILENAME))
        hashes = manifest.get("hashes", {})
        manifest_counts = manifest.get("counts", {})

        if DB_ARCNAME not in names:
            raise RestoreError("Backup zip is missing receipts.db; refusing to restore")

        db_bytes = zf.read(DB_ARCNAME)
        if sha256_bytes(db_bytes) != hashes.get(DB_ARCNAME):
            raise RestoreError("receipts.db does not match its recorded hash; refusing to restore")

        file_payloads: dict[str, bytes] = {}
        for name in names:
            if name in (DB_ARCNAME, MANIFEST_FILENAME):
                continue
            data = zf.read(name)
            if sha256_bytes(data) != hashes.get(name):
                raise RestoreError(f"{name} does not match its recorded hash; refusing to restore")
            file_payloads[name] = data

    with tempfile.TemporaryDirectory(prefix="receipt-restore-") as tmp:
        staged_db = Path(tmp) / DB_ARCNAME
        staged_db.write_bytes(db_bytes)
        _check_integrity(staged_db)

        restored_counts = _table_counts(staged_db)
        if manifest_counts and restored_counts != manifest_counts:
            raise RestoreError(
                f"Restored row counts {restored_counts} do not match the backup manifest {manifest_counts}; "
                "refusing to restore"
            )

        if _target_has_existing_data(target) and not force:
            raise RestoreError(
                f"Target '{target}' already contains receipt data; pass --force to move it aside and restore anyway"
            )

        aside_dir = _move_aside(target) if (force and _target_has_existing_data(target)) else None

        target.mkdir(parents=True, exist_ok=True)
        shutil.copy2(staged_db, target / DB_ARCNAME)

        uploads_dir = target / "uploads"
        if file_payloads:
            uploads_dir.mkdir(parents=True, exist_ok=True)
            for arcname, data in file_payloads.items():
                filename = arcname[len(UPLOADS_PREFIX):]
                (uploads_dir / filename).write_bytes(data)

    return {
        "target": str(target),
        "database_path": str(target / DB_ARCNAME),
        "uploads_dir": str(uploads_dir) if file_payloads else None,
        "counts": restored_counts,
        "file_count": len(file_payloads),
        "moved_aside_to": str(aside_dir) if aside_dir else None,
    }


def _parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Restore a receipts backup zip into a target data directory.")
    parser.add_argument("zip_path", type=Path, help="Path to a receipts-backup-*.zip file")
    parser.add_argument(
        "--target",
        type=Path,
        required=True,
        help="Directory to restore receipts.db and uploads/ into (never the live data directory)",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Move any existing data in --target aside (pre-restore-<timestamp>/) and restore anyway",
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = _parse_args(argv)

    try:
        summary = run_restore(args.zip_path, args.target, force=args.force)
    except Exception as exc:
        print(f"Restore failed: {exc}", file=sys.stderr)
        return 1

    print(f"Restored database to: {summary['database_path']}")
    if summary["uploads_dir"]:
        print(f"Restored {summary['file_count']} file(s) to: {summary['uploads_dir']}")
    else:
        print("No uploaded files were present in this backup.")
    print(f"Row counts: {summary['counts']}")
    if summary["moved_aside_to"]:
        print(f"Existing data in the target was moved aside to: {summary['moved_aside_to']}")
    print()
    print("To use the restored data: stop the server, then either point DATABASE_PATH at")
    print(f"  {summary['database_path']}")
    print("and the uploads directory at")
    print(f"  {summary['uploads_dir'] or '(none -- this backup had no files)'}")
    print("or copy receipts.db and uploads/ from the target into backend/data/ and backend/uploads/.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
