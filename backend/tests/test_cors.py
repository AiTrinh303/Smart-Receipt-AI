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


def test_preflight_for_put_on_a_receipt_succeeds_with_put_allowed():
    # Given a browser about to send a PUT request (e.g. the edit form's Save)
    # When it sends the CORS preflight OPTIONS request first
    response = client.options(
        "/receipts/11111111-1111-1111-1111-111111111111",
        headers={
            "Origin": "http://localhost:5173",
            "Access-Control-Request-Method": "PUT",
            "Access-Control-Request-Headers": "content-type",
        },
    )

    # Then the preflight succeeds, echoes the allowed origin, and allows PUT
    assert response.status_code in (200, 204)
    assert response.headers.get("access-control-allow-origin") == "http://localhost:5173"
    assert "PUT" in response.headers.get("access-control-allow-methods", "")


def test_preflight_for_delete_on_a_receipt_succeeds_with_delete_allowed():
    # Given a browser about to send a DELETE request (e.g. the delete button)
    # When it sends the CORS preflight OPTIONS request first
    response = client.options(
        "/receipts/11111111-1111-1111-1111-111111111111",
        headers={
            "Origin": "http://localhost:5173",
            "Access-Control-Request-Method": "DELETE",
            "Access-Control-Request-Headers": "content-type",
        },
    )

    # Then the preflight succeeds, echoes the allowed origin, and allows DELETE
    assert response.status_code in (200, 204)
    assert response.headers.get("access-control-allow-origin") == "http://localhost:5173"
    assert "DELETE" in response.headers.get("access-control-allow-methods", "")


def test_preflight_for_put_on_a_receipt_apartment_succeeds_with_put_allowed():
    # Given a browser about to send a PUT request to move a receipt's apartment
    # When it sends the CORS preflight OPTIONS request first
    response = client.options(
        "/receipts/11111111-1111-1111-1111-111111111111/apartment",
        headers={
            "Origin": "http://localhost:5173",
            "Access-Control-Request-Method": "PUT",
            "Access-Control-Request-Headers": "content-type",
        },
    )

    # Then the preflight succeeds, echoes the allowed origin, and allows PUT
    assert response.status_code in (200, 204)
    assert response.headers.get("access-control-allow-origin") == "http://localhost:5173"
    assert "PUT" in response.headers.get("access-control-allow-methods", "")


def test_preflight_for_put_on_a_receipt_category_succeeds_with_put_allowed():
    # Given a browser about to send a PUT request to set a receipt's category
    # When it sends the CORS preflight OPTIONS request first
    response = client.options(
        "/receipts/11111111-1111-1111-1111-111111111111/category",
        headers={
            "Origin": "http://localhost:5173",
            "Access-Control-Request-Method": "PUT",
            "Access-Control-Request-Headers": "content-type",
        },
    )

    # Then the preflight succeeds, echoes the allowed origin, and allows PUT
    assert response.status_code in (200, 204)
    assert response.headers.get("access-control-allow-origin") == "http://localhost:5173"
    assert "PUT" in response.headers.get("access-control-allow-methods", "")


def test_preflight_for_put_on_a_receipt_status_succeeds_with_put_allowed():
    # Given a browser about to send a PUT request to approve/un-approve a receipt
    # When it sends the CORS preflight OPTIONS request first
    response = client.options(
        "/receipts/11111111-1111-1111-1111-111111111111/status",
        headers={
            "Origin": "http://localhost:5173",
            "Access-Control-Request-Method": "PUT",
            "Access-Control-Request-Headers": "content-type",
        },
    )

    # Then the preflight succeeds, echoes the allowed origin, and allows PUT
    assert response.status_code in (200, 204)
    assert response.headers.get("access-control-allow-origin") == "http://localhost:5173"
    assert "PUT" in response.headers.get("access-control-allow-methods", "")


def test_preflight_from_unlisted_origin_does_not_get_cors_header():
    # Given a preflight request from an origin that is not in CORS_ORIGINS
    # When it requests permission to send a PUT
    response = client.options(
        "/receipts/11111111-1111-1111-1111-111111111111",
        headers={
            "Origin": "http://evil.example.com",
            "Access-Control-Request-Method": "PUT",
        },
    )

    # Then no Access-Control-Allow-Origin header is returned
    assert "access-control-allow-origin" not in response.headers
