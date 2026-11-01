import io

import pytest
from PIL import Image

import adapters.pdf_archive as pdf_archive
from adapters.pdf_archive import ArchiveError, make_archive_pdf, prepare_image


def save_png(path, size=(100, 100), color=(255, 0, 0), mode="RGB", exif=None):
    img = Image.new(mode, size, color)
    if exif is not None:
        img.save(path, format="PNG", exif=exif)
    else:
        img.save(path, format="PNG")
    return path


def save_jpeg(path, size=(100, 100), color=(0, 255, 0), exif=None):
    img = Image.new("RGB", size, color)
    if exif is not None:
        img.save(path, format="JPEG", exif=exif)
    else:
        img.save(path, format="JPEG")
    return path


# --- prepare_image -----------------------------------------------------


def test_orientation_tag_6_swaps_dimensions():
    # Given a landscape image whose EXIF orientation says "rotate 90 CW"
    img = Image.new("RGB", (100, 200), (10, 20, 30))
    exif = img.getexif()
    exif[0x0112] = 6  # Orientation
    buf = io.BytesIO()
    img.save(buf, format="JPEG", exif=exif)
    buf.seek(0)
    loaded = Image.open(buf)
    assert loaded.size == (100, 200)

    # When it is prepared
    prepared = prepare_image(loaded)

    # Then the dimensions are swapped (now upright)
    assert prepared.size == (200, 100)


def test_rgba_image_becomes_rgb():
    # Given an image with transparency
    img = Image.new("RGBA", (50, 50), (0, 0, 0, 0))

    # When it is prepared
    prepared = prepare_image(img)

    # Then it is a plain RGB image (flattened onto white)
    assert prepared.mode == "RGB"


def test_a_4000px_image_is_downscaled_to_3000():
    # Given an image whose long edge is 4000px
    img = Image.new("RGB", (4000, 2000))

    # When it is prepared
    prepared = prepare_image(img)

    # Then the long edge is downscaled to exactly 3000, aspect ratio kept
    assert prepared.size == (3000, 1500)


def test_a_small_image_is_not_upscaled():
    # Given a small image
    img = Image.new("RGB", (100, 50))

    # When it is prepared
    prepared = prepare_image(img)

    # Then its size is unchanged
    assert prepared.size == (100, 50)


# --- make_archive_pdf ----------------------------------------------------


def test_pdf_original_is_returned_unchanged(tmp_path):
    # Given a .pdf "original" (fake bytes are fine -- the pdf branch never parses it)
    original_bytes = b"%PDF-1.4 fake but good enough for tests"
    path = tmp_path / "receipt.pdf"
    path.write_bytes(original_bytes)

    # When it is converted
    result = make_archive_pdf(path)

    # Then the exact original bytes come back
    assert result == original_bytes


def test_png_is_converted_to_a_pdf(tmp_path):
    # Given a PNG receipt
    path = tmp_path / "receipt.png"
    save_png(path)

    # When it is converted
    result = make_archive_pdf(path)

    # Then the result is a PDF
    assert result.startswith(b"%PDF-")


def test_jpg_is_converted_to_a_pdf(tmp_path):
    # Given a JPG receipt
    path = tmp_path / "receipt.jpg"
    save_jpeg(path)

    # When it is converted
    result = make_archive_pdf(path)

    # Then the result is a PDF
    assert result.startswith(b"%PDF-")


def test_oversized_image_is_rejected_before_decoding(tmp_path, monkeypatch):
    # Given MAX_PIXELS set artificially low, and an image that exceeds it
    monkeypatch.setattr(pdf_archive, "MAX_PIXELS", 100)
    path = tmp_path / "receipt.png"
    save_png(path, size=(200, 200))

    # When it is converted
    # Then it raises ArchiveError rather than decoding the image
    with pytest.raises(ArchiveError):
        make_archive_pdf(path)


def test_corrupt_png_raises_archive_error_with_no_internal_text(tmp_path):
    # Given a file that claims to be a PNG but isn't valid image data
    path = tmp_path / "receipt.png"
    path.write_bytes(b"not a real png, just garbage bytes")

    # When it is converted
    # Then ArchiveError is raised (the route maps this to a generic 422)
    with pytest.raises(ArchiveError):
        make_archive_pdf(path)


def test_truncated_jpeg_raises_archive_error(tmp_path):
    # Given a JPEG file truncated partway through
    full_path = tmp_path / "full.jpg"
    save_jpeg(full_path)
    truncated_bytes = full_path.read_bytes()[: len(full_path.read_bytes()) // 2]
    path = tmp_path / "receipt.jpg"
    path.write_bytes(truncated_bytes)

    with pytest.raises(ArchiveError):
        make_archive_pdf(path)


def test_converting_does_not_modify_the_original_file_on_disk(tmp_path):
    import hashlib

    # Given a PNG receipt
    path = tmp_path / "receipt.png"
    save_png(path)
    before_hash = hashlib.sha256(path.read_bytes()).hexdigest()

    # When it is converted
    make_archive_pdf(path)

    # Then the original file is byte-for-byte unchanged
    after_hash = hashlib.sha256(path.read_bytes()).hexdigest()
    assert after_hash == before_hash
