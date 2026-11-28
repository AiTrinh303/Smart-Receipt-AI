"""Covers domain.rules.summarize_year (direct unit tests) and the
GET /reports/yearly and GET /reports/years endpoints (integration,
temp db only, never the real database or OpenAI)."""

import uuid
from datetime import date

import pytest
from fastapi.testclient import TestClient

import main
from adapters.sqlite_repository import SqliteReceiptRepository
from api.routes import get_repository
from domain.models import Apartment, ReceiptData, SavedReceipt
from domain.rules import summarize_year as _summarize_year


def summarize_year(receipts, apartments, year, basis, today):
    """Thin wrapper returning plain dicts (model_dump()) so tests can
    use dict/subscript access and == comparisons against literal dicts."""
    return _summarize_year(receipts, apartments, year, basis, today).model_dump()

client = TestClient(main.app)

OBERAUDORF = "oberaudorf-bergblick"
WALDGLUECK = "sankt-englmar-waldglueck"

APARTMENTS = [
    Apartment(id="a1", name="Apartment One", sort_order=1, active=True),
    Apartment(id="a2", name="Apartment Two", sort_order=2, active=True),
]


@pytest.fixture(autouse=True)
def temp_repository(tmp_path):
    repository = SqliteReceiptRepository(tmp_path / "test.db")
    main.app.dependency_overrides[get_repository] = lambda: repository
    return repository


@pytest.fixture(autouse=True)
def clear_dependency_overrides():
    yield
    main.app.dependency_overrides.clear()


def mk(
    receipt_id: str | None = None,
    purchase_date: str | None = "2026-01-15",
    total: float | None = 10.0,
    currency: str | None = "EUR",
    apartment_id: str | None = "a1",
    status: str = "needs_review",
    store_name: str | None = "Store",
) -> SavedReceipt:
    return SavedReceipt(
        receipt_id=receipt_id or str(uuid.uuid4()),
        original_filename=None,
        content_type=None,
        created_at="2026-01-01T00:00:00+00:00",
        updated_at="2026-01-01T00:00:00+00:00",
        store_name=store_name,
        purchase_date=purchase_date,
        currency=currency,
        items=[],
        discounts=[],
        taxes=[],
        total=total,
        edited=False,
        edited_at=None,
        apartment_id=apartment_id,
        apartment_name="Apartment One" if apartment_id == "a1" else "Apartment Two",
        status=status,
    )


TODAY = date(2026, 6, 1)


# --- domain.rules.summarize_year: money, buckets, dates --------------------


def test_exact_sums_with_awkward_amounts_never_use_float():
    # Given two receipts whose floats would mis-add under binary float math
    receipts = [mk("r1", total=0.1), mk("r2", total=0.2)]

    # When summarized
    summary = summarize_year(receipts, APARTMENTS, 2026, "all", TODAY)

    # Then the sum is the exact decimal "0.30", never "0.30000000000000004"
    apt = next(a for a in summary["apartments"] if a["apartment_id"] == "a1")
    assert apt["by_currency"] == [{"currency": "EUR", "total": "0.30", "receipt_count": 2}]


def test_second_awkward_sum_19_99_plus_5_01():
    receipts = [mk("r1", total=19.99), mk("r2", total=5.01)]
    summary = summarize_year(receipts, APARTMENTS, 2026, "all", TODAY)
    apt = next(a for a in summary["apartments"] if a["apartment_id"] == "a1")
    assert apt["by_currency"][0]["total"] == "25.00"


def test_float_addition_would_be_wrong_for_this_exact_case():
    # Given a classic float-imprecision case
    assert 0.1 + 0.2 != 0.3  # documents *why* this matters: raw float addition fails here
    receipts = [mk("r1", total=0.1), mk("r2", total=0.2)]
    summary = summarize_year(receipts, APARTMENTS, 2026, "all", TODAY)
    apt = next(a for a in summary["apartments"] if a["apartment_id"] == "a1")
    assert apt["by_currency"][0]["total"] == "0.30"


def test_two_currencies_stay_separate():
    receipts = [mk("r1", total=10.0, currency="EUR"), mk("r2", total=20.0, currency="USD")]
    summary = summarize_year(receipts, APARTMENTS, 2026, "all", TODAY)
    apt = next(a for a in summary["apartments"] if a["apartment_id"] == "a1")
    by_currency = {row["currency"]: row for row in apt["by_currency"]}
    assert by_currency["EUR"]["total"] == "10.00"
    assert by_currency["USD"]["total"] == "20.00"


