import json
import sqlite3
import uuid

import pytest
from fastapi.testclient import TestClient

import main
from adapters.sqlite_repository import SqliteReceiptRepository
from api.routes import get_repository
from domain.models import ReceiptData, ReceiptStatus

client = TestClient(main.app)

OBERAUDORF = "oberaudorf-bergblick"
WALDGLUECK = "sankt-englmar-waldglueck"


@pytest.fixture(autouse=True)
def temp_repository(tmp_path):
    repository = SqliteReceiptRepository(tmp_path / "test.db")
    main.app.dependency_overrides[get_repository] = lambda: repository
    return repository


@pytest.fixture(autouse=True)
def clear_dependency_overrides():
    yield
    main.app.dependency_overrides.clear()


def make_receipt_data(**overrides) -> ReceiptData:
    defaults = dict(
        store_name="Corner Store",
        purchase_date="2026-01-15",
        currency="USD",
        items=[],
        discounts=[],
        taxes=[],
        total=19.99,
    )
    defaults.update(overrides)
    return ReceiptData(**defaults)


def seed(
    repository,
    apartment_id: str | None = None,
    status: str = ReceiptStatus.NEEDS_REVIEW,
    **data_overrides,
) -> str:
    receipt_id = str(uuid.uuid4())
    repository.save_receipt(receipt_id, make_receipt_data(**data_overrides), apartment_id=apartment_id)
    with repository._connect() as conn:
        conn.execute(
            "UPDATE receipts SET status = ? WHERE receipt_id = ?",
            (status, receipt_id),
        )
        conn.commit()
    return receipt_id


def item(name=None, quantity=None, unit_price=None, line_total=None):
    return {"name": name, "quantity": quantity, "unit_price": unit_price, "line_total": line_total}


def item_names(response) -> list[str | None]:
    return [row["name"] for row in response.json()["items"]]


def receipt_ids(response) -> list[str]:
    return [row["receipt_id"] for row in response.json()["items"]]


# --- Ordering and flattening -------------------------------------------


def test_rows_from_two_receipts_in_order_with_correct_line_index(temp_repository):
    import time

    # Given an older receipt with two items, then a newer one with one item
    older = seed(
        temp_repository,
        apartment_id=OBERAUDORF,
        items=[item(name="Milk", quantity=1, unit_price=2.5, line_total=2.5), item(name="Bread")],
    )
    time.sleep(0.01)
    newer = seed(temp_repository, apartment_id=OBERAUDORF, items=[item(name="Eggs")])

    # When the items list is fetched
    response = client.get("/items")

    # Then the newer receipt's row comes first, then the older receipt's two
    # rows in their original order, each with the right line_index
    assert response.status_code == 200
    body = response.json()
    assert [(r["receipt_id"], r["line_index"], r["name"]) for r in body["items"]] == [
        (newer, 0, "Eggs"),
        (older, 0, "Milk"),
        (older, 1, "Bread"),
    ]
    assert body["count"] == 3
    assert body["total"] == 3


def test_a_receipt_with_no_items_contributes_nothing(temp_repository):
    # Given one receipt with items and one with an empty items list
    with_items = seed(temp_repository, items=[item(name="Milk")])
    seed(temp_repository, items=[])

    response = client.get("/items")

    assert response.status_code == 200
    body = response.json()
    assert body["count"] == 1
    assert body["items"][0]["receipt_id"] == with_items


def test_null_item_fields_stay_null(temp_repository):
    # Given a line item with every field null except the name
    seed(temp_repository, items=[item(name="Mystery item")])

    response = client.get("/items")

    row = response.json()["items"][0]
    assert row["name"] == "Mystery item"
    assert row["quantity"] is None
    assert row["unit_price"] is None
    assert row["line_total"] is None


# --- Filters -------------------------------------------------------------


@pytest.fixture
def filtered_seed(temp_repository):
    ids = {}
    ids["r1"] = seed(
        temp_repository,
        apartment_id=OBERAUDORF,
        status=ReceiptStatus.NEEDS_REVIEW,
        purchase_date="2026-01-15",
        store_name="Hardware Store",
        items=[item(name="Mop")],
    )
    ids["r2"] = seed(
        temp_repository,
        apartment_id=OBERAUDORF,
        status=ReceiptStatus.APPROVED,
        purchase_date="2025-06-01",
        store_name="Plumber",
        items=[item(name="Pipe")],
    )
    ids["r3"] = seed(
        temp_repository,
        apartment_id=WALDGLUECK,
        status=ReceiptStatus.NEEDS_REVIEW,
        purchase_date=None,
        store_name="Garden Center",
        items=[item(name="Seeds")],
    )
    return ids


