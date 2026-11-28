import pytest

from domain.models import LineItemRow
from domain.rules import fold_for_search, matches_query


def row(name: str | None, store_name: str | None = "Corner Store") -> LineItemRow:
    return LineItemRow(
        receipt_id="r1",
        line_index=0,
        apartment_id=None,
        apartment_name=None,
        status="needs_review",
        purchase_date="2026-01-15",
        store_name=store_name,
        currency="EUR",
        name=name,
        quantity=None,
        unit_price=None,
        line_total=None,
    )


@pytest.mark.parametrize(
    "text, expected",
    [
        ("Waldglück", "waldgluck"),
        ("GLÜCK", "gluck"),
        ("glueck", "gluck"),
        ("Müsli", "musli"),
        ("Muesli", "musli"),
        ("Straße", "strasse"),
        ("STRASSE", "strasse"),
        ("Café", "cafe"),
        ("Crème brûlée", "creme brulee"),
        ("Öl", "ol"),
        ("Oel", "ol"),
        ("Bäcker", "backer"),
        ("Baecker", "backer"),
        ("Milk", "milk"),
    ],
)
def test_fold_for_search(text, expected):
    # Given a stored or typed spelling
    # When it is folded for search
    # Then case, accents, ß and German digraphs are all normalized away
    assert fold_for_search(text) == expected


@pytest.mark.parametrize(
    "q, name",
    [
        ("gluck", "Waldglück Kaffee"),
        ("glueck", "Waldglück Kaffee"),
        ("GLÜCK", "Waldglück Kaffee"),
        ("musli", "Müsli"),
        ("muesli", "Müsli"),
        ("strasse", "Straße"),
        ("cafe", "Café"),
        ("müsli", "Muesli"),
    ],
)
def test_accent_insensitive_queries_match(q, name):
    # Given a row whose item name has umlauts, ß or accents (or their transliteration)
    # When it is matched against the plain or differently spelled query
    # Then it matches
    assert matches_query(row(name), q)


def test_plain_query_still_matches_as_before():
    # Given a plain ASCII item name
    # Then substring, case-insensitive and all-words matching are unchanged
    assert matches_query(row("Whole Milk"), "milk")
    assert matches_query(row("Whole Milk"), "WHOLE milk")
    assert not matches_query(row("Milk Chocolate"), "whole milk")
    assert not matches_query(row("Bread"), "milk")


def test_folded_query_matches_through_the_store_name():
    # Given a row with no item name and an umlaut in the store name
    # When the query is typed without the umlaut
    # Then it still matches through the store name
    assert matches_query(row(None, store_name="Bäckerei Müller"), "backerei muller")
