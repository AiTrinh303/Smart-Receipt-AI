import logging
import uuid
from unittest.mock import Mock

import httpx2
import pytest
from fastapi.testclient import TestClient
from openai import (
    APITimeoutError,
    AuthenticationError,
    NotFoundError,
    PermissionDeniedError,
    RateLimitError,
)

import adapters.file_storage as file_storage
import config
import main
from adapters.openai_extractor import OpenAIReceiptExtractor
from adapters.sqlite_repository import SqliteReceiptRepository
from api.routes import get_extractor, get_repository
from domain.ports import ExtractionError, ExtractionUnavailableError

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
    return repository


@pytest.fixture(autouse=True)
def clear_dependency_overrides():
    yield
    main.app.dependency_overrides.clear()


def store_file(upload_dir, extension: str = ".jpg", content: bytes = b"fake-bytes") -> str:
    receipt_id = str(uuid.uuid4())
    (upload_dir / f"{receipt_id}{extension}").write_bytes(content)
    return receipt_id


def make_http_error(error_cls, status_code: int, message: str):
    request = httpx2.Request("POST", "https://api.openai.com/v1/responses")
    response = httpx2.Response(status_code, request=request, json={"error": {"message": message}})
    return error_cls(message, response=response, body=None)


class FakeExtractorRaising:
    def __init__(self, error: Exception):
        self._error = error

    def extract(self, file_path):
        raise self._error


def override_extractor(extractor):
    main.app.dependency_overrides[get_extractor] = lambda: extractor


# --- Adapter-level: provider exception -> domain exception mapping ---


def _extractor_with_mocked_client():
    extractor = OpenAIReceiptExtractor(api_key="sk-fake", model="gpt-6-astra")
    extractor._client.responses.parse = Mock()
    return extractor


def test_authentication_error_maps_to_extraction_unavailable_error(tmp_path):
    # Given the provider call raises an authentication error (bad/invalid key)
    extractor = _extractor_with_mocked_client()
    extractor._client.responses.parse.side_effect = make_http_error(
        AuthenticationError, 401, "Invalid API key provided"
    )
    file_path = tmp_path / "receipt.jpg"
    file_path.write_bytes(b"fake-bytes")

    # When extract is called
    # Then ExtractionUnavailableError is raised, chaining the real cause
    with pytest.raises(ExtractionUnavailableError) as exc_info:
        extractor.extract(file_path)
    assert isinstance(exc_info.value.__cause__, AuthenticationError)


def test_rate_limit_or_insufficient_quota_error_maps_to_extraction_unavailable_error(tmp_path):
    # Given the provider call raises a rate-limit/insufficient-quota error
    extractor = _extractor_with_mocked_client()
    extractor._client.responses.parse.side_effect = make_http_error(
        RateLimitError, 429, "You have no credits remaining."
    )
    file_path = tmp_path / "receipt.jpg"
    file_path.write_bytes(b"fake-bytes")

    # When extract is called
    # Then ExtractionUnavailableError is raised
    with pytest.raises(ExtractionUnavailableError) as exc_info:
        extractor.extract(file_path)
    assert isinstance(exc_info.value.__cause__, RateLimitError)


def test_model_not_found_error_maps_to_extraction_unavailable_error(tmp_path):
    # Given the provider call raises a model-not-found error
    extractor = _extractor_with_mocked_client()
    extractor._client.responses.parse.side_effect = make_http_error(
        NotFoundError, 404, "The model 'nonexistent-model' does not exist"
    )
    file_path = tmp_path / "receipt.jpg"
    file_path.write_bytes(b"fake-bytes")

    # When extract is called
    # Then ExtractionUnavailableError is raised
    with pytest.raises(ExtractionUnavailableError) as exc_info:
        extractor.extract(file_path)
    assert isinstance(exc_info.value.__cause__, NotFoundError)


def test_permission_denied_error_maps_to_extraction_unavailable_error(tmp_path):
    # Given the provider call raises a permission-denied error
    extractor = _extractor_with_mocked_client()
    extractor._client.responses.parse.side_effect = make_http_error(
        PermissionDeniedError, 403, "You do not have access to this resource"
    )
    file_path = tmp_path / "receipt.jpg"
    file_path.write_bytes(b"fake-bytes")

    # When extract is called
    # Then ExtractionUnavailableError is raised
    with pytest.raises(ExtractionUnavailableError) as exc_info:
        extractor.extract(file_path)
    assert isinstance(exc_info.value.__cause__, PermissionDeniedError)


def test_timeout_still_maps_to_extraction_error(tmp_path):
    # Given the provider call times out
    extractor = _extractor_with_mocked_client()
    request = httpx2.Request("POST", "https://api.openai.com/v1/responses")
    extractor._client.responses.parse.side_effect = APITimeoutError(request=request)
    file_path = tmp_path / "receipt.jpg"
    file_path.write_bytes(b"fake-bytes")

    # When extract is called
    # Then the existing ExtractionError is still raised (receipt-readability failure)
    with pytest.raises(ExtractionError):
        extractor.extract(file_path)