def test_filter_by_apartment_alone(filtered_seed):
    response = client.get(f"/items?apartment_id={OBERAUDORF}")
    assert response.status_code == 200
    assert set(receipt_ids(response)) == {filtered_seed["r1"], filtered_seed["r2"]}


def test_filter_by_year_alone(filtered_seed):
    response = client.get("/items?year=2026")
    assert response.status_code == 200
    assert receipt_ids(response) == [filtered_seed["r1"]]


def test_filter_by_year_none(filtered_seed):
    response = client.get("/items?year=none")
    assert response.status_code == 200
    assert receipt_ids(response) == [filtered_seed["r3"]]


def test_filter_by_status_alone(filtered_seed):
    response = client.get(f"/items?status={ReceiptStatus.APPROVED}")
    assert response.status_code == 200
    assert receipt_ids(response) == [filtered_seed["r2"]]


def test_an_unknown_query_parameter_like_category_id_is_simply_ignored(filtered_seed):
    # category_id was a real filter before the expense-category feature was
    # removed (see docs/adr/0004-remove-categories.md) -- an old client or
    # bookmark still sending it must not 422, and must not filter anything.
    response = client.get("/items?category_id=cleaning")
    assert response.status_code == 200
    assert set(receipt_ids(response)) == {filtered_seed["r1"], filtered_seed["r2"], filtered_seed["r3"]}


def test_combined_filters(filtered_seed):
    response = client.get(f"/items?apartment_id={OBERAUDORF}&status={ReceiptStatus.APPROVED}")
    assert response.status_code == 200
    assert receipt_ids(response) == [filtered_seed["r2"]]


def test_unknown_apartment_returns_422(filtered_seed):
    response = client.get("/items?apartment_id=does-not-exist")
    assert response.status_code == 422


def test_bad_status_returns_422(filtered_seed):
    response = client.get("/items?status=archived")
    assert response.status_code == 422


@pytest.mark.parametrize("bad_year", ["1999", "25", "2025x"])
def test_bad_year_returns_422(filtered_seed, bad_year):
    response = client.get(f"/items?year={bad_year}")
    assert response.status_code == 422


# --- Search (q) ------------------------------------------------------------


def test_q_single_word_matches_item_name(temp_repository):
    seed(temp_repository, items=[item(name="Whole Milk"), item(name="Bread")])

    response = client.get("/items?q=milk")

    assert response.status_code == 200
    assert item_names(response) == ["Whole Milk"]


# --- Sorting ---------------------------------------------------------------


@pytest.fixture
def sort_seed(temp_repository):
    import time

    ids = {}
    # Seeded in an order that differs from every sort criterion below, so a
    # passing test actually proves the sort, not an accidental match with
    # insertion order.
    ids["mid"] = seed(
        temp_repository,
        purchase_date="2026-02-01",
        store_name="Mango Store",
        items=[item(name="Mid", line_total=20.0)],
    )
    time.sleep(0.01)
    ids["newest"] = seed(
        temp_repository,
        purchase_date="2026-03-01",
        store_name="Apple Store",
        items=[item(name="Newest", line_total=5.0)],
    )
    time.sleep(0.01)
    ids["undated"] = seed(
        temp_repository,
        purchase_date=None,
        store_name=None,
        items=[item(name="Undated", line_total=None)],
    )
    time.sleep(0.01)
    ids["oldest"] = seed(
        temp_repository,
        purchase_date="2026-01-01",
        store_name="Zebra Store",
        items=[item(name="Oldest", line_total=30.0)],
    )
    return ids


def test_default_sort_is_date_desc(sort_seed):
    default_response = client.get("/items")
    explicit_response = client.get("/items?sort=date_desc")

    assert default_response.status_code == 200
    assert item_names(default_response) == item_names(explicit_response)
    assert item_names(default_response) == ["Newest", "Mid", "Oldest", "Undated"]


def test_sort_date_asc_still_puts_undated_last(sort_seed):
    response = client.get("/items?sort=date_asc")

    assert response.status_code == 200
    assert item_names(response) == ["Oldest", "Mid", "Newest", "Undated"]


def test_sort_amount_desc_puts_null_amounts_last(sort_seed):
    response = client.get("/items?sort=amount_desc")

    assert response.status_code == 200
    assert item_names(response) == ["Oldest", "Mid", "Newest", "Undated"]


def test_sort_amount_asc_puts_null_amounts_last(sort_seed):
    response = client.get("/items?sort=amount_asc")

    assert response.status_code == 200
    assert item_names(response) == ["Newest", "Mid", "Oldest", "Undated"]


