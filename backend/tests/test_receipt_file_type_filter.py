"""GET /receipts?file_type= (History's "File type" filter) and the pure
domain rule behind it, domain.rules.receipt_file_type. Temp database only,
never the real database or OpenAI."""

import uuid

import pytest
from fastapi.testclient import TestClient

import main
from adapters.sqlite_repository import SqliteReceiptRepository
from api.routes import get_repository
from domain.models import ReceiptData, ReceiptStatus
from domain.rules import receipt_file_type

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


def seed(
    repository,
    content_type: str | None,
    stored_extension: str,
    original_filename: str = "receipt.bin",
    apartment_id: str | None = OBERAUDORF,
    status: str = ReceiptStatus.NEEDS_REVIEW,
    purchase_date: str | None = "2026-01-15",
    store_name: str = "Store",
) -> str:
    """Saves an upload row (content type + stored filename) and its receipt,
    then sets the status directly via SQL."""
    receipt_id = str(uuid.uuid4())
    repository.save_upload(
        receipt_id=receipt_id,
        original_filename=original_filename,
        stored_filename=f"{receipt_id}{stored_extension}",
        content_type=content_type,
        apartment_id=apartment_id,
    )
    repository.save_receipt(
        receipt_id,
        ReceiptData(
            store_name=store_name,
            purchase_date=purchase_date,
            currency="EUR",
            items=[],
            discounts=[],
            taxes=[],
            total=10.0,
        ),
        apartment_id=apartment_id,
    )
    with repository._connect() as conn:
        conn.execute("UPDATE receipts SET status = ? WHERE receipt_id = ?", (status, receipt_id))
        conn.commit()
    return receipt_id


def ids(response) -> set[str]:
    return {item["receipt_id"] for item in response.json()["items"]}


# --- domain.rules.receipt_file_type ------------------------------------------


@pytest.mark.parametrize(
    "content_type, stored_filename, expected",
    [
        ("application/pdf", "a.pdf", "pdf"),
        ("image/jpeg", "a.jpg", "jpg"),
        ("image/jpeg", "a.jpeg", "jpg"),
        ("image/png", "a.png", "png"),
        ("IMAGE/PNG; charset=binary", "a.png", "png"),
        # The stored content type wins over the extension
        ("application/pdf", "a.png", "pdf"),
        # No (or an unknown) content type -> the stored extension
        (None, "a.JPEG", "jpg"),
        ("", "a.pdf", "pdf"),
        ("application/octet-stream", "a.png", "png"),
        # Nothing reliable -> None
        (None, None, None),
        (None, "noextension", None),
        ("text/plain", "a.txt", None),
    ],
)
def test_receipt_file_type(content_type, stored_filename, expected):
    # Given a stored content type and stored filename
    # When the file type is derived
    # Then the content type is preferred, then the stored extension, else None
    assert receipt_file_type(content_type, stored_filename) == expected


# --- GET /receipts?file_type= ---------------------------------------------------


@pytest.fixture
def mixed(temp_repository):
    return {
        "pdf": seed(temp_repository, "application/pdf", ".pdf"),
        "jpg": seed(temp_repository, "image/jpeg", ".jpg"),
        "jpeg": seed(temp_repository, "image/jpeg", ".jpeg"),
        "png": seed(temp_repository, "image/png", ".png"),
    }


@pytest.mark.parametrize(
    "file_type, expected_keys",
    [("pdf", {"pdf"}), ("jpg", {"jpg", "jpeg"}), ("png", {"png"})],
)
def test_each_file_type_returns_only_its_receipts(mixed, file_type, expected_keys):
    # Given one PDF, one .jpg, one .jpeg and one PNG receipt
    # When filtering by a file type
    response = client.get(f"/receipts?file_type={file_type}")

    # Then only that type comes back (a .jpeg counts as jpg), and total matches
    assert response.status_code == 200
    assert ids(response) == {mixed[key] for key in expected_keys}
    assert response.json()["total"] == len(expected_keys)


def test_without_file_type_every_receipt_is_listed(mixed):
    # Given four receipts of mixed types
    # When no file_type is given
    response = client.get("/receipts")

    # Then all four are listed, as before
    assert response.json()["total"] == 4


def test_the_original_filename_is_never_trusted(temp_repository):
    # Given a stored PNG whose original filename claims to be a PDF
    receipt_id = seed(temp_repository, "image/png", ".png", original_filename="scan.pdf")

    # Then it is a PNG, not a PDF
    assert ids(client.get("/receipts?file_type=png")) == {receipt_id}
    assert ids(client.get("/receipts?file_type=pdf")) == set()


