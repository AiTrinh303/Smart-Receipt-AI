from domain.rules import content_hash, is_valid_sha256_hex


def test_content_hash_known_vector():
    # Given the bytes b"abc"
    # Then its SHA-256 matches the well-known test vector
    assert content_hash(b"abc") == "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"


def test_content_hash_is_lowercase_64_char_hex():
    digest = content_hash(b"some receipt bytes")
    assert len(digest) == 64
    assert digest == digest.lower()
    assert all(c in "0123456789abcdef" for c in digest)


def test_content_hash_different_bytes_differ():
    assert content_hash(b"one") != content_hash(b"two")


def test_content_hash_empty_bytes_does_not_raise():
    digest = content_hash(b"")
    assert len(digest) == 64


def test_is_valid_sha256_hex_accepts_a_real_digest():
    assert is_valid_sha256_hex(content_hash(b"abc")) is True


def test_is_valid_sha256_hex_rejects_uppercase():
    assert is_valid_sha256_hex(content_hash(b"abc").upper()) is False


def test_is_valid_sha256_hex_rejects_short_value():
    assert is_valid_sha256_hex("a" * 63) is False


def test_is_valid_sha256_hex_rejects_non_hex_characters():
    assert is_valid_sha256_hex("g" * 64) is False


def test_is_valid_sha256_hex_rejects_empty_string():
    assert is_valid_sha256_hex("") is False
