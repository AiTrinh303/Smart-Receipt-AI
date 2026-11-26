"""Covers duplicate-file detection at upload time: the 409 contract,
allow_duplicate, POST /receipts/check-duplicates, and the repository
methods behind them. Temp db and temp uploads dir only, FakeExtractor,
never the real OpenAI API or database."""

import io

import pytest
from fastapi.testclient import TestClient

import adapters.file_storage as file_storage
import main
from adapters.sqlite_repository import SqliteReceiptRepository
from api.routes import get_extractor, get_repository
from domain.models import ReceiptData
from domain.rules import content_hash
from _upload_helper import OTHER_APARTMENT_ID, VALID_APARTMENT_ID, upload_with_apartment

client = TestClient(main.app)


@pytest.fixture(autouse=True)
def temp_upload_dir(tmp_path, monkeypatch):
    monkeypatch.setattr(file_storage, "UPLOAD_DIR", tmp_path)
    return tmp_path


@pytest.fixture(autouse=True)
def temp_repository(tmp_path_factory):
    db_dir = tmp_path_factory.mktemp("db")
    repository = SqliteReceiptRepository(db_dir / "test.db")
    main.app.dependency_overrides[get_repository] = lambda: repository
    yield repository
    main.app.dependency_overrides.clear()


class FakeExtractor:
    def __init__(self, data: ReceiptData | None = None):
        self._data = data

    def extract(self, file_path):
        return self._data


def override_extractor(extractor: FakeExtractor):
    main.app.dependency_overrides[get_extractor] = lambda: extractor


SAMPLE_RECEIPT_DATA = ReceiptData(
    store_name="Corner Store",
    purchase_date="2026-01-15",
    currency="USD",
    items=[],
    discounts=[],
    taxes=[],
    total=9.99,
)


def make_files(content: bytes, filename: str = "receipt.jpg", content_type: str = "image/jpeg"):
    return {"file": (filename, io.BytesIO(content), content_type)}


def upload_and_extract(content: bytes, apartment_id: str = VALID_APARTMENT_ID, filename: str = "receipt.jpg") -> str:
    files = make_files(content, filename=filename)
    response = upload_with_apartment(client, files, apartment_id=apartment_id)
    assert response.status_code == 201
    receipt_id = response.json()["receipt_id"]
    override_extractor(FakeExtractor(data=SAMPLE_RECEIPT_DATA))
    extract_response = client.post(f"/receipts/{receipt_id}/extract")
    assert extract_response.status_code == 200
    return receipt_id


# --- Upload: a first upload stores its hash ---------------------------------


def test_a_first_upload_stores_its_hash(temp_repository):
    content = b"receipt-bytes-one"
    files = make_files(content)
    response = upload_with_apartment(client, files)
    assert response.status_code == 201
    receipt_id = response.json()["receipt_id"]

    with temp_repository._connect() as conn:
        row = conn.execute(
            "SELECT content_sha256 FROM uploads WHERE receipt_id = ?", (receipt_id,)
        ).fetchone()
    assert row[0] == content_hash(content)


# --- After extraction, re-uploading the same bytes is a 409 -----------------


def test_same_bytes_after_extraction_returns_409_with_existing_summary(temp_upload_dir, temp_repository):
    content = b"identical-receipt-bytes"
    first_id = upload_and_extract(content)

    before_files = sorted(p.name for p in temp_upload_dir.iterdir())
    with temp_repository._connect() as conn:
        uploads_count_before = conn.execute("SELECT COUNT(*) FROM uploads").fetchone()[0]

    response = upload_with_apartment(client, make_files(content))

    assert response.status_code == 409
    body = response.json()["detail"]
    assert body["code"] == "DUPLICATE_FILE"
    assert body["message"] == "This file is already saved."
    assert body["existing"]["receipt_id"] == first_id
    assert body["existing"]["store_name"] == "Corner Store"

    after_files = sorted(p.name for p in temp_upload_dir.iterdir())
    assert after_files == before_files  # no new file written

    with temp_repository._connect() as conn:
        uploads_count_after = conn.execute("SELECT COUNT(*) FROM uploads").fetchone()[0]
    assert uploads_count_after == uploads_count_before  # no new uploads row


def test_same_bytes_with_allow_duplicate_true_returns_201_and_adds_a_row(temp_repository):
    content = b"identical-receipt-bytes-2"
    upload_and_extract(content)

    with temp_repository._connect() as conn:
        before = conn.execute("SELECT COUNT(*) FROM uploads").fetchone()[0]

    response = upload_with_apartment(client, make_files(content), allow_duplicate=True)
    assert response.status_code == 201

    with temp_repository._connect() as conn:
        after = conn.execute("SELECT COUNT(*) FROM uploads").fetchone()[0]
    assert after == before + 1


def test_same_bytes_when_first_upload_was_never_extracted_returns_201(temp_repository):
    content = b"never-extracted-bytes"
    files = make_files(content)
    first = upload_with_apartment(client, files)
    assert first.status_code == 201
    # No extract call -- no receipts row, so this is not yet a saved receipt.

    second = upload_with_apartment(client, make_files(content))
    assert second.status_code == 201


def test_same_bytes_after_deleting_the_first_receipt_returns_201(temp_repository):
    content = b"deleted-then-reuploaded-bytes"
    first_id = upload_and_extract(content)

    delete_response = client.delete(f"/receipts/{first_id}")
    assert delete_response.status_code == 204

    response = upload_with_apartment(client, make_files(content))
    assert response.status_code == 201


def test_different_bytes_return_201(temp_repository):
    upload_and_extract(b"first-content")
    response = upload_with_apartment(client, make_files(b"second-different-content"))
    assert response.status_code == 201


