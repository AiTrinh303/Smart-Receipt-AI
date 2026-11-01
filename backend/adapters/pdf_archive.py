"""Converts one saved receipt's original file into a single-page archive
PDF. The original file on disk is never modified -- this always reads it
and returns new bytes. Pillow is used here only (domain/ must never import
PIL; see backend/.importlinter)."""

import io
from pathlib import Path

from PIL import Image, ImageOps

# A small file cannot be crafted to decode into a huge image: this is
# checked against Image.open()'s header-only size BEFORE any pixel data is
# decoded, so a decompression-bomb-style file is rejected cheaply.
MAX_PIXELS = 60_000_000

# Receipts are tall and narrow photos, not forced to any fixed page size;
# this only ever shrinks an image, never enlarges one.
MAX_LONG_EDGE = 3000


class ArchiveError(Exception):
    """Raised when a receipt's original file could not be converted to an
    archive PDF (corrupt/truncated image, oversized image, unreadable
    file, or any other Pillow failure)."""


def prepare_image(img: Image.Image) -> Image.Image:
    """Applies EXIF orientation (so e.g. a phone photo taken sideways comes
    out upright, with width/height swapped when needed), flattens any
    transparency onto a white background, converts to plain RGB, and
    downscales only if the long edge exceeds MAX_LONG_EDGE (aspect ratio
    kept; never upscales a smaller image)."""
    img = ImageOps.exif_transpose(img)

    has_alpha = img.mode in ("RGBA", "LA") or (img.mode == "P" and "transparency" in img.info)
    if has_alpha:
        rgba = img.convert("RGBA")
        flattened = Image.new("RGB", rgba.size, (255, 255, 255))
        flattened.paste(rgba, mask=rgba.split()[-1])
        img = flattened
    else:
        img = img.convert("RGB")

    long_edge = max(img.size)
    if long_edge > MAX_LONG_EDGE:
        scale = MAX_LONG_EDGE / long_edge
        new_size = (max(1, round(img.width * scale)), max(1, round(img.height * scale)))
        img = img.resize(new_size, Image.LANCZOS)

    return img


def make_archive_pdf(path: Path) -> bytes:
    """Returns the bytes of a single-page PDF for the receipt file at
    `path`. A `.pdf` original is returned completely unchanged (no
    re-encoding). A `.jpg`/`.jpeg`/`.png` is opened with Pillow, rejected
    (before decoding any pixel data) if its reported width*height exceeds
    MAX_PIXELS, run through prepare_image, and saved as a PDF sized to the
    image itself -- no forced page size, and no EXIF or other metadata
    copied into the output. Raises ArchiveError (chaining the real cause)
    for any failure."""
    if path.suffix.lower() == ".pdf":
        try:
            return path.read_bytes()
        except OSError as exc:
            raise ArchiveError(f"Could not read original file: {path.name}") from exc

    try:
        with Image.open(path) as img:
            width, height = img.size
            if width * height > MAX_PIXELS:
                raise ArchiveError(
                    f"Image is too large to convert ({width}x{height} pixels, max {MAX_PIXELS})."
                )

            prepared = prepare_image(img)
            buffer = io.BytesIO()
            prepared.save(buffer, format="PDF")
            return buffer.getvalue()
    except ArchiveError:
        raise
    except Exception as exc:
        raise ArchiveError(f"Could not convert {path.name} to PDF.") from exc