def test_a_negative_total_is_summed_with_its_sign():
    receipts = [mk("r1", total=10.0), mk("r2", total=-3.0)]
    summary = summarize_year(receipts, APARTMENTS, 2026, "all", TODAY)
    apt = next(a for a in summary["apartments"] if a["apartment_id"] == "a1")
    assert apt["by_currency"][0]["total"] == "7.00"


def test_bucket_order_for_a_receipt_matching_several_exclusions():
    # Given a receipt with no total AND no currency AND no apartment --
    # the FIRST matching bucket (no_total) wins, not the others
    receipt = mk("r1", total=None, currency=None, apartment_id=None)
    summary = summarize_year([receipt], APARTMENTS, 2026, "all", TODAY)
    assert summary["excluded"] == {
        "undated": 0,
        "not_approved": 0,
        "no_total": 1,
        "no_currency": 0,
        "no_apartment": 0,
    }


def test_undated_is_counted_globally_never_scoped_to_a_year():
    # Given one undated receipt and a request for 2026
    receipt = mk("r1", purchase_date=None)
    summary_2026 = summarize_year([receipt], APARTMENTS, 2026, "all", TODAY)
    summary_2025 = summarize_year([receipt], APARTMENTS, 2025, "all", TODAY)

    # Then it is excluded.undated for ANY requested year, never "ignored"
    assert summary_2026["excluded"]["undated"] == 1
    assert summary_2025["excluded"]["undated"] == 1


def test_a_different_year_receipt_is_ignored_not_counted_anywhere():
    receipt = mk("r1", purchase_date="2025-06-01")
    summary = summarize_year([receipt], APARTMENTS, 2026, "all", TODAY)
    assert summary["excluded"] == {
        "undated": 0,
        "not_approved": 0,
        "no_total": 0,
        "no_currency": 0,
        "no_apartment": 0,
    }
    assert summary["overall"] == []


@pytest.mark.parametrize(
    "raw_date",
    ["02 Juni 2026", "02.06.2026"],
)
def test_legacy_raw_dates_land_in_the_right_year_and_month(raw_date):
    receipt = mk("r1", purchase_date=raw_date, total=42.0)
    summary = summarize_year([receipt], APARTMENTS, 2026, "all", TODAY)
    apt = next(a for a in summary["apartments"] if a["apartment_id"] == "a1")
    assert apt["by_currency"][0]["total"] == "42.00"
    assert apt["months"] == [{"month": 6, "by_currency": [{"currency": "EUR", "total": "42.00", "receipt_count": 1}]}]


def test_basis_approved_excludes_a_needs_review_receipt():
    receipt = mk("r1", status="needs_review")
    summary = summarize_year([receipt], APARTMENTS, 2026, "approved", TODAY)
    assert summary["excluded"]["not_approved"] == 1
    assert summary["overall"] == []


def test_basis_all_counts_a_needs_review_receipt_and_never_excludes_for_status():
    receipt = mk("r1", status="needs_review")
    summary = summarize_year([receipt], APARTMENTS, 2026, "all", TODAY)
    assert summary["excluded"]["not_approved"] == 0
    apt = next(a for a in summary["apartments"] if a["apartment_id"] == "a1")
    assert apt["by_currency"][0]["total"] == "10.00"


def test_both_apartments_always_listed_a_zero_apartment_shows_empty_lists():
    receipt = mk("r1", apartment_id="a1")
    summary = summarize_year([receipt], APARTMENTS, 2026, "all", TODAY)
    assert [a["apartment_id"] for a in summary["apartments"]] == ["a1", "a2"]
    zero_apt = next(a for a in summary["apartments"] if a["apartment_id"] == "a2")
    assert zero_apt["by_currency"] == []
    assert zero_apt["months"] == []


def test_months_appear_only_where_data_exists():
    receipts = [mk("r1", purchase_date="2026-01-10"), mk("r2", purchase_date="2026-03-10")]
    summary = summarize_year(receipts, APARTMENTS, 2026, "all", TODAY)
    apt = next(a for a in summary["apartments"] if a["apartment_id"] == "a1")
    assert [m["month"] for m in apt["months"]] == [1, 3]


def test_overall_equals_the_sum_of_apartments_per_currency():
    receipts = [
        mk("r1", apartment_id="a1", total=10.0, currency="EUR"),
        mk("r2", apartment_id="a2", total=20.0, currency="EUR"),
    ]
    summary = summarize_year(receipts, APARTMENTS, 2026, "all", TODAY)
    assert summary["overall"] == [{"currency": "EUR", "total": "30.00", "receipt_count": 2}]


