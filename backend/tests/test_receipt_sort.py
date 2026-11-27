"""GET /receipts?sort=...: date and amount sorts (dateless/total-less rows
last in both directions), today's upload order as "uploaded_desc", the
stable created_at DESC / receipt_id tie-break, sorting before limit/offset,
and 422 for an unknown value. Temporary database only; no extractor."""

import itertools
import uuid

import pytest
from fastapi.testclient import TestClient

import adapters.sqlite_repository as sqlite_repository_module
import main
from adapters.sqlite_repository import SqliteReceiptRepository
from api.routes import get_repository
from domain.models import ReceiptData
from domain.rules import sort_receipts

client = TestClient(main.app)


@pytest.fixture(autouse=True)
def temp_repository(tmp_path):
    repository = SqliteReceiptRepository(tmp_path / "test.db")
    main.app.dependency_overrides[get_repository] = lambda: repository
    yield repository
    main.app.dependency_overrides.clear()


@pytest.fixture(autouse=True)
def increasing_created_at(monkeypatch):
    """Every save gets a later created_at than the one before, so "uploaded
    order" is exactly the order receipts are saved in the test."""
    counter = itertools.count(1)
    monkeypatch.setattr(
        sqlite_repository_module,
        "_utc_now_iso",
        lambda: f"2026-01-01T00:00:{next(counter):02d}+00:00",
    )


def save(repository, name: str, purchase_date: str | None, total: float | None) -> str:
    receipt_id = str(uuid.uuid4())
    repository.save_receipt(
        receipt_id,
        ReceiptData(
            store_name=name,
            purchase_date=purchase_date,
            currency="EUR",
            items=[],
            discounts=[],
            taxes=[],
            total=total,
        ),
    )
    return receipt_id


def names(params: str = "") -> list[str]:
    response = client.get(f"/receipts{params}")
    assert response.status_code == 200
    return [item["store_name"] for item in response.json()["items"]]


@pytest.fixture
def five_receipts(temp_repository):
    """Saved (uploaded) in this order: A, B, C, D, E.
    - A: 2026-03-01, 10.00
    - B: no valid date ("26/06/2025" stays raw), 50.00
    - C: 2026-01-15, no total
    - D: "02.06.2026" (a recognized dotted date -> 2026-06-02), 5.50
    - E: 2026-03-01 (same date as A), 120.00
    """
    save(temp_repository, "A", "2026-03-01", 10.0)
    save(temp_repository, "B", "26/06/2025", 50.0)
    save(temp_repository, "C", "2026-01-15", None)
    save(temp_repository, "D", "02.06.2026", 5.5)
    save(temp_repository, "E", "2026-03-01", 120.0)


def test_default_is_date_newest_first_with_undated_last(five_receipts):
    # Given five receipts; When listed with no sort
    # Then newest purchase date first (E before A on the shared date: later upload first), undated B last
    assert names() == ["D", "E", "A", "C", "B"]
    # And it's the same as an explicit date_desc
    assert names("?sort=date_desc") == names()


def test_date_asc_is_oldest_first_with_undated_still_last(five_receipts):
    assert names("?sort=date_asc") == ["C", "E", "A", "D", "B"]


def test_amount_desc_and_asc_put_receipts_without_a_total_last_in_both_directions(five_receipts):
    assert names("?sort=amount_desc") == ["E", "B", "A", "D", "C"]
    assert names("?sort=amount_asc") == ["D", "A", "B", "E", "C"]


def test_uploaded_desc_is_todays_upload_order(five_receipts):
    assert names("?sort=uploaded_desc") == ["E", "D", "C", "B", "A"]


def test_sorting_happens_before_limit_and_offset_and_total_is_unchanged(five_receipts):
    # Given amount_desc over five receipts
    full = names("?sort=amount_desc")

    # When paged two at a time
    pages = []
    for offset in (0, 2, 4):
        body = client.get(f"/receipts?sort=amount_desc&limit=2&offset={offset}").json()
        assert body["total"] == 5
        pages += [item["store_name"] for item in body["items"]]

    # Then the pages continue the same order, with nothing repeated or missing
    assert pages == full


def test_sort_combines_with_filters(five_receipts):
    # Given only the 2026-dated receipts (the year filter)
    # Then amount_asc orders just those, total-less C still last
    assert names("?year=2026&sort=amount_asc") == ["D", "A", "E", "C"]


def test_equal_keys_keep_the_created_at_desc_then_receipt_id_tie_break(temp_repository, monkeypatch):
    # Given three receipts with the same date and total, two sharing one created_at
    monkeypatch.setattr(sqlite_repository_module, "_utc_now_iso", lambda: "2026-01-01T00:00:00+00:00")
    tied = sorted([save(temp_repository, "T", "2026-01-15", 1.0), save(temp_repository, "T", "2026-01-15", 1.0)])
    monkeypatch.setattr(sqlite_repository_module, "_utc_now_iso", lambda: "2026-01-02T00:00:00+00:00")
    newest = save(temp_repository, "T", "2026-01-15", 1.0)

    # When listed by every sort
    for sort in ("date_desc", "date_asc", "amount_desc", "amount_asc", "uploaded_desc"):
        ids = [item["receipt_id"] for item in client.get(f"/receipts?sort={sort}").json()["items"]]
        # Then ties are broken by created_at DESC, then receipt_id ASC
        assert ids == [newest, *tied], sort


@pytest.mark.parametrize("bad", ["store", "DATE_DESC", "uploaded", "", "date_desc "])
def test_an_unknown_sort_is_422(temp_repository, bad):
    response = client.get(f"/receipts?sort={bad}")
    assert response.status_code == 422
    assert "sort must be one of" in response.json()["detail"]


def test_sort_receipts_compares_totals_as_decimal_not_float():
    # Given totals whose float order differs from their decimal order only by rounding noise
    rows = [("x", 0.1 + 0.2), ("y", 0.3)]

    # When sorted ascending (stable)
    ordered = sort_receipts(rows, "amount_asc", purchase_date=lambda r: None, total=lambda r: r[1])

    # Then Decimal(str(...)) sees 0.30000000000000004 > 0.3, so y first -- and nothing crashes on floats
    assert [r[0] for r in ordered] == ["y", "x"]
