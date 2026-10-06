from fastapi.testclient import TestClient

import main

client = TestClient(main.app)


def test_allowed_origin_gets_cors_header():
    # Given a request from the allowed Vite dev server origin
    # When the request is made to a simple GET endpoint
    response = client.get("/health", headers={"Origin": "http://localhost:5173"})

    # Then the response includes an Access-Control-Allow-Origin header for that origin
    assert response.status_code == 200
    assert response.headers.get("access-control-allow-origin") == "http://localhost:5173"


def test_unlisted_origin_does_not_get_cors_header():
    # Given a request from an origin that is not in CORS_ORIGINS
    # When the request is made to a simple GET endpoint
    response = client.get("/health", headers={"Origin": "http://evil.example.com"})

    # Then the response does not include an Access-Control-Allow-Origin header
    assert response.status_code == 200
    assert "access-control-allow-origin" not in response.headers
