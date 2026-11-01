from domain.rules import archive_filename


def test_all_fields_present_builds_expected_shape():
    # Given a receipt with every field present
    name = archive_filename(
        apartment_id="oberaudorf-bergblick",
        purchase_date="2025-06-26",
        store_name="Corner Store",
        total=19.99,
        currency="USD",
    )

    # Then the filename follows apartment_date_store_amount-currency.pdf
    assert name == "oberaudorf-bergblick_2025-06-26_corner-store_19.99-usd.pdf"


def test_missing_apartment_id_falls_back_to_placeholder():
    name = archive_filename(None, "2025-06-26", "Store", 10.0, "USD")
    assert name.startswith("no-apartment_")


def test_missing_purchase_date_falls_back_to_placeholder():
    name = archive_filename("apt", None, "Store", 10.0, "USD")
    assert "_undated_" in name


def test_non_iso_purchase_date_falls_back_to_placeholder():
    # A non-ISO date (e.g. "26/06/2025") is never guessed -- same day/month
    # ambiguity rule as normalize_purchase_date elsewhere in the domain.
    name = archive_filename("apt", "26/06/2025", "Store", 10.0, "USD")
    assert "_undated_" in name


def test_missing_store_name_falls_back_to_placeholder():
    name = archive_filename("apt", "2025-06-26", None, 10.0, "USD")
    assert "_unknown-store_" in name


def test_missing_total_falls_back_to_placeholder():
    name = archive_filename("apt", "2025-06-26", "Store", None, "USD")
    assert name.endswith("_no-total.pdf")


def test_zero_total_is_not_treated_as_missing():
    # 0 is a real amount, distinct from "no total at all"
    name = archive_filename("apt", "2025-06-26", "Store", 0.0, "USD")
    assert "no-total" not in name
    assert "0.00" in name


def test_everything_missing_uses_every_placeholder():
    name = archive_filename(None, None, None, None, None)
    assert name == "no-apartment_undated_unknown-store_no-total.pdf"


def test_total_uses_decimal_formatting_not_float_arithmetic():
    # 10.005 as a float has binary-float imprecision; Decimal(str(value))
    # avoids it landing in the filename as something like "10.004999...".
    name = archive_filename("apt", "2025-06-26", "Store", 10.005, "EUR")
    assert "10.00" in name or "10.01" in name
    assert "10.004999" not in name
    assert "10.00500" not in name


def test_store_name_longer_than_40_chars_is_truncated():
    long_name = "A" * 100
    name = archive_filename("apt", "2025-06-26", long_name, 10.0, "EUR")
    # The store part sits between the date and the total parts.
    store_part = name.split("_")[2]
    assert len(store_part) <= 40


def test_whole_filename_is_capped_at_120_chars():
    long_name = "word " * 50
    name = archive_filename("a" * 60, "2025-06-26", long_name, 10.0, "EUR")
    assert len(name) <= 120
    assert name.endswith(".pdf")


def test_hostile_store_name_with_crlf_and_header_injection_attempt():
    name = archive_filename("apt", "2025-06-26", "x\r\nSet-Cookie: a=b", 10.0, "EUR")
    assert "\r" not in name
    assert "\n" not in name
    assert all(ord(c) < 128 for c in name)


def test_hostile_store_name_with_path_traversal():
    name = archive_filename("apt", "2025-06-26", "../../etc/passwd", 10.0, "EUR")
    assert "/" not in name
    assert "\\" not in name


def test_hostile_store_name_with_quotes():
    name = archive_filename("apt", "2025-06-26", 'a"b\'c', 10.0, "EUR")
    assert '"' not in name
    assert "'" not in name


def test_non_ascii_store_name_is_transliterated():
    name = archive_filename("apt", "2025-06-26", "Waldglück ß", 10.0, "EUR")
    assert all(ord(c) < 128 for c in name)
    assert "waldgluck-ss" in name


def test_filename_is_always_lowercase():
    name = archive_filename("APT", "2025-06-26", "STORE NAME", 10.0, "USD")
    assert name == name.lower()