def _months_added_up(apartments):
    """Adds the apartments' monthly strings with Decimal -- the expected
    overall_months, computed independently of summarize_year."""
    from decimal import Decimal

    sums: dict[int, dict[str, list]] = {}
    for apartment in apartments:
        for month in apartment["months"]:
            for entry in month["by_currency"]:
                slot = sums.setdefault(month["month"], {}).setdefault(entry["currency"], [Decimal("0"), 0])
                slot[0] += Decimal(entry["total"])
                slot[1] += entry["receipt_count"]
    return [
        {
            "month": month,
            "by_currency": [
                {"currency": currency, "total": str(total), "receipt_count": count}
                for currency, (total, count) in sorted(by_currency.items())
            ],
        }
        for month, by_currency in sorted(sums.items())
    ]


def test_overall_months_equals_the_apartments_months_added_up():
    # Given receipts in both apartments, across several months, with awkward amounts
    receipts = [
        mk("r1", apartment_id="a1", purchase_date="2026-01-05", total=0.1),
        mk("r2", apartment_id="a2", purchase_date="2026-01-20", total=0.2),
        mk("r3", apartment_id="a1", purchase_date="2026-03-02", total=19.99),
        mk("r4", apartment_id="a1", purchase_date="2026-03-28", total=5.01),
        mk("r5", apartment_id="a2", purchase_date="2026-07-14", total=-12.5),
    ]

    # When the year is summarized
    summary = summarize_year(receipts, APARTMENTS, 2026, "all", TODAY)

    # Then overall_months is, per month and currency, the apartments' months added up (exact Decimal)
    assert summary["overall_months"] == _months_added_up(summary["apartments"])
    assert summary["overall_months"] == [
        {"month": 1, "by_currency": [{"currency": "EUR", "total": "0.30", "receipt_count": 2}]},
        {"month": 3, "by_currency": [{"currency": "EUR", "total": "25.00", "receipt_count": 2}]},
        {"month": 7, "by_currency": [{"currency": "EUR", "total": "-12.50", "receipt_count": 1}]},
    ]


def test_overall_months_adds_up_to_overall():
    # Given receipts across months
    receipts = [
        mk("r1", apartment_id="a1", purchase_date="2026-02-01", total=10.0),
        mk("r2", apartment_id="a2", purchase_date="2026-02-03", total=2.5),
        mk("r3", apartment_id="a2", purchase_date="2026-11-30", total=7.25),
    ]
    summary = summarize_year(receipts, APARTMENTS, 2026, "all", TODAY)

    # Then the months' totals per currency add up to overall (built from the same counted receipts)
    from decimal import Decimal

    month_sum = sum(Decimal(m["by_currency"][0]["total"]) for m in summary["overall_months"])
    assert str(month_sum) == summary["overall"][0]["total"] == "19.75"


def test_overall_months_never_mixes_currencies():
    # Given EUR and USD receipts in the same month, in both apartments
    receipts = [
        mk("r1", apartment_id="a1", purchase_date="2026-05-01", total=10.0, currency="EUR"),
        mk("r2", apartment_id="a2", purchase_date="2026-05-02", total=20.0, currency="USD"),
        mk("r3", apartment_id="a2", purchase_date="2026-05-03", total=1.0, currency="EUR"),
    ]
    summary = summarize_year(receipts, APARTMENTS, 2026, "all", TODAY)

    # Then May lists each currency on its own, never summed together
    assert summary["overall_months"] == [
        {
            "month": 5,
            "by_currency": [
                {"currency": "EUR", "total": "11.00", "receipt_count": 2},
                {"currency": "USD", "total": "20.00", "receipt_count": 1},
            ],
        }
    ]


def test_overall_months_uses_only_counted_receipts():
    # Given counted receipts plus every kind of excluded one (and one from another year)
    receipts = [
        mk("r1", apartment_id="a1", purchase_date="2026-04-01", total=10.0),
        mk("r2", purchase_date=None),
        mk("r3", purchase_date="2026-04-02", total=None),
        mk("r4", purchase_date="2026-04-03", currency=None),
        mk("r5", purchase_date="2026-04-04", apartment_id=None),
        mk("r6", purchase_date="2025-04-05", total=99.0),
    ]

    # Then only the counted receipt is in overall_months (same as overall); with basis=approved and
    # nothing approved there is nothing at all
    summary = summarize_year(receipts, APARTMENTS, 2026, "all", TODAY)
    assert summary["overall_months"] == [
        {"month": 4, "by_currency": [{"currency": "EUR", "total": "10.00", "receipt_count": 1}]}
    ]
    assert summarize_year(receipts, APARTMENTS, 2026, "approved", TODAY)["overall_months"] == []


