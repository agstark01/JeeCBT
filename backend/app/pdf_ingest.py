from __future__ import annotations

import hashlib
from typing import Any

import fitz


MAX_PAGES = 400
PAGE_TEXT_EXCERPT_CHARS = 5000
MIN_TEXT_CHARS = 40


class PDFIngestionError(ValueError):
    """Raised when an uploaded document cannot be safely inspected."""


def inspect_pdf_bytes(data: bytes, filename: str, role: str = "unknown") -> dict[str, Any]:
    if not data.startswith(b"%PDF-"):
        raise PDFIngestionError(f"{filename}: file does not have a PDF signature")

    digest = hashlib.sha256(data).hexdigest()

    try:
        document = fitz.open(stream=data, filetype="pdf")
    except Exception as exc:
        raise PDFIngestionError(f"{filename}: could not open PDF ({exc})") from exc

    try:
        if document.needs_pass:
            raise PDFIngestionError(f"{filename}: password-protected PDFs are not supported yet")
        if document.page_count == 0:
            raise PDFIngestionError(f"{filename}: PDF contains no pages")
        if document.page_count > MAX_PAGES:
            raise PDFIngestionError(
                f"{filename}: has {document.page_count} pages; limit is {MAX_PAGES}"
            )

        pages: list[dict[str, Any]] = []
        for index, page in enumerate(document):
            text = page.get_text("text", sort=True).strip()
            image_count = len(page.get_images(full=True))
            pages.append(
                {
                    "page_number": index + 1,
                    "text": text,
                    "text_char_count": len(text),
                    "likely_scanned": len(text) < MIN_TEXT_CHARS,
                    "image_count": image_count,
                    "text_excerpt": text[:PAGE_TEXT_EXCERPT_CHARS],
                }
            )

        raw_metadata = document.metadata or {}
        metadata = {
            str(key): str(value)
            for key, value in raw_metadata.items()
            if value not in (None, "")
        }

        return {
            "filename": filename,
            "sha256": digest,
            "role": role,
            "page_count": document.page_count,
            "metadata": metadata,
            "pages": pages,
        }
    finally:
        document.close()
