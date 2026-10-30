#!/usr/bin/env python3
"""Create a verified backup zip of the receipts database and uploaded files.

Usage:
    python scripts/backup.py [--out DIR] [--keep N]

This is an operational script, not part of the domain/adapters/api layers
(see docs/adr/0001-layered-backend.md) -- it reuses config.DATABASE_PATH and
adapters.file_storage.UPLOAD_DIR but must never be imported by them, and must
never read or copy backend/.env (which holds the OpenAI API key).
"""
from __future__ import annotations

import argparse
import json
import os
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
    BACKUP_GLOB_PATTERN,
    DB_ARCNAME,
    MANIFEST_FILENAME,
    TABLES_FOR_COUNTS,
    UPLOADS_PREFIX,
    sha256_bytes,
    sha256_file,
)

DEFAULT_KEEP = 30


class BackupError(RuntimeError):
    """Raised when a backup cannot be completed and verified safely."""


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def backup_database(source_db: Path, dest_db: Path) -> None:
    # sqlite3's online backup API is used instead of a plain file copy so the
    # copy stays consistent even while another connection (the running
    # server) is writing to the source database at the same time.
    source_conn = sqlite3.connect(source_db)
    dest_conn = sqlite3.connect(dest_db)
    try:
        source_conn.backup(dest_conn)
    finally:
        dest_conn.close()
        source_conn.close()


def check_integrity(db_path: Path) -> None:
    conn = sqlite3.connect(db_path)
    try:
        result = conn.execute("PRAGMA integrity_check").fetchone()[0]
    finally:
        conn.close()
    if result != "ok":
        raise BackupError(f"Database copy failed integrity check: {result}")


def _table_counts(db_path: Path) -> dict[str, int]:
    conn = sqlite3.connect(db_path)
    try:
        return {
            table: conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
            for table in TABLES_FOR_COUNTS
        }
    finally:
        conn.close()


def _collect_upload_files(uploads_dir: Path) -> list[Path]:
    if not uploads_dir.is_dir():
        return []
    return sorted(
        entry
        for entry in uploads_dir.iterdir()
        if entry.is_file() and entry.name != ".gitkeep"
    )


def _verify_zip(zip_path: Path) -> None:
    with zipfile.ZipFile(zip_path, "r") as zf:
        names = set(zf.namelist())
        if MANIFEST_FILENAME not in names:
            raise BackupError("Verification failed: manifest.json missing from the zip")

        manifest = json.loads(zf.read(MANIFEST_FILENAME))
        hashes = manifest.get("hashes", {})

        missing_members = set(hashes) - names
        if missing_members:
            raise BackupError(f"Verification failed: zip is missing {sorted(missing_members)}")

        for arcname, expected_hash in hashes.items():
            if sha256_bytes(zf.read(arcname)) != expected_hash:
                raise BackupError(f"Verification failed: hash mismatch for {arcname}")

        upload_members = [n for n in names if n.startswith(UPLOADS_PREFIX)]
        if len(upload_members) != manifest.get("file_count"):
            raise BackupError(
                "Verification failed: manifest file_count "
                f"{manifest.get('file_count')} does not match {len(upload_members)} "
                "files found in the zip"
            )

        with tempfile.TemporaryDirectory(prefix="receipt-backup-verify-") as tmp:
            db_copy = Path(tmp) / DB_ARCNAME
            db_copy.write_bytes(zf.read(DB_ARCNAME))
            check_integrity(db_copy)
            counts = _table_counts(db_copy)
            if counts != manifest.get("counts"):
                raise BackupError(
                    f"Verification failed: row counts {counts} do not match manifest {manifest.get('counts')}"
                )


def _apply_retention(out_dir: Path, keep: int) -> list[str]:
    backups = sorted(out_dir.glob(BACKUP_GLOB_PATTERN))
    if keep < 0 or len(backups) <= keep:
        return []
    to_remove = backups[: len(backups) - keep]
    removed = []
    for old in to_remove:
        old.unlink()
        removed.append(old.name)
    return removed


