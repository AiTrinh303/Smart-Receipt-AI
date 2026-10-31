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
    category_id: str | None = None,
    status: str = ReceiptStatus.NEEDS_REVIEW,
    **data_overrides,
) -> str:
    """Saves one receipt directly via the repository, then sets its
    category/status directly via SQL (PUT /receipts/{id}/category and
    /status are tested elsewhere; this file is only about GET /receipts
    and GET /receipts/facets)."""
    receipt_id = str(uuid.uuid4())
    repository.save_receipt(receipt_id, make_receipt_data(**data_overrides), apartment_id=apartment_id)
    with repository._connect() as conn:
        conn.execute(
            "UPDATE receipts SET category_id = ?, status = ? WHERE receipt_id = ?",
            (category_id, status, receipt_id),
        )
        conn.commit()
    return receipt_id


@pytest.fixture
def seeded(temp_repository):
    r1 = seed(
        temp_repository,
        apartment_id=OBERAUDORF,
        category_id="cleaning",
        status=ReceiptStatus.NEEDS_REVIEW,
        purchase_date="2026-01-15",
    )
    r2 = seed(
        temp_repository,
        apartment_id=OBERAUDORF,
        category_id="repairs",
        status=ReceiptStatus.APPROVED,
        purchase_date="2025-06-01",
    )
    r3 = seed(
        temp_repository,
        apartment_id=WALDGLUECK,
        category_id=None,
        status=ReceiptStatus.NEEDS_REVIEW,
        purchase_date="2026-03-01",
    )
    r4 = seed(
        temp_repository,
        apartment_id=WALDGLUECK,
        category_id="cleaning",
        status=ReceiptStatus.APPROVED,
        purchase_date=None,
    )
    r5 = seed(
        temp_repository,
        apartment_id=None,
        category_id=None,
        status=ReceiptStatus.NEEDS_REVIEW,
        purchase_date="26/06/2025",
    )
    return {"r1": r1, "r2": r2, "r3": r3, "r4": r4, "r5": r5}


def ids(response) -> set[str]:
    return {item["receipt_id"] for item in response.json()["items"]}


# --- GET /receipts filters ------------------------------------------------


def test_no_params_returns_everything_unchanged(seeded):
    response = client.get("/receipts")
    assert response.status_code == 200
    assert ids(response) == set(seeded.values())
    assert response.json()["count"] == 5


def test_filter_by_apartment_alone(seeded):
    response = client.get(f"/receipts?apartment_id={OBERAUDORF}")
    assert response.status_code == 200
    assert ids(response) == {seeded["r1"], seeded["r2"]}


def test_filter_by_year_alone(seeded):
    response = client.get("/receipts?year=2026")
    assert response.status_code == 200
    assert ids(response) == {seeded["r1"], seeded["r3"]}


def test_filter_by_status_alone(seeded):
    response = client.get(f"/receipts?status={ReceiptStatus.APPROVED}")
    assert response.status_code == 200
    assert ids(response) == {seeded["r2"], seeded["r4"]}


def test_filter_by_category_alone(seeded):
    response = client.get("/receipts?category_id=cleaning")
    assert response.status_code == 200
    assert ids(response) == {seeded["r1"], seeded["r4"]}


def test_filter_by_category_none_matches_only_null_category(seeded):
    response = client.get("/receipts?category_id=none")
    assert response.status_code == 200
    assert ids(response) == {seeded["r3"], seeded["r5"]}


def test_year_none_matches_null_and_non_iso_dates_only(seeded):
    # r4 has purchase_date=None, r5 has "26/06/2025" (never normalizes) --
    # both count as undated; every ISO-dated receipt is excluded
    response = client.get("/receipts?year=none")
    assert response.status_code == 200
    assert ids(response) == {seeded["r4"], seeded["r5"]}


def test_a_26_06_2025_date_never_matches_year_2025(seeded):
    # r5's "26/06/2025" is free text that never normalizes to an ISO date,
    # so it must never match year=2025 even though "2025" appears in it
    response = client.get("/receipts?year=2025")
    assert response.status_code == 200
    assert ids(response) == {seeded["r2"]}
    assert seeded["r5"] not in ids(response)


def test_combined_filters_apply_with_and(seeded):
    # apartment=Oberaudorf AND status=approved AND category=repairs -> only r2
    response = client.get(
        f"/receipts?apartment_id={OBERAUDORF}&status={ReceiptStatus.APPROVED}&category_id=repairs"
    )
    assert response.status_code == 200
    assert ids(response) == {seeded["r2"]}


def test_combined_filters_with_no_match_returns_empty_items_and_zero_count(seeded):
    response = client.get(f"/receipts?apartment_id={WALDGLUECK}&category_id=repairs")
    assert response.status_code == 200
    assert response.json() == {"items": [], "count": 0}


