"""Shared by every test that calls the real upload endpoint: an apartment
is now required on upload, so this one helper avoids repeating
`data={"apartment_id": ...}` across every test file. Not named test_*.py
so pytest never tries to collect it as a test module."""

VALID_APARTMENT_ID = "oberaudorf-bergblick"
OTHER_APARTMENT_ID = "sankt-englmar-waldglueck"


def upload_with_apartment(client, files, apartment_id: str = VALID_APARTMENT_ID, **extra):
    return client.post(
        "/receipts/upload", files=files, data={"apartment_id": apartment_id}, **extra
    )
