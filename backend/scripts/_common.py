"""Small helpers shared by scripts/backup.py and scripts/restore.py.

Deliberately standalone (standard library only, no imports from domain/,
adapters/ or api/) since this is an operational script, not part of the
layered application.
"""
from __future__ import annotations

import hashlib
from pathlib import Path

MANIFEST_FILENAME = "manifest.json"
DB_ARCNAME = "receipts.db"
UPLOADS_PREFIX = "uploads/"
BACKUP_GLOB_PATTERN = "receipts-backup-*.zip"
TABLES_FOR_COUNTS = ("receipts", "uploads", "apartments")


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def sha256_file(path: Path, chunk_size: int = 1024 * 1024) -> str:
    hasher = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(chunk_size), b""):
            hasher.update(chunk)
    return hasher.hexdigest()
