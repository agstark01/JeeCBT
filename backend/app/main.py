from __future__ import annotations

import json
from typing import Annotated

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from starlette.concurrency import run_in_threadpool

from app.answer_discovery import discover_answer_key_candidates
from app.pdf_ingest import PDFIngestionError, inspect_pdf_bytes
from app.schemas import DocumentInspection, IngestionReport


MAX_DOCUMENTS = 10
MAX_FILE_BYTES = 25 * 1024 * 1024
ALLOWED_ROLES = {"unknown", "question_paper", "answer_key", "solutions", "other"}

app = FastAPI(
    title="JeeCBT API",
    version="0.1.0",
    description=(
        "Early document-ingestion API. It inspects every uploaded PDF for "
        "answer-key material, whether embedded or supplied separately."
    ),
)


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/api/v1/ingestion/inspect", response_model=IngestionReport)
async def inspect_documents(
    documents: Annotated[list[UploadFile], File(description="One or more PDF documents")],
    exam_profile: Annotated[str, Form()] = "generic",
    roles_json: Annotated[
        str | None,
        Form(description="Optional JSON array of roles aligned with documents"),
    ] = None,
) -> IngestionReport:
    if not documents:
        raise HTTPException(status_code=400, detail="Upload at least one PDF document")
    if len(documents) > MAX_DOCUMENTS:
        raise HTTPException(
            status_code=400, detail=f"At most {MAX_DOCUMENTS} documents may be uploaded at once"
        )

    roles: list[str] = ["unknown"] * len(documents)
    if roles_json:
        try:
            parsed_roles = json.loads(roles_json)
        except json.JSONDecodeError as exc:
            raise HTTPException(status_code=400, detail="roles_json must be a JSON array") from exc
        if not isinstance(parsed_roles, list) or len(parsed_roles) != len(documents):
            raise HTTPException(
                status_code=400,
                detail="roles_json must be an array with one role per uploaded document",
            )
        if any(role not in ALLOWED_ROLES for role in parsed_roles):
            raise HTTPException(
                status_code=400,
                detail=f"Roles must be one of: {', '.join(sorted(ALLOWED_ROLES))}",
            )
        roles = parsed_roles

    inspected: list[dict] = []
    warnings: list[str] = []

    for upload, role in zip(documents, roles):
        filename = upload.filename or "unnamed.pdf"
        try:
            payload = await upload.read(MAX_FILE_BYTES + 1)
            if len(payload) > MAX_FILE_BYTES:
                raise HTTPException(
                    status_code=413,
                    detail=f"{filename}: exceeds the {MAX_FILE_BYTES // (1024 * 1024)} MB file limit",
                )
            result = await run_in_threadpool(inspect_pdf_bytes, payload, filename, role)
        except PDFIngestionError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        finally:
            await upload.close()

        if any(page["likely_scanned"] for page in result["pages"]):
            warnings.append(
                f"{filename}: one or more pages contain little extractable text; "
                "they may require OCR or manual inspection."
            )
        inspected.append(result)

    candidates = discover_answer_key_candidates(inspected)
    any_pages_need_ocr = any(
        page["likely_scanned"]
        for document in inspected
        for page in document["pages"]
    )

    if candidates:
        status = "detected_needs_review"
    elif any_pages_need_ocr:
        status = "needs_ocr"
        warnings.append(
            "No answer-key candidate was detected and at least one page appears image-based. "
            "Inspect those pages with OCR or manually before concluding that a key is absent."
        )
    else:
        status = "not_detected"
        warnings.append(
            "No answer-key candidate was detected. This does not prove that a key is absent; "
            "it may use an unsupported layout or require manual inspection."
        )

    return IngestionReport(
        exam_profile=exam_profile,
        documents=[DocumentInspection(**document) for document in inspected],
        answer_key_status=status,
        answer_key_candidates=candidates,
        warnings=warnings,
        requires_human_review=True,
    )