def test_no_receipts_means_empty_overall_months():
    # Given no receipts at all
    # When the year is summarized
    summary = summarize_year([], APARTMENTS, 2026, "all", TODAY)
    # Then overall_months is an empty list (like an empty apartment's months)
    assert summary["overall_months"] == []


def test_every_existing_field_is_unchanged_only_overall_months_is_added():
    # Given a typical year
    receipts = [
        mk("r1", apartment_id="a1", purchase_date="2026-01-10", total=10.0),
        mk("r2", apartment_id="a2", purchase_date="2026-02-10", total=20.0),
    ]
    summary = summarize_year(receipts, APARTMENTS, 2026, "all", TODAY)

    # Then the response has exactly the former fields plus overall_months
    assert set(summary) == {
        "year", "basis", "apartments", "overall", "excluded", "with_warnings", "counted_unreviewed",
        "attention", "possible_duplicates", "possible_duplicate_groups", "largest", "overall_months",
    }
    # And overall is still the plain list of currency totals, the apartments still carry their months
    assert summary["overall"] == [{"currency": "EUR", "total": "30.00", "receipt_count": 2}]
    assert set(summary["apartments"][0]) == {"apartment_id", "apartment_name", "by_currency", "months"}
    assert summary["apartments"][0]["months"] == [
        {"month": 1, "by_currency": [{"currency": "EUR", "total": "10.00", "receipt_count": 1}]}
    ]


def test_with_warnings_counts_only_counted_receipts():
    # Given a counted receipt with a warning (missing store name) and an
    # excluded receipt (no total) that would also warn if it were counted
    counted_with_warning = mk("r1", store_name=None)
    excluded_no_total = mk("r2", total=None, store_name=None)
    summary = summarize_year([counted_with_warning, excluded_no_total], APARTMENTS, 2026, "all", TODAY)
    assert summary["with_warnings"] == 1


def test_edited_totals_are_used_not_ai_result_json(temp_repository):
    # Given a receipt saved then edited, so extracted_json (the working
    # copy) differs from ai_result_json (the original AI output)
    receipt_id = str(uuid.uuid4())
    temp_repository.save_receipt(
        receipt_id,
        ReceiptData(
            store_name="Store",
            purchase_date="2026-01-15",
            currency="EUR",
            items=[],
            discounts=[],
            taxes=[],
            total=10.0,
        ),
        apartment_id="a1",
    )
    from domain.ports import ReceiptUpdate

    temp_repository.update_receipt(
        receipt_id,
        ReceiptUpdate(
            store_name="Store",
            purchase_date="2026-01-15",
            currency="EUR",
            items=[],
            discounts=[],
            taxes=[],
            total=99.0,
        ),
    )

    receipts = temp_repository.list_matching_receipts()
    summary = summarize_year(receipts, APARTMENTS, 2026, "all", TODAY)
    apt = next(a for a in summary["apartments"] if a["apartment_id"] == "a1")
    assert apt["by_currency"][0]["total"] == "99.00"


def test_a_corrupt_row_is_skipped(temp_repository):
    # Given one good receipt and one receipt whose extracted_json is corrupted
    good_id = str(uuid.uuid4())
    temp_repository.save_receipt(
        good_id,
        ReceiptData(
            store_name="Good",
            purchase_date="2026-01-15",
            currency="EUR",
            items=[],
            discounts=[],
            taxes=[],
            total=10.0,
        ),
        apartment_id=OBERAUDORF,
    )
    bad_id = str(uuid.uuid4())
    import sqlite3

    conn = sqlite3.connect(temp_repository._database_path)
    conn.execute(
        """
        INSERT INTO receipts (
            receipt_id, store_name, purchase_date, currency, total,
            extracted_json, ai_result_json, created_at, updated_at, apartment_id
        )
        VALUES (?, NULL, NULL, NULL, NULL, ?, ?, ?, ?, ?)
        """,
        (
            bad_id,
            "{not valid json",
            "{not valid json",
            "2026-01-01T00:00:00+00:00",
            "2026-01-01T00:00:00+00:00",
            OBERAUDORF,
        ),
    )
    conn.commit()
    conn.close()

    receipts = temp_repository.list_matching_receipts()
    apartments = temp_repository.list_apartments()
    summary = summarize_year(receipts, apartments, 2026, "all", TODAY)
    apartment = next(a for a in summary["apartments"] if a["apartment_id"] == OBERAUDORF)
    assert apartment["by_currency"][0]["receipt_count"] == 1


