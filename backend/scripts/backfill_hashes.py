#!/usr/bin/env python3
"""Backfill content_sha256 for uploads rows saved before duplicate
detection existed.

Usage:
    python scripts/backfill_hashes.py [--dry-run] [--report]

This is an operational script, not part of the domain/adapters/api layers
(see docs/adr/0001-layered-backend.md) -- it reuses the ReceiptRepository
and the existing safe, UUID-based lookup in adapters.file_storage.find_file,
but must never be imported by domain/, adapters/ or api/. Never reads or
copies backend/.env, never prints file contents, never touches a file in
uploads/ or any receipts row.
"""
from __future__ import annotations

import argparse
import sys
import uuid
from pathlib import Path

SCRIPTS_DIR = Path(__file__).resolve().parent
BACKEND_DIR = SCRIPTS_DIR.parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from scripts._common import sha256_file  # noqa: E402

CHUNK_SIZE = 64 * 1024


def run_backfill(repository, dry_run: bool = False) -> dict:
    """For every uploads row without a hash yet: finds its file via the
    same safe lookup every route already uses, hashes it in CHUNK_SIZE
    chunks, and (unless dry_run) stores it via the repository -- never raw
    SQL here. A missing file is skipped and counted, never fatal.
    Idempotent: a row that already has a hash is never revisited, so a
    second run with nothing new to do changes nothing."""
    from adapters.file_storage import find_file  # lazy: this module's pure-ish logic stays importable on its own

    total_uploads = repository.count_uploads()
    without_hash = repository.list_uploads_without_hash()
    already_hashed = total_uploads - len(without_hash)

    hashed = 0
    missing_file = 0

    for upload in without_hash:
        try:
            validated_id = uuid.UUID(upload.receipt_id)
        except ValueError:
            missing_file += 1
            continue

        file_path = find_file(validated_id)
        if file_path is None:
            missing_file += 1
            continue

        digest = sha256_file(file_path, chunk_size=CHUNK_SIZE)
        if not dry_run:
            repository.set_upload_hash(upload.receipt_id, digest)
        hashed += 1

    return {"hashed": hashed, "already_hashed": already_hashed, "missing_file": missing_file}


def _short_apartment_name(name: str | None) -> str:
    """A tiny, script-local stand-in for the frontend's apartmentShortName
    -- the last " - "-separated segment of the apartment's full name, or
    "no apartment" when there is none. Purely cosmetic report output, not
    part of the domain layer."""
    if not name:
        return "no apartment"
    segments = [segment.strip() for segment in name.split(" - ")]
    candidate = segments[-1] if segments else ""
    return candidate or name.strip()


def print_report(repository) -> None:
    """Lists groups of 2+ SAVED receipts whose original file is byte-
    identical (same content_sha256) -- never changes or deletes anything,
    just reports. Newest receipt last in each group."""
    groups = repository.list_saved_hash_duplicate_groups()
    if not groups:
        print("No duplicate groups found among saved receipts.")
        return

    print(f"Found {len(groups)} duplicate group(s) among saved receipts:")
    for group in groups:
        print(f"- {len(group)} receipts with identical files:")
        for summary in group:
            apartment = _short_apartment_name(summary.apartment_name)
            store = summary.store_name or "Not detected"
            purchase_date = summary.purchase_date or "undated"
            total = summary.total if summary.total is not None else "no total"
            print(f"    {summary.receipt_id}  {apartment}  {store}  {purchase_date}  {total}")


def _parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Backfill content_sha256 for uploads rows that don't have one yet."
    )
    parser.add_argument(
        "--dry-run", action="store_true", help="Print what would happen without writing anything"
    )
    parser.add_argument(
        "--report",
        action="store_true",
        help="After the backfill, list groups of saved receipts that share an identical file",
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = _parse_args(argv)

    # Imported lazily so run_backfill()/print_report() above never depend on
    # config.py -- only this CLI entry point does.
    import config
    from adapters.sqlite_repository import SqliteReceiptRepository

    repository = SqliteReceiptRepository(config.DATABASE_PATH)

    summary = run_backfill(repository, dry_run=args.dry_run)

    if args.dry_run:
        print("Dry run -- nothing was written.")
    print(f"Hashed: {summary['hashed']}")
    print(f"Already hashed: {summary['already_hashed']}")
    print(f"Missing file: {summary['missing_file']}")

    if args.report:
        print()
        print_report(repository)

    return 0


if __name__ == "__main__":
    sys.exit(main())
