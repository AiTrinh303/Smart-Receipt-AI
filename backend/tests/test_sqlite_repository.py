import sqlite3
import time
import uuid
from decimal import Decimal

from adapters.sqlite_repository import SqliteReceiptRepository
from domain.models import Discount, LineItem, ReceiptData, Tax


def make_receipt_data(**overrides) -> ReceiptData:
    defaults = dict(
        store_name="Corner Store",
        purchase_date="2026-01-15",
        currency="USD",
        items=[LineItem(name="Milk", quantity=1, unit_price=2.5, line_total=2.5)],
        discounts=[Discount(description="Loyalty discount", amount=0.5)],
        taxes=[Tax(description="Sales tax", amount=0.2)],
        total=19.99,
    )
    defaults.update(overrides)
    return ReceiptData(**defaults)


def test_save_then_get_receipt_round_trips_all_fields(tmp_path):
    # Given a repository backed by a temp database file
    db_path = tmp_path / "test.db"
    repo = SqliteReceiptRepository(db_path)
    receipt_id = str(uuid.uuid4())
    data = make_receipt_data()

    # When the receipt is saved and then read back
    repo.save_receipt(receipt_id, data)
    saved = repo.get_receipt(receipt_id)

    # Then every field comes back correctly
    assert saved is not None
    assert saved.receipt_id == receipt_id
    assert saved.store_name == "Corner Store"
    assert saved.purchase_date == "2026-01-15"
    assert saved.currency == "USD"
    assert saved.items[0].name == "Milk"
    assert saved.discounts[0].description == "Loyalty discount"
    assert saved.taxes[0].description == "Sales tax"
    assert saved.total == 19.99
    assert saved.created_at
    assert saved.updated_at

    # And the raw extracted_json / ai_result_json columns hold the full data
    conn = sqlite3.connect(db_path)
    row = conn.execute(
        "SELECT extracted_json, ai_result_json FROM receipts WHERE receipt_id = ?",
        (receipt_id,),
    ).fetchone()
    conn.close()
    assert ReceiptData.model_validate_json(row[0]) == data
    assert ReceiptData.model_validate_json(row[1]) == data


def test_persistence_across_new_repository_instance_simulates_restart(tmp_path):
    # Given a receipt saved via one repository instance
    db_path = tmp_path / "test.db"
    repo = SqliteReceiptRepository(db_path)
    receipt_id = str(uuid.uuid4())
    repo.save_receipt(receipt_id, make_receipt_data())

    # When a brand new repository instance is created against the same file
    # (simulating a server restart)
    restarted_repo = SqliteReceiptRepository(db_path)
    saved = restarted_repo.get_receipt(receipt_id)

    # Then the record is still there
    assert saved is not None
    assert saved.store_name == "Corner Store"


def test_upsert_keeps_one_record_preserves_created_at_updates_updated_at(tmp_path):
    # Given a receipt saved once
    db_path = tmp_path / "test.db"
    repo = SqliteReceiptRepository(db_path)
    receipt_id = str(uuid.uuid4())
    repo.save_receipt(receipt_id, make_receipt_data(store_name="First Pass"))
    first = repo.get_receipt(receipt_id)

    # When the same receipt_id is saved again with different data a moment later
    time.sleep(0.01)
    repo.save_receipt(receipt_id, make_receipt_data(store_name="Second Pass"))
    second = repo.get_receipt(receipt_id)

    # Then exactly one record exists, created_at is unchanged, and updated_at changed
    conn = sqlite3.connect(db_path)
    count = conn.execute(
        "SELECT COUNT(*) FROM receipts WHERE receipt_id = ?", (receipt_id,)
    ).fetchone()[0]
    conn.close()
    assert count == 1
    assert second.store_name == "Second Pass"
    assert second.created_at == first.created_at
    assert second.updated_at != first.updated_at


def test_receipt_with_null_fields_and_empty_lists_round_trips(tmp_path):
    # Given a receipt with every nullable field null and every list empty
    repo = SqliteReceiptRepository(tmp_path / "test.db")
    receipt_id = str(uuid.uuid4())
    data = ReceiptData(
        store_name=None,
        purchase_date=None,
        currency=None,
        items=[],
        discounts=[],
        taxes=[],
        total=None,
    )

    # When the receipt is saved and read back
    repo.save_receipt(receipt_id, data)
    saved = repo.get_receipt(receipt_id)

    # Then nulls and empty lists round-trip correctly, with no crash
    assert saved is not None
    assert saved.store_name is None
    assert saved.purchase_date is None
    assert saved.currency is None
    assert saved.items == []
    assert saved.discounts == []
    assert saved.taxes == []
    assert saved.total is None


def test_money_total_stored_as_exact_decimal_string_and_null_stays_null(tmp_path):
    # Given a receipt with a total of 19.99
    db_path = tmp_path / "test.db"
    repo = SqliteReceiptRepository(db_path)
    receipt_id = str(uuid.uuid4())
    repo.save_receipt(receipt_id, make_receipt_data(total=19.99))

    # When the raw `total` column is inspected
    conn = sqlite3.connect(db_path)
    stored_total = conn.execute(
        "SELECT total FROM receipts WHERE receipt_id = ?", (receipt_id,)
    ).fetchone()[0]

    # Then it is stored as the exact decimal string "19.99", never a lossy float expansion
    assert stored_total == "19.99"
    assert stored_total == str(Decimal("19.99"))

    # And a null total is stored as NULL, not a string
    null_receipt_id = str(uuid.uuid4())
    repo.save_receipt(null_receipt_id, make_receipt_data(total=None))
    stored_null_total = conn.execute(
        "SELECT total FROM receipts WHERE receipt_id = ?", (null_receipt_id,)
    ).fetchone()[0]
    conn.close()
    assert stored_null_total is None


def test_upload_round_trips_missing_row_returns_none(tmp_path):
    # Given a repository with no uploads saved yet
    repo = SqliteReceiptRepository(tmp_path / "test.db")
    receipt_id = str(uuid.uuid4())

    # When an upload is saved and read back
    repo.save_upload(
        receipt_id=receipt_id,
        original_filename="receipt.jpg",
        stored_filename=f"{receipt_id}.jpg",
        content_type="image/jpeg",
    )
    saved = repo.get_upload(receipt_id)

    # Then the saved upload round-trips correctly
    assert saved is not None
    assert saved.receipt_id == receipt_id
    assert saved.original_filename == "receipt.jpg"
    assert saved.stored_filename == f"{receipt_id}.jpg"
    assert saved.content_type == "image/jpeg"
    assert saved.created_at

    # And a missing row returns None
    assert repo.get_upload(str(uuid.uuid4())) is None