# --- Amendments: default basis, counted_unreviewed, attention, duplicates, largest


def test_default_basis_is_all_and_counts_a_needs_review_receipt():
    receipt = mk("r1", status="needs_review")
    summary = summarize_year([receipt], APARTMENTS, 2026, "all", TODAY)
    assert summary["basis"] == "all"
    apt = next(a for a in summary["apartments"] if a["apartment_id"] == "a1")
    assert apt["by_currency"][0]["receipt_count"] == 1


def test_counted_unreviewed_counts_non_approved_counted_receipts():
    receipts = [mk("r1", status="needs_review"), mk("r2", status="approved")]
    summary = summarize_year(receipts, APARTMENTS, 2026, "all", TODAY)
    assert summary["counted_unreviewed"] == 1


def test_counted_unreviewed_is_zero_under_basis_approved():
    # Every counted receipt under basis=approved is, by definition, approved
    receipts = [mk("r1", status="approved"), mk("r2", status="needs_review")]
    summary = summarize_year(receipts, APARTMENTS, 2026, "approved", TODAY)
    assert summary["counted_unreviewed"] == 0


def test_attention_lists_only_counted_receipts_with_warnings_ordered_by_date_then_id():
    warn_later = mk("rb", purchase_date="2026-02-01", store_name=None)
    warn_earlier = mk("ra", purchase_date="2026-01-01", store_name=None)
    no_warning = mk("rc", purchase_date="2026-03-01", store_name="Fine")
    summary = summarize_year([warn_later, warn_earlier, no_warning], APARTMENTS, 2026, "all", TODAY)
    assert [a["receipt_id"] for a in summary["attention"]] == ["ra", "rb"]
    assert summary["attention"][0]["warning_codes"] == ["MISSING_STORE"]
    assert summary["with_warnings"] == 2


def test_attention_caps_at_50_but_with_warnings_counts_every_one():
    receipts = [mk(f"r{i}", store_name=None, purchase_date=f"2026-01-{(i % 28) + 1:02d}") for i in range(60)]
    summary = summarize_year(receipts, APARTMENTS, 2026, "all", TODAY)
    assert summary["with_warnings"] == 60
    assert len(summary["attention"]) == 50


def test_duplicates_group_receipts_sharing_every_field():
    dup_a = mk("d1", purchase_date="2026-01-15", total=10.0, currency="EUR", apartment_id="a1", store_name="Store X")
    dup_b = mk("d2", purchase_date="2026-01-15", total=10.0, currency="EUR", apartment_id="a1", store_name="store x")
    summary = summarize_year([dup_a, dup_b], APARTMENTS, 2026, "all", TODAY)
    assert summary["possible_duplicate_groups"] == 1
    group = summary["possible_duplicates"][0]
    assert sorted(group["receipt_ids"]) == ["d1", "d2"]
    assert group["total"] == "10.00"


def test_a_different_total_never_groups():
    a = mk("d1", total=10.0, store_name="Store X")
    b = mk("d2", total=10.01, store_name="Store X")
    summary = summarize_year([a, b], APARTMENTS, 2026, "all", TODAY)
    assert summary["possible_duplicate_groups"] == 0


def test_a_different_apartment_never_groups():
    a = mk("d1", apartment_id="a1", store_name="Store X")
    b = mk("d2", apartment_id="a2", store_name="Store X")
    summary = summarize_year([a, b], APARTMENTS, 2026, "all", TODAY)
    assert summary["possible_duplicate_groups"] == 0


def test_a_null_store_is_never_grouped():
    a = mk("d1", store_name=None)
    b = mk("d2", store_name=None)
    summary = summarize_year([a, b], APARTMENTS, 2026, "all", TODAY)
    assert summary["possible_duplicate_groups"] == 0


