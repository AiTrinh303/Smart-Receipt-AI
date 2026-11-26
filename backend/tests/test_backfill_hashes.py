"""Covers scripts/backfill_hashes.py: hashing uploads rows that predate
duplicate detection, skipping a missing file, idempotency, --dry-run, and
--report. Temp db and temp uploads dir only."""

import hashlib
import sys
from pathlib import Path

import pytest

BACKEND_DIR = Path(__file__).resolve().parent.parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

import adapters.file_storage as file_storage
from adapters.sqlite_repository import SqliteReceiptRepository
from domain.models import ReceiptData
from scripts.backfill_hashes import _short_apartment_name, print_report, run_backfill

VALID_APARTMENT_ID = "oberaudorf-bergblick"
OTHER_APARTMENT_ID = "sankt-englmar-waldglueck"


@pytest.fixture(autouse=True)
def temp_upload_dir(tmp_path, monkeypatch):
    upload_dir = tmp_path / "uploads"
    upload_dir.mkdir()
    monkeypatch.setattr(file_storage, "UPLOAD_DIR", upload_dir)
    return upload_dir


@pytest.fixture
def temp_repository(tmp_path):
    return SqliteReceiptRepository(tmp_path / "test.db")


SAMPLE_DATA = ReceiptData(
    store_name="Corner Store",
    purchase_date="2026-01-15",
    currency="USD",
    items=[],
    discounts=[],
    taxes=[],
    total=9.99,
)


def seed_upload(repository, upload_dir, receipt_id: str, content: bytes | None, apartment_id=VALID_APARTMENT_ID):
    """Seeds an uploads row with no hash yet -- `content=None` means no
    file is written to disk (the "missing file" case)."""
    if content is not None:
        (upload_dir / f"{receipt_id}.jpg").write_bytes(content)
    repository.save_upload(
        receipt_id=receipt_id,
        original_filename="receipt.jpg",
        stored_filename=f"{receipt_id}.jpg",
        content_type="image/jpeg",
        apartment_id=apartment_id,
    )


def seed_saved_receipt(repository, upload_dir, receipt_id: str, content: bytes, apartment_id=VALID_APARTMENT_ID):
    seed_upload(repository, upload_dir, receipt_id, content, apartment_id=apartment_id)
    repository.save_receipt(receipt_id, SAMPLE_DATA.model_copy(), apartment_id=apartment_id)


def test_backfill_hashes_rows_that_have_files(temp_repository, temp_upload_dir):
    receipt_id = "11111111-1111-1111-1111-111111111111"
    content = b"backfill-me"
    seed_upload(temp_repository, temp_upload_dir, receipt_id, content)

    summary = run_backfill(temp_repository)

    assert summary == {"hashed": 1, "already_hashed": 0, "missing_file": 0}
    with temp_repository._connect() as conn:
        stored = conn.execute(
            "SELECT content_sha256 FROM uploads WHERE receipt_id = ?", (receipt_id,)
        ).fetchone()[0]
    assert stored == hashlib.sha256(content).hexdigest()


def test_backfill_skips_a_missing_file_and_counts_it(temp_repository, temp_upload_dir):
    receipt_id = "22222222-2222-2222-2222-222222222222"
    seed_upload(temp_repository, temp_upload_dir, receipt_id, content=None)

    summary = run_backfill(temp_repository)

    assert summary == {"hashed": 0, "already_hashed": 0, "missing_file": 1}
    with temp_repository._connect() as conn:
        stored = conn.execute(
            "SELECT content_sha256 FROM uploads WHERE receipt_id = ?", (receipt_id,)
        ).fetchone()[0]
    assert stored is None


def test_a_second_run_changes_nothing(temp_repository, temp_upload_dir):
    receipt_id = "33333333-3333-3333-3333-333333333333"
    seed_upload(temp_repository, temp_upload_dir, receipt_id, b"content")

    first = run_backfill(temp_repository)
    assert first["hashed"] == 1

    second = run_backfill(temp_repository)
    assert second == {"hashed": 0, "already_hashed": 1, "missing_file": 0}


def test_dry_run_writes_nothing(temp_repository, temp_upload_dir):
    receipt_id = "44444444-4444-4444-4444-444444444444"
    seed_upload(temp_repository, temp_upload_dir, receipt_id, b"content")

    summary = run_backfill(temp_repository, dry_run=True)
    assert summary["hashed"] == 1

    with temp_repository._connect() as conn:
        stored = conn.execute(
            "SELECT content_sha256 FROM uploads WHERE receipt_id = ?", (receipt_id,)
        ).fetchone()[0]
    assert stored is None  # still unset -- dry run never writes

    # A real (non-dry) run afterwards still has it to do.
    real = run_backfill(temp_repository, dry_run=False)
    assert real["hashed"] == 1


def test_report_lists_a_group_of_identical_files_and_skips_unique_ones(temp_repository, temp_upload_dir, capsys):
    shared_content = b"identical-file-bytes"
    seed_saved_receipt(temp_repository, temp_upload_dir, "55555555-5555-5555-5555-555555555555", shared_content)
    seed_saved_receipt(temp_repository, temp_upload_dir, "66666666-6666-6666-6666-666666666666", shared_content)
    seed_saved_receipt(
        temp_repository, temp_upload_dir, "77777777-7777-7777-7777-777777777777", b"unique-file-bytes"
    )

    run_backfill(temp_repository)
    print_report(temp_repository)

    output = capsys.readouterr().out
    assert "Found 1 duplicate group(s)" in output
    assert "55555555-5555-5555-5555-555555555555" in output
    assert "66666666-6666-6666-6666-666666666666" in output
    assert "77777777-7777-7777-7777-777777777777" not in output


def test_report_with_no_duplicates_says_so(temp_repository, temp_upload_dir, capsys):
    seed_saved_receipt(temp_repository, temp_upload_dir, "88888888-8888-8888-8888-888888888888", b"unique-only")

    run_backfill(temp_repository)
    print_report(temp_repository)

    output = capsys.readouterr().out
    assert "No duplicate groups found" in output


def test_originals_in_uploads_are_unchanged_by_the_backfill(temp_repository, temp_upload_dir):
    receipt_id = "99999999-9999-9999-9999-999999999999"
    content = b"must-not-be-touched"
    seed_upload(temp_repository, temp_upload_dir, receipt_id, content)
    file_path = temp_upload_dir / f"{receipt_id}.jpg"
    before = hashlib.sha256(file_path.read_bytes()).hexdigest()

    run_backfill(temp_repository)

    after = hashlib.sha256(file_path.read_bytes()).hexdigest()
    assert before == after


def test_short_apartment_name_helper():
    assert _short_apartment_name("Fewo JoJo - Sankt Englmar - Waldglück") == "Waldglück"
    assert _short_apartment_name(None) == "no apartment"
    assert _short_apartment_name("Plain Name") == "Plain Name"