def test_same_bytes_for_the_other_apartment_returns_409_naming_the_first_apartment(temp_repository):
    content = b"shared-across-apartments"
    upload_and_extract(content, apartment_id=VALID_APARTMENT_ID)

    response = upload_with_apartment(client, make_files(content), apartment_id=OTHER_APARTMENT_ID)
    assert response.status_code == 409
    assert response.json()["detail"]["existing"]["apartment_id"] == VALID_APARTMENT_ID


# --- Validation order: existing checks still win even for duplicate bytes ---


def test_wrong_file_type_keeps_400_even_if_bytes_match_a_saved_receipt(temp_repository):
    content = b"would-be-a-duplicate"
    upload_and_extract(content, filename="receipt.jpg")

    files = {"file": ("receipt.txt", io.BytesIO(content), "text/plain")}
    response = upload_with_apartment(client, files)
    assert response.status_code == 400


def test_empty_file_keeps_400_even_if_bytes_would_match(temp_repository):
    response = upload_with_apartment(client, make_files(b""))
    assert response.status_code == 400


def test_oversized_file_keeps_413_even_if_bytes_would_match(temp_repository):
    big_content = b"x" * (10 * 1024 * 1024 + 1)
    response = upload_with_apartment(client, make_files(big_content))
    assert response.status_code == 413


# --- POST /receipts/check-duplicates ----------------------------------------


def test_check_duplicates_known_and_unknown_hashes(temp_repository):
    known_content = b"known-duplicate-content"
    known_id = upload_and_extract(known_content)
    known_hash = content_hash(known_content)
    unknown_hash = content_hash(b"never uploaded")

    response = client.post("/receipts/check-duplicates", json={"hashes": [known_hash, unknown_hash]})
    assert response.status_code == 200
    items = response.json()["items"]
    assert items[0] == {"hash": known_hash, "existing": items[0]["existing"]}
    assert items[0]["existing"]["receipt_id"] == known_id
    assert items[1] == {"hash": unknown_hash, "existing": None}


def test_check_duplicates_repeated_hash_is_answered_per_entry(temp_repository):
    content = b"repeated-hash-content"
    upload_and_extract(content)
    h = content_hash(content)

    response = client.post("/receipts/check-duplicates", json={"hashes": [h, h, h]})
    items = response.json()["items"]
    assert len(items) == 3
    assert all(item["existing"] is not None for item in items)


def test_check_duplicates_empty_list_returns_empty_items(temp_repository):
    response = client.post("/receipts/check-duplicates", json={"hashes": []})
    assert response.status_code == 200
    assert response.json() == {"items": []}


def test_check_duplicates_never_extracted_upload_is_reported_as_null(temp_repository):
    content = b"uploaded-not-extracted"
    files = make_files(content)
    upload_response = upload_with_apartment(client, files)
    assert upload_response.status_code == 201

    response = client.post("/receipts/check-duplicates", json={"hashes": [content_hash(content)]})
    assert response.json()["items"][0]["existing"] is None


def test_check_duplicates_51_entries_is_422(temp_repository):
    hashes = [content_hash(str(i).encode()) for i in range(51)]
    response = client.post("/receipts/check-duplicates", json={"hashes": hashes})
    assert response.status_code == 422


def test_check_duplicates_50_entries_is_ok(temp_repository):
    hashes = [content_hash(str(i).encode()) for i in range(50)]
    response = client.post("/receipts/check-duplicates", json={"hashes": hashes})
    assert response.status_code == 200


@pytest.mark.parametrize(
    "bad_hash",
    [
        "A" * 64,  # uppercase
        "a" * 63,  # too short
        "g" * 64,  # non-hex
        "",
    ],
)
def test_check_duplicates_rejects_invalid_hash_shapes(temp_repository, bad_hash):
    response = client.post("/receipts/check-duplicates", json={"hashes": [bad_hash]})
    assert response.status_code == 422


def test_check_duplicates_never_calls_the_ai(temp_repository, monkeypatch):
    called = {"value": False}

    def fail_if_called(*args, **kwargs):
        called["value"] = True
        raise AssertionError("check-duplicates must never call the extractor")

    import adapters.openai_extractor as openai_extractor_module

    monkeypatch.setattr(openai_extractor_module.OpenAIReceiptExtractor, "extract", fail_if_called)

    response = client.post("/receipts/check-duplicates", json={"hashes": [content_hash(b"x")]})
    assert response.status_code == 200
    assert called["value"] is False


def test_existing_list_items_report_and_export_routes_still_work(temp_repository):
    receipt_id = upload_and_extract(b"still-works-bytes")

    assert client.get("/receipts").status_code == 200
    assert client.get(f"/receipts/{receipt_id}").status_code == 200
    assert client.get("/items").status_code == 200
    assert client.get("/reports/yearly", params={"year": "2026"}).status_code == 200
    assert (
        client.get("/reports/yearly/export.csv", params={"year": "2026"}).status_code == 200
    )


def test_check_duplicates_route_does_not_collide_with_upload_or_get_by_id(temp_repository):
    # POST /receipts/check-duplicates must never be swallowed by
    # POST /receipts/upload (different path) or by GET /receipts/{id}
    # (different method on a path that otherwise looks similar).
    post_response = client.post("/receipts/check-duplicates", json={"hashes": []})
    assert post_response.status_code == 200

    get_response = client.get("/receipts/check-duplicates")
    # Falls through to GET /receipts/{receipt_id} instead, which 400s on a
    # non-UUID id -- proof this path segment is never treated as an id by
    # the POST route, and vice versa.
    assert get_response.status_code == 400