def test_largest_per_currency_ranks_by_absolute_value_including_a_negative():
    receipts = [
        mk("r1", total=5.0, currency="EUR"),
        mk("r2", total=-50.0, currency="EUR"),
        mk("r3", total=20.0, currency="EUR"),
        mk("r4", total=100.0, currency="USD"),
    ]
    summary = summarize_year(receipts, APARTMENTS, 2026, "all", TODAY)
    by_currency = {entry["currency"]: entry for entry in summary["largest"]}
    assert [item["receipt_id"] for item in by_currency["EUR"]["items"]] == ["r2", "r3", "r1"]
    assert by_currency["USD"]["items"][0]["receipt_id"] == "r4"
    # Alphabetical currency order
    assert [entry["currency"] for entry in summary["largest"]] == ["EUR", "USD"]


def test_excluded_receipts_never_appear_in_attention_duplicates_or_largest():
    excluded = mk("rx", total=None, store_name=None)
    counted = mk("rc", total=10.0, store_name="Store")
    summary = summarize_year([excluded, counted], APARTMENTS, 2026, "all", TODAY)
    attention_ids = [a["receipt_id"] for a in summary["attention"]]
    largest_ids = [item["receipt_id"] for entry in summary["largest"] for item in entry["items"]]
    duplicate_ids = [rid for group in summary["possible_duplicates"] for rid in group["receipt_ids"]]
    assert "rx" not in attention_ids
    assert "rx" not in largest_ids
    assert "rx" not in duplicate_ids


# --- API: GET /reports/yearly, GET /reports/years ---------------------------


def test_year_is_required_else_422():
    response = client.get("/reports/yearly")
    assert response.status_code == 422


@pytest.mark.parametrize("year_value", ["1999", "2101", "abc", "20266"])
def test_invalid_year_values_return_422(year_value):
    response = client.get(f"/reports/yearly?year={year_value}")
    assert response.status_code == 422


def test_invalid_basis_returns_422():
    response = client.get("/reports/yearly?year=2026&basis=maybe")
    assert response.status_code == 422


def test_valid_request_returns_200_with_default_basis_all():
    response = client.get("/reports/yearly?year=2026")
    assert response.status_code == 200
    body = response.json()
    assert body["basis"] == "all"
    assert body["year"] == 2026
    assert len(body["apartments"]) == 2


def test_get_yearly_report_returns_overall_months(temp_repository):
    # Given one saved receipt per apartment in March
    for apartment_id, total in (("oberaudorf-bergblick", 12.5), ("sankt-englmar-waldglueck", 7.5)):
        temp_repository.save_receipt(
            str(uuid.uuid4()),
            ReceiptData(
                store_name="Store", purchase_date="2026-03-15", currency="EUR",
                items=[], discounts=[], taxes=[], total=total,
            ),
            apartment_id=apartment_id,
        )

    # When the yearly report is requested
    body = client.get("/reports/yearly?year=2026").json()

    # Then overall_months has March with both apartments together, and overall is unchanged
    assert body["overall_months"] == [
        {"month": 3, "by_currency": [{"currency": "EUR", "total": "20.00", "receipt_count": 2}]}
    ]
    assert body["overall"] == [{"currency": "EUR", "total": "20.00", "receipt_count": 2}]


def test_report_years_endpoint_returns_descending_years(temp_repository):
    temp_repository.save_receipt(
        str(uuid.uuid4()),
        ReceiptData(store_name="A", purchase_date="2025-01-01", currency="EUR", items=[], discounts=[], taxes=[], total=1.0),
        apartment_id="oberaudorf-bergblick",
    )
    temp_repository.save_receipt(
        str(uuid.uuid4()),
        ReceiptData(store_name="B", purchase_date="2026-01-01", currency="EUR", items=[], discounts=[], taxes=[], total=1.0),
        apartment_id="oberaudorf-bergblick",
    )

    response = client.get("/reports/years")
    assert response.status_code == 200
    assert response.json() == {"items": [2026, 2025]}


def test_other_routes_are_unaffected(temp_repository):
    receipt_id = str(uuid.uuid4())
    temp_repository.save_receipt(
        receipt_id,
        ReceiptData(store_name="A", purchase_date="2026-01-01", currency="EUR", items=[], discounts=[], taxes=[], total=1.0),
        apartment_id=OBERAUDORF,
    )
    assert client.get("/health").status_code == 200
    assert client.get("/apartments").status_code == 200
    assert client.get(f"/receipts/{receipt_id}").status_code == 200
    assert client.get("/receipts").status_code == 200
    assert client.get("/receipts/facets").status_code == 200
    assert client.get("/items").status_code == 200