def test_sort_store_is_casefold_a_to_z_with_null_last(sort_seed):
    response = client.get("/items?sort=store")

    assert response.status_code == 200
    # Apple Store < Mango Store < Zebra Store < (null store, last)
    assert item_names(response) == ["Newest", "Mid", "Oldest", "Undated"]


def test_sort_tie_breakers_fall_back_to_created_at_desc_receipt_id_asc_line_index_asc(temp_repository):
    import time

    # Given two receipts sharing the exact same purchase date
    first = seed(temp_repository, purchase_date="2026-05-01", items=[item(name="First")])
    time.sleep(0.01)
    second = seed(temp_repository, purchase_date="2026-05-01", items=[item(name="Second")])

    # When sorted by date (either direction -- the tie-break is identical)
    response = client.get("/items?sort=date_desc")

    # Then the newer receipt (created_at DESC) comes first
    assert response.status_code == 200
    assert receipt_ids(response) == [second, first]


def test_invalid_sort_returns_422(sort_seed):
    response = client.get("/items?sort=newest")
    assert response.status_code == 422


def test_limit_and_offset_apply_after_sorting(sort_seed):
    response = client.get("/items?sort=date_asc&limit=2&offset=1")

    assert response.status_code == 200
    body = response.json()
    assert item_names(response) == ["Mid", "Newest"]
    assert body["count"] == 2
    assert body["total"] == 4


def test_q_several_words_requires_all_of_them(temp_repository):
    seed(temp_repository, items=[item(name="Whole Milk"), item(name="Milk Chocolate")])

    response = client.get("/items?q=whole milk")

    assert response.status_code == 200
    assert item_names(response) == ["Whole Milk"]


def test_q_is_case_insensitive(temp_repository):
    seed(temp_repository, items=[item(name="Milch")])

    response = client.get("/items?q=MILCH")

    assert response.status_code == 200
    assert item_names(response) == ["Milch"]


def test_q_matches_through_store_name_even_with_null_item_name(temp_repository):
    seed(temp_repository, store_name="Hardware Store", items=[item(name=None, line_total=5.0)])

    response = client.get("/items?q=hardware")

    assert response.status_code == 200
    body = response.json()
    assert body["count"] == 1
    assert body["items"][0]["name"] is None


def test_q_longer_than_100_chars_returns_422(temp_repository):
    seed(temp_repository, items=[item(name="Milk")])

    response = client.get(f"/items?q={'a' * 101}")

    assert response.status_code == 422


def test_blank_q_is_ignored(temp_repository):
    seed(temp_repository, items=[item(name="Milk")])

    response = client.get("/items?q=   ")

    assert response.status_code == 200
    assert item_names(response) == ["Milk"]


@pytest.mark.parametrize("q", ["gluck", "glueck", "GLÜCK"])
def test_q_without_umlaut_finds_waldglueck(temp_repository, q):
    # Given an item with an umlaut and one without
    seed(temp_repository, items=[item(name="Waldglück Honig"), item(name="Bread")])

    # When searching with or without the umlaut, in any case
    response = client.get("/items", params={"q": q})

    # Then the umlaut item is found
    assert response.status_code == 200
    assert item_names(response) == ["Waldglück Honig"]


@pytest.mark.parametrize(
    "q, expected",
    [("musli", "Müsli"), ("muesli", "Müsli"), ("strasse", "Straße"), ("cafe", "Café")],
)
def test_q_is_accent_and_eszett_insensitive(temp_repository, q, expected):
    # Given items spelled with umlauts, ß and accents
    seed(temp_repository, items=[item(name="Müsli"), item(name="Straße"), item(name="Café"), item(name="Tee")])

    # When searching with the plain spelling
    response = client.get("/items", params={"q": q})

    # Then exactly the matching item is found
    assert response.status_code == 200
    assert item_names(response) == [expected]


def test_q_folding_also_applies_to_the_store_name(temp_repository):
    # Given an item with no name at a store with an umlaut
    seed(temp_repository, store_name="Bäckerei Müller", items=[item(name=None, line_total=2.5)])

    # When searching for the store without umlauts
    response = client.get("/items", params={"q": "baeckerei muller"})

    # Then the row is found through its store name
    assert response.status_code == 200
    assert response.json()["total"] == 1


def test_limit_offset_and_total_are_correct_with_an_accent_insensitive_q(temp_repository):
    # Given five Müsli rows (spelled two ways) among non-matching ones
    seed(
        temp_repository,
        items=[
            item(name="Müsli 1"),
            item(name="Bread"),
            item(name="Muesli 2"),
            item(name="Müsli 3"),
            item(name="Milk"),
            item(name="MÜSLI 4"),
            item(name="Müsli 5"),
        ],
    )

    # When paging through a folded search
    response = client.get("/items", params={"q": "musli", "limit": 2, "offset": 2})

    # Then total counts every match, and the page is the right slice of them
    assert response.status_code == 200
    body = response.json()
    assert body["total"] == 5
    assert body["count"] == 2
    assert item_names(response) == ["Müsli 3", "MÜSLI 4"]