def run_backup(
    database_path: Path,
    uploads_dir: Path,
    out_dir: Path,
    keep: int = DEFAULT_KEEP,
) -> dict:
    database_path = Path(database_path)
    uploads_dir = Path(uploads_dir)
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    timestamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    final_name = f"receipts-backup-{timestamp}.zip"
    final_path = out_dir / final_name
    partial_path = out_dir / f"{final_name}.partial"

    with tempfile.TemporaryDirectory(prefix="receipt-backup-") as tmp:
        tmp_dir = Path(tmp)
        db_copy = tmp_dir / DB_ARCNAME

        backup_database(database_path, db_copy)
        # Abort (and never create a zip) if the copy itself is corrupt.
        check_integrity(db_copy)
        counts = _table_counts(db_copy)

        candidate_files = _collect_upload_files(uploads_dir)

        # Written to a .partial name first and renamed only once complete, so
        # a crash mid-write never leaves a valid-looking broken zip behind.
        with zipfile.ZipFile(partial_path, "w", compression=zipfile.ZIP_DEFLATED) as zf:
            zf.write(db_copy, DB_ARCNAME)
            hashes = {DB_ARCNAME: sha256_file(db_copy)}
            included_files: list[str] = []
            missing_files: list[str] = []

            for file_path in candidate_files:
                arcname = f"{UPLOADS_PREFIX}{file_path.name}"
                try:
                    digest = sha256_file(file_path)
                    zf.write(file_path, arcname)
                except FileNotFoundError:
                    # Disappeared between listing and reading -- reported,
                    # never fatal to the rest of the backup.
                    missing_files.append(file_path.name)
                    continue
                hashes[arcname] = digest
                included_files.append(arcname)

            manifest = {
                "created_at": _utc_now_iso(),
                "counts": counts,
                "file_count": len(included_files),
                "missing_files": missing_files,
                "hashes": hashes,
            }
            zf.writestr(MANIFEST_FILENAME, json.dumps(manifest, indent=2, sort_keys=True))

    os.replace(partial_path, final_path)

    try:
        _verify_zip(final_path)
    except BackupError:
        final_path.unlink(missing_ok=True)
        raise

    removed_old_backups = _apply_retention(out_dir, keep)

    return {
        "zip_path": str(final_path),
        "size_bytes": final_path.stat().st_size,
        "counts": counts,
        "file_count": len(included_files),
        "missing_files": missing_files,
        "removed_old_backups": removed_old_backups,
    }


def _default_out_dir() -> Path:
    env_dir = os.environ.get("BACKUP_DIR")
    if env_dir:
        return Path(env_dir)
    repo_root = BACKEND_DIR.parent
    return repo_root / "backups"


def _parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Back up the receipts database and uploaded files.")
    parser.add_argument("--out", type=Path, default=None, help="Output directory for the backup zip")
    parser.add_argument(
        "--keep",
        type=int,
        default=DEFAULT_KEEP,
        help=f"Number of most recent backups to keep in --out (default {DEFAULT_KEEP})",
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = _parse_args(argv)

    # Imported lazily so the pure backup/verify logic above never depends on
    # config.py or adapters/ -- only this CLI entry point does.
    import config
    from adapters.file_storage import UPLOAD_DIR

    out_dir = args.out if args.out is not None else _default_out_dir()

    try:
        summary = run_backup(config.DATABASE_PATH, UPLOAD_DIR, out_dir, keep=args.keep)
    except Exception as exc:
        # Never echo file contents or the OpenAI key -- only a short message.
        print(f"Backup failed: {exc}", file=sys.stderr)
        return 1

    print(f"Backup created: {summary['zip_path']}")
    print(f"Size: {summary['size_bytes']:,} bytes")
    print(
        f"Receipts: {summary['counts']['receipts']}  "
        f"Uploads rows: {summary['counts']['uploads']}  "
        f"Files backed up: {summary['file_count']}"
    )
    if summary["missing_files"]:
        print(
            f"Warning: {len(summary['missing_files'])} file(s) disappeared during the "
            f"backup and were skipped: {', '.join(summary['missing_files'])}"
        )
    if summary["removed_old_backups"]:
        print(
            f"Removed {len(summary['removed_old_backups'])} old backup(s) per --keep={args.keep}: "
            f"{', '.join(summary['removed_old_backups'])}"
        )
    print("Remember to copy this zip to another location (external drive, cloud, etc.) -- see README.md.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
