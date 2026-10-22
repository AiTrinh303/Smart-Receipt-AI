ALLOWED_EXTENSIONS = {".jpg", ".jpeg", ".png", ".pdf"}
ALLOWED_CONTENT_TYPES = {"image/jpeg", "image/png", "application/pdf"}
MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024  # 10 MB


class UnsupportedFileTypeError(Exception):
    """Raised when a file's extension or content type is not an allowed receipt type."""


class EmptyFileError(Exception):
    """Raised when an uploaded file has zero bytes."""


class FileTooLargeError(Exception):
    """Raised when an uploaded file exceeds the maximum allowed size."""


EXTENSION_MEDIA_TYPES = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".pdf": "application/pdf",
}


def media_type_for_extension(extension: str) -> str | None:
    """Maps a stored file's extension to a fixed, trusted media type -- never
    the client-supplied content_type and never sniffed from the file's
    contents, both of which a client could spoof."""
    return EXTENSION_MEDIA_TYPES.get(extension.lower())


def validate_upload(extension: str, content_type: str | None, size_bytes: int) -> None:
    if extension not in ALLOWED_EXTENSIONS or content_type not in ALLOWED_CONTENT_TYPES:
        raise UnsupportedFileTypeError(f"Unsupported file type: {extension}")

    if size_bytes == 0:
        raise EmptyFileError("Uploaded file is empty.")

    if size_bytes > MAX_FILE_SIZE_BYTES:
        raise FileTooLargeError(f"File size {size_bytes} exceeds the maximum of {MAX_FILE_SIZE_BYTES} bytes.")
