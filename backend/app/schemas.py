from typing import Literal

from pydantic import BaseModel, Field


DocumentRole = Literal["unknown", "question_paper", "answer_key", "solutions", "other"]


class PageInspection(BaseModel):
    page_number: int
    text_char_count: int
    likely_scanned: bool
    image_count: int
    text_excerpt: str = ""


class DocumentInspection(BaseModel):
    filename: str
    sha256: str
    role: DocumentRole = "unknown"
    page_count: int
    metadata: dict[str, str] = Field(default_factory=dict)
    pages: list[PageInspection]


class AnswerMapping(BaseModel):
    question_number: int
    answer_raw: str
    source_filename: str
    source_page: int
    review_status: Literal["proposed", "verified", "rejected"] = "proposed"


class AnswerKeyCandidate(BaseModel):
    source_filename: str
    source_page: int
    detection_reasons: list[str]
    extraction_method: str
    confidence: float = Field(ge=0.0, le=1.0)
    raw_excerpt: str
    mappings: list[AnswerMapping] = Field(default_factory=list)
    review_required: bool = True


class IngestionReport(BaseModel):
    exam_profile: str
    documents: list[DocumentInspection]
    answer_key_status: Literal["detected_needs_review", "not_detected", "needs_ocr"]
    answer_key_candidates: list[AnswerKeyCandidate] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)
    requires_human_review: bool = True
