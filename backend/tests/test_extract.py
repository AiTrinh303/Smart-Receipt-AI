import uuid

import pytest
from fastapi.testclient import TestClient

import config
import main
from extraction import ExtractionError, ReceiptData

client = TestClient(main.app)


@pytest.fixture(autouse=True)
def temp_upload_dir(tmp_path, monkeypatch):
    monkeypatch.setattr(main, "UPLOAD_DIR", tmp_path)
    return tmp_path


@pytest.fixture(autouse=True)
def clear_dependency_overrides():
    yield
    main.app.dependency_overrides.clear()


class FakeExtractor:
    def __init__(self, data: ReceiptData | None = None, error: Exception | None = None):
        self._data = data
        self._error = error

    def extract(self, file_path):
        if self._error is not None:
            raise self._error
        return self._data


def override_extractor(extractor: FakeExtractor):
    main.app.dependency_overrides[main.get_extractor] = lambda: extractor


def store_file(upload_dir, extension: str, content: bytes = b"fake-bytes") -> str:
    receipt_id = str(uuid.uuid4())
    (upload_dir / f"{receipt_id}{extension}").write_bytes(content)
    return receipt_id


SAMPLE_RECEIPT_DATA = ReceiptData(
    store_name="Corner Store",
    purchase_date="2026-01-15",
    currency="USD",
    items=[
        {"name": "Milk", "quantity": 1, "unit_price": 2.5, "line_total": 2.5},
    ],
    discounts=[{"description": "Loyalty discount", "amount": 0.5}],
    taxes=[{"description": "Sales tax", "amount": 0.2}],
    total=2.2,
)


def test_valid_jpg_extraction_returns_200(temp_upload_dir):
    # Given a stored JPG receipt and an extractor that returns valid data
    receipt_id = store_file(temp_upload_dir, ".jpg")
    override_extractor(FakeExtractor(data=SAMPLE_RECEIPT_DATA))

    # When the extract endpoint is called for that receipt
    response = client.post(f"/receipts/{receipt_id}/extract")

    # Then the response is 200, matches the schema, and includes the receipt_id
    assert response.status_code == 200
    body = response.json()
    assert body["receipt_id"] == receipt_id
    assert body["store_name"] == "Corner Store"
    assert body["items"][0]["name"] == "Milk"
    assert body["discounts"][0]["description"] == "Loyalty discount"
    assert body["taxes"][0]["description"] == "Sales tax"
    assert body["total"] == 2.2


def test_valid_pdf_extraction_returns_200(temp_upload_dir):
    # Given a stored PDF receipt and an extractor that returns valid data
    receipt_id = store_file(temp_upload_dir, ".pdf", content=b"%PDF-1.4 fake pdf content")
    override_extractor(FakeExtractor(data=SAMPLE_RECEIPT_DATA))

    # When the extract endpoint is called for that receipt
    response = client.post(f"/receipts/{receipt_id}/extract")

    # Then the response is 200
    assert response.status_code == 200
    assert response.json()["receipt_id"] == receipt_id


def test_receipt_with_no_discounts_or_taxes_returns_empty_lists(temp_upload_dir):
    # Given a stored receipt where the extractor finds no discounts or taxes
    receipt_id = store_file(temp_upload_dir, ".jpg")
    data = ReceiptData(
        store_name="Corner Store",
        purchase_date=None,
        currency=None,
        items=[],
        discounts=[],
        taxes=[],
        total=None,
    )
    override_extractor(FakeExtractor(data=data))

    # When the extract endpoint is called for that receipt
    response = client.post(f"/receipts/{receipt_id}/extract")

    # Then the response is 200 with empty lists and no crash
    assert response.status_code == 200
    body = response.json()
    assert body["discounts"] == []
    assert body["taxes"] == []
    assert body["items"] == []


def test_unknown_receipt_id_returns_404(temp_upload_dir):
    # Given a syntactically valid UUID with no corresponding stored file
    override_extractor(FakeExtractor(data=SAMPLE_RECEIPT_DATA))
    unknown_id = str(uuid.uuid4())

    # When the extract endpoint is called for that id
    response = client.post(f"/receipts/{unknown_id}/extract")

    # Then the response is 404
    assert response.status_code == 404


def test_non_uuid_receipt_id_is_rejected(temp_upload_dir):
    # Given a receipt_id that is not a valid UUID
    override_extractor(FakeExtractor(data=SAMPLE_RECEIPT_DATA))

    # When the extract endpoint is called with that id
    response = client.post("/receipts/not-a-valid-uuid/extract")

    # Then the request is rejected with 400 and no file is ever looked up
    assert response.status_code == 400


def test_path_traversal_attempt_in_receipt_id_is_rejected(temp_upload_dir):
    # Given a receipt_id containing an encoded path-traversal sequence
    override_extractor(FakeExtractor(data=SAMPLE_RECEIPT_DATA))

    # When the extract endpoint is called with that id
    response = client.post("/receipts/..%2F..%2Fetc%2Fpasswd/extract")

    # Then the request is rejected (400 for an invalid UUID, or 404 if routing
    # splits the segments) and nothing outside the uploads dir is ever read
    assert response.status_code in (400, 404)


def test_extractor_error_returns_502_without_leaking_raw_error(temp_upload_dir):
    # Given a stored receipt and an extractor that fails with a sensitive-looking error
    receipt_id = store_file(temp_upload_dir, ".jpg")
    override_extractor(
        FakeExtractor(error=ExtractionError("secret provider detail: sk-shouldnotleak"))
    )

    # When the extract endpoint is called for that receipt
    response = client.post(f"/receipts/{receipt_id}/extract")

    # Then the response is 502 and the raw error text is never leaked to the client
    assert response.status_code == 502
    assert "sk-shouldnotleak" not in response.text


def test_missing_api_key_returns_503(temp_upload_dir, monkeypatch):
    # Given no OPENAI_API_KEY is configured (and no dependency override is set,
    # so the real get_extractor dependency runs)
    monkeypatch.setattr(config, "OPENAI_API_KEY", None)

    # When the extract endpoint is called, regardless of receipt_id
    response = client.post(f"/receipts/{uuid.uuid4()}/extract")

    # Then the response is 503
    assert response.status_code == 503


def test_health_still_works_without_api_key(monkeypatch):
    # Given no OPENAI_API_KEY is configured
    monkeypatch.setattr(config, "OPENAI_API_KEY", None)

    # When the health endpoint is called
    response = client.get("/health")

    # Then it still returns 200 ok
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}