# --- limit/offset/total ------------------------------------------------


def test_limit_and_offset_with_total(temp_repository):
    seed(
        temp_repository,
        items=[item(name="A"), item(name="B"), item(name="C"), item(name="D")],
    )

    response = client.get("/items?limit=2&offset=1")

    assert response.status_code == 200
    body = response.json()
    assert item_names(response) == ["B", "C"]
    assert body["count"] == 2
    assert body["total"] == 4


def test_empty_result_is_200_with_zero_count_and_total(temp_repository):
    response = client.get("/items")

    assert response.status_code == 200
    assert response.json() == {"items": [], "count": 0, "total": 0}


@pytest.mark.parametrize("bad_limit", ["0", "501"])
def test_bad_limit_returns_422(temp_repository, bad_limit):
    response = client.get(f"/items?limit={bad_limit}")
    assert response.status_code == 422


def test_bad_offset_returns_422(temp_repository):
    response = client.get("/items?offset=-1")
    assert response.status_code == 422


# --- Data integrity ------------------------------------------------------


def test_a_deleted_receipts_rows_disappear(temp_repository):
    receipt_id = seed(temp_repository, items=[item(name="Milk")])
    assert client.get("/items").json()["count"] == 1

    delete_response = client.delete(f"/receipts/{receipt_id}")
    assert delete_response.status_code == 204

    response = client.get("/items")
    assert response.json() == {"items": [], "count": 0, "total": 0}


def test_corrupted_json_row_is_skipped_others_still_returned(temp_repository):
    good_id = seed(temp_repository, items=[item(name="Milk")])
    bad_id = str(uuid.uuid4())
    conn = sqlite3.connect(temp_repository._database_path)
    conn.execute(
        """
        INSERT INTO receipts (
            receipt_id, store_name, purchase_date, currency, total,
            extracted_json, ai_result_json, created_at, updated_at
        )
        VALUES (?, NULL, NULL, NULL, NULL, ?, ?, ?, ?)
        """,
        (bad_id, "{not valid json", "{not valid json", "2026-01-01T00:00:00+00:00", "2026-01-01T00:00:00+00:00"),
    )
    conn.commit()
    conn.close()

    response = client.get("/items")

    assert response.status_code == 200
    body = response.json()
    assert body["count"] == 1
    assert body["items"][0]["receipt_id"] == good_id


def test_never_extracted_upload_is_not_listed(temp_repository):
    receipt_id = str(uuid.uuid4())
    temp_repository.save_upload(
        receipt_id=receipt_id,
        original_filename="receipt.jpg",
        stored_filename="abc.jpg",
        content_type="image/jpeg",
    )

    response = client.get("/items")

    assert response.status_code == 200
    assert response.json() == {"items": [], "count": 0, "total": 0}


def test_legacy_raw_date_is_shown_normalized(temp_repository):
    # Given a row saved as if by an older version of the app, with a raw
    # (non-ISO) date already sitting in extracted_json -- written directly
    receipt_id = str(uuid.uuid4())
    raw_data = {
        "store_name": "Store",
        "purchase_date": "2025-06-26 11",
        "currency": "USD",
        "items": [{"name": "Milk", "quantity": None, "unit_price": None, "line_total": None}],
        "discounts": [],
        "taxes": [],
        "total": 10.0,
    }
    now = "2026-01-15T10:00:00+00:00"
    with sqlite3.connect(temp_repository._database_path) as conn:
        conn.execute(
            """
            INSERT INTO receipts (receipt_id, store_name, purchase_date, currency, total,
                extracted_json, ai_result_json, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                receipt_id, "Store", "2025-06-26 11", "USD", "10.0",
                json.dumps(raw_data), json.dumps(raw_data), now, now,
            ),
        )
        conn.commit()

    response = client.get("/items")

    assert response.status_code == 200
    body = response.json()
    assert body["items"][0]["purchase_date"] == "2025-06-26"


# --- Route collision -------------------------------------------------------


def test_items_route_does_not_collide_with_other_routes(temp_repository):
    receipt_id = seed(temp_repository, items=[item(name="Milk")])

    items_response = client.get("/items")
    assert items_response.status_code == 200
    assert "items" in items_response.json()

    receipts_response = client.get("/receipts")
    assert receipts_response.status_code == 200

    receipt_response = client.get(f"/receipts/{receipt_id}")
    assert receipt_response.status_code == 200
    assert receipt_response.json()["receipt_id"] == receipt_id