def test_unknown_apartment_returns_422(seeded):
    response = client.get("/receipts?apartment_id=does-not-exist")
    assert response.status_code == 422


@pytest.mark.parametrize("bad_year", ["1999", "2101", "2025x", "25", "20255", "abc"])
def test_bad_year_values_return_422(seeded, bad_year):
    response = client.get(f"/receipts?year={bad_year}")
    assert response.status_code == 422


def test_bad_status_returns_422(seeded):
    response = client.get("/receipts?status=archived")
    assert response.status_code == 422


def test_unknown_category_returns_422(seeded):
    response = client.get("/receipts?category_id=does-not-exist")
    assert response.status_code == 422


def test_limit_and_order_still_apply_with_filters(temp_repository):
    import time

    first = seed(temp_repository, apartment_id=OBERAUDORF, purchase_date="2026-01-01")
    time.sleep(0.01)
    second = seed(temp_repository, apartment_id=OBERAUDORF, purchase_date="2026-01-02")
    time.sleep(0.01)
    third = seed(temp_repository, apartment_id=OBERAUDORF, purchase_date="2026-01-03")

    response = client.get(f"/receipts?apartment_id={OBERAUDORF}&limit=2")
    assert response.status_code == 200
    body = response.json()
    assert body["count"] == 2
    assert [item["receipt_id"] for item in body["items"]] == [third, second]
    assert first not in [item["receipt_id"] for item in body["items"]]


# --- GET /receipts/facets ---------------------------------------------------


def test_facets_without_apartment_id(seeded):
    response = client.get("/receipts/facets")
    assert response.status_code == 200
    body = response.json()

    apartments_by_id = {a["id"]: a["count"] for a in body["apartments"]}
    assert apartments_by_id[OBERAUDORF] == 2
    assert apartments_by_id[WALDGLUECK] == 2
    assert body["total"] == 5
    assert body["years"] == [2026, 2025]
    assert body["has_undated"] is True


def test_facets_apartment_counts_ignore_other_filters_they_dont_take(seeded):
    # The facets endpoint itself takes no year/status/category params, but
    # confirm each apartment's count reflects ALL of its receipts, not just
    # a subset -- this is the "ignore other filters" requirement.
    response = client.get("/receipts/facets")
    body = response.json()
    apartments_by_id = {a["id"]: a["count"] for a in body["apartments"]}
    # Oberaudorf has one needs_review + one approved receipt; both counted.
    assert apartments_by_id[OBERAUDORF] == 2


def test_facets_years_order_is_descending(seeded):
    response = client.get("/receipts/facets")
    assert response.json()["years"] == sorted(response.json()["years"], reverse=True)


def test_facets_scoped_to_one_apartment(seeded):
    # Waldglueck has one 2026 receipt and one undated receipt
    response = client.get(f"/receipts/facets?apartment_id={WALDGLUECK}")
    assert response.status_code == 200
    body = response.json()
    assert body["years"] == [2026]
    assert body["has_undated"] is True
    # apartments/total are unaffected by the apartment_id scope
    apartments_by_id = {a["id"]: a["count"] for a in body["apartments"]}
    assert apartments_by_id[OBERAUDORF] == 2
    assert body["total"] == 5


def test_facets_scoped_to_apartment_with_no_undated_receipts(seeded):
    # Oberaudorf's two receipts (2026, 2025) are both ISO-dated
    response = client.get(f"/receipts/facets?apartment_id={OBERAUDORF}")
    assert response.status_code == 200
    body = response.json()
    assert sorted(body["years"]) == [2025, 2026]
    assert body["has_undated"] is False


def test_facets_unknown_apartment_returns_422(seeded):
    response = client.get("/receipts/facets?apartment_id=does-not-exist")
    assert response.status_code == 422


def test_facets_on_empty_database(temp_repository):
    response = client.get("/receipts/facets")
    assert response.status_code == 200
    body = response.json()
    assert body["total"] == 0
    assert body["years"] == []
    assert body["has_undated"] is False
    assert all(a["count"] == 0 for a in body["apartments"])


# --- Route collision: /receipts/facets vs /receipts/{receipt_id} -----------


def test_facets_path_does_not_collide_with_receipt_id_route(seeded):
    # "facets" must never be captured by the {receipt_id} path parameter
    facets_response = client.get("/receipts/facets")
    assert facets_response.status_code == 200
    assert "apartments" in facets_response.json()

    # A real UUID still resolves to the receipt itself, not the facets route
    receipt_response = client.get(f"/receipts/{seeded['r1']}")
    assert receipt_response.status_code == 200
    assert receipt_response.json()["receipt_id"] == seeded["r1"]