def test_a_missing_content_type_falls_back_to_the_stored_extension(temp_repository):
    # Given an upload with no stored content type
    receipt_id = seed(temp_repository, None, ".pdf")

    # Then its stored extension decides
    assert ids(client.get("/receipts?file_type=pdf")) == {receipt_id}


def test_a_receipt_without_an_upload_row_matches_no_file_type(temp_repository):
    # Given a receipt saved without any upload row (no content type, no stored filename)
    receipt_id = str(uuid.uuid4())
    temp_repository.save_receipt(
        receipt_id,
        ReceiptData(store_name="S", purchase_date="2026-01-01", currency="EUR", items=[], discounts=[], taxes=[], total=1.0),
        apartment_id=OBERAUDORF,
    )

    # Then it is listed without a filter, but under no file type
    assert receipt_id in ids(client.get("/receipts"))
    for file_type in ("pdf", "jpg", "png"):
        assert receipt_id not in ids(client.get(f"/receipts?file_type={file_type}"))


def test_file_type_combines_with_apartment_year_and_status(temp_repository):
    # Given PDFs and PNGs across apartments, years and statuses
    match = seed(
        temp_repository, "application/pdf", ".pdf", apartment_id=WALDGLUECK,
        status=ReceiptStatus.APPROVED, purchase_date="2026-05-01",
    )
    seed(temp_repository, "image/png", ".png", apartment_id=WALDGLUECK,
         status=ReceiptStatus.APPROVED, purchase_date="2026-05-02")  # wrong type
    seed(temp_repository, "application/pdf", ".pdf", apartment_id=OBERAUDORF,
         status=ReceiptStatus.APPROVED, purchase_date="2026-05-03")  # wrong apartment
    seed(temp_repository, "application/pdf", ".pdf", apartment_id=WALDGLUECK,
         status=ReceiptStatus.APPROVED, purchase_date="2025-05-04")  # wrong year
    seed(temp_repository, "application/pdf", ".pdf", apartment_id=WALDGLUECK,
         status=ReceiptStatus.NEEDS_REVIEW, purchase_date="2026-05-05")  # wrong status

    # When every filter is combined
    response = client.get(
        f"/receipts?file_type=pdf&apartment_id={WALDGLUECK}&year=2026&status=approved"
    )

    # Then only the one receipt matching all four is returned
    assert response.status_code == 200
    assert ids(response) == {match}
    assert response.json()["total"] == 1


def test_file_type_with_undated_year_filter(temp_repository):
    # Given an undated PDF and a dated PDF
    undated = seed(temp_repository, "application/pdf", ".pdf", purchase_date=None)
    seed(temp_repository, "application/pdf", ".pdf", purchase_date="2026-02-02")

    # Then year=none combines with file_type
    assert ids(client.get("/receipts?file_type=pdf&year=none")) == {undated}


def test_paging_and_total_are_correct_with_file_type_and_sort(temp_repository):
    # Given 5 PDFs (stores A..E) and 4 PNGs interleaved
    pdfs = []
    for index, store in enumerate("ABCDE"):
        pdfs.append(seed(temp_repository, "application/pdf", ".pdf", store_name=store,
                         purchase_date=f"2026-01-{10 + index:02d}"))
        if index < 4:
            seed(temp_repository, "image/png", ".png", purchase_date=f"2026-02-{10 + index:02d}")

    # When paging through the PDFs, oldest first, two at a time
    first = client.get("/receipts?file_type=pdf&sort=date_asc&limit=2&offset=0").json()
    second = client.get("/receipts?file_type=pdf&sort=date_asc&limit=2&offset=2").json()
    third = client.get("/receipts?file_type=pdf&sort=date_asc&limit=2&offset=4").json()

    # Then total counts every PDF (not just the page), and the pages continue in order with no PNG
    assert first["total"] == second["total"] == third["total"] == 5
    assert [item["store_name"] for item in first["items"] + second["items"] + third["items"]] == list("ABCDE")
    assert third["count"] == 1


@pytest.mark.parametrize("bad", ["jpeg", "PDF", "gif", "", "pdf,png"])
def test_any_other_file_type_value_returns_422(mixed, bad):
    # Given any value other than exactly pdf, jpg or png
    # When it is sent
    response = client.get("/receipts", params={"file_type": bad})

    # Then the request is rejected
    assert response.status_code == 422


def test_items_endpoint_is_unaffected(mixed):
    # Given receipts of mixed types (no line items)
    # When GET /items is called with a stray file_type
    response = client.get("/items?file_type=pdf")

    # Then it is simply ignored there (Items is out of scope), like any unknown param
    assert response.status_code == 200