def test_unparseable_output_still_maps_to_extraction_error(tmp_path):
    # Given the provider call succeeds but returns no parsable structured output
    extractor = _extractor_with_mocked_client()
    extractor._client.responses.parse.return_value = Mock(output_parsed=None)
    file_path = tmp_path / "receipt.jpg"
    file_path.write_bytes(b"fake-bytes")

    # When extract is called
    # Then the existing ExtractionError is raised
    with pytest.raises(ExtractionError):
        extractor.extract(file_path)


# --- API-level: status code mapping, response content, logging ---


def test_extraction_unavailable_error_returns_503_with_new_message_nothing_saved(
    temp_upload_dir, temp_repository
):
    # Given a stored receipt and an extractor whose underlying service is unavailable
    receipt_id = store_file(temp_upload_dir)
    override_extractor(FakeExtractorRaising(ExtractionUnavailableError("unavailable")))

    # When the extract endpoint is called
    response = client.post(f"/receipts/{receipt_id}/extract")

    # Then the response is 503 with the new generic message, and nothing was saved
    assert response.status_code == 503
    assert response.json()["detail"] == (
        "The AI service is not available (not configured or out of credit). "
        "Check the server configuration."
    )
    assert temp_repository.get_receipt(receipt_id) is None


def test_extraction_error_still_returns_502_with_existing_message(temp_upload_dir):
    # Given a stored receipt and an extractor that cannot read the receipt
    receipt_id = store_file(temp_upload_dir)
    override_extractor(FakeExtractorRaising(ExtractionError("could not parse")))

    # When the extract endpoint is called
    response = client.post(f"/receipts/{receipt_id}/extract")

    # Then the response is still 502 with the existing generic message
    assert response.status_code == 502
    assert response.json()["detail"] == "Receipt extraction failed. Please try again."


def test_placeholder_key_normalizes_to_not_configured_and_api_returns_503(monkeypatch):
    # Given OPENAI_API_KEY is the literal .env.example placeholder value
    import importlib

    import config as config_module

    monkeypatch.setenv("OPENAI_API_KEY", "your-key-here")
    importlib.reload(config_module)
    try:
        # Then config.py normalizes it to None, same as a missing key
        assert config_module.OPENAI_API_KEY is None

        # And the extract endpoint returns 503 without ever constructing a provider client
        monkeypatch.setattr(config, "OPENAI_API_KEY", None)
        response = client.post(f"/receipts/{uuid.uuid4()}/extract")
        assert response.status_code == 503
    finally:
        importlib.reload(config_module)


def test_empty_key_normalizes_to_not_configured_and_api_returns_503(monkeypatch):
    # Given OPENAI_API_KEY is an empty string
    import importlib

    import config as config_module

    monkeypatch.setenv("OPENAI_API_KEY", "")
    importlib.reload(config_module)
    try:
        # Then config.py normalizes it to None, same as a missing key
        assert config_module.OPENAI_API_KEY is None

        # And the extract endpoint returns 503
        monkeypatch.setattr(config, "OPENAI_API_KEY", None)
        response = client.post(f"/receipts/{uuid.uuid4()}/extract")
        assert response.status_code == 503
    finally:
        importlib.reload(config_module)


def test_response_bodies_for_502_and_503_contain_no_provider_error_text(temp_upload_dir):
    # Given an extractor that fails with a sensitive-looking provider error for each case
    receipt_502 = store_file(temp_upload_dir)
    override_extractor(
        FakeExtractorRaising(ExtractionError("secret-502-detail: sk-shouldnotleak"))
    )
    response_502 = client.post(f"/receipts/{receipt_502}/extract")

    receipt_503 = store_file(temp_upload_dir)
    override_extractor(
        FakeExtractorRaising(ExtractionUnavailableError("secret-503-detail: sk-shouldnotleak"))
    )
    response_503 = client.post(f"/receipts/{receipt_503}/extract")

    # Then neither response leaks the provider error text
    assert "sk-shouldnotleak" not in response_502.text
    assert "secret-502-detail" not in response_502.text
    assert "sk-shouldnotleak" not in response_503.text
    assert "secret-503-detail" not in response_503.text


def test_log_still_contains_real_exception_type_for_503(temp_upload_dir, caplog):
    # Given a stored receipt and an extractor that fails because the service is unavailable
    receipt_id = store_file(temp_upload_dir)
    override_extractor(
        FakeExtractorRaising(ExtractionUnavailableError("secret detail: sk-shouldnotleak"))
    )

    # When the extract endpoint is called
    with caplog.at_level(logging.ERROR):
        response = client.post(f"/receipts/{receipt_id}/extract")

    # Then the response stays generic
    assert response.status_code == 503
    assert "sk-shouldnotleak" not in response.text

    # And the real exception type and cause are still logged server-side
    assert "ExtractionUnavailableError" in caplog.text
    assert "sk-shouldnotleak" in caplog.text
