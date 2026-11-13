import fitz
from fastapi.testclient import TestClient

from app.answer_discovery import discover_answer_key_candidates
from app.main import app
from app.pdf_ingest import inspect_pdf_bytes


def make_pdf(*pages: str) -> bytes:
    document = fitz.open()
    for page_text in pages:
        page = document.new_page()
        if page_text:
            page.insert_text((48, 60), page_text)
    payload = document.tobytes()
    document.close()
    return payload


def test_detects_answer_key_embedded_in_question_pdf() -> None:
    pdf = make_pdf(
        "Q.1 Choose the correct option.\n(A) one (B) two (C) three (D) four",
        "ANSWER KEYS\n1. (2) 2. (4) 3. (1) 4. (-2.7) 5. (10.6)",
    )
    document = inspect_pdf_bytes(pdf, "main-paper.pdf", "question_paper")

    candidates = discover_answer_key_candidates([document])

    assert len(candidates) == 1
    assert candidates[0]["source_page"] == 2
    assert [item["answer_raw"] for item in candidates[0]["mappings"]] == [
        "2", "4", "1", "-2.7", "10.6"
    ]
    assert all(item["review_status"] == "proposed" for item in candidates[0]["mappings"])


def test_does_not_claim_key_absent_when_question_pdf_has_no_key() -> None:
    pdf = make_pdf(
        "JEE Advanced Paper 1\nQ.1 Select all correct options.\n(A) option A (B) option B"
    )
    document = inspect_pdf_bytes(pdf, "advanced-paper.pdf", "question_paper")

    assert discover_answer_key_candidates([document]) == []


def test_scans_separate_answer_key_document_even_without_heading() -> None:
    question_pdf = make_pdf("Question paper: Q.1 ...")
    key_pdf = make_pdf("1. (A) 2. (C) 3. (B) 4. (D)")

    question_doc = inspect_pdf_bytes(question_pdf, "paper.pdf", "question_paper")
    key_doc = inspect_pdf_bytes(key_pdf, "key.pdf", "answer_key")

    candidates = discover_answer_key_candidates([question_doc, key_doc])

    assert len(candidates) == 1
    assert candidates[0]["source_filename"] == "key.pdf"
    assert "uploader_role_hint" in candidates[0]["detection_reasons"]
    assert len(candidates[0]["mappings"]) == 4


def test_question_numbering_can_repeat_across_documents() -> None:
    first = inspect_pdf_bytes(
        make_pdf("ANSWER KEY\n1. (A) 2. (B) 3. (C)"),
        "physics-key.pdf",
        "answer_key",
    )
    second = inspect_pdf_bytes(
        make_pdf("ANSWER KEY\n1. (D) 2. (C) 3. (B)"),
        "chemistry-key.pdf",
        "answer_key",
    )

    candidates = discover_answer_key_candidates([first, second])

    assert len(candidates) == 2
    assert candidates[0]["source_filename"] != candidates[1]["source_filename"]
    assert candidates[0]["mappings"][0]["question_number"] == 1
    assert candidates[1]["mappings"][0]["question_number"] == 1


def test_scanned_page_requests_ocr_even_when_other_pages_have_text() -> None:
    client = TestClient(app)
    mixed_pdf = make_pdf(
        "This is a readable page with enough selectable text to be extracted.",
        "",
    )
    response = client.post(
        "/api/v1/ingestion/inspect",
        data={"exam_profile": "jee_advanced"},
        files=[("documents", ("mixed-paper.pdf", mixed_pdf, "application/pdf"))],
    )

    assert response.status_code == 200
    assert response.json()["answer_key_status"] == "needs_ocr"


def test_parses_subject_wise_question_answer_tables() -> None:
    table = """PAPER-1 PHYSICS
Ques. 1 2 3 4
Ans. A BC 25.6 -0.4
Ques. 5 6 7 8
Ans. BCD 0.62 6.4 1
PAPER-1 CHEMISTRY
Ques. 1 2 3 4
Ans. B B A C
Ques. 5 6 7 8
Ans. D C ABC 0.11
PAPER-1 MATHS
Ques. 1 2 3 4
Ans. D C A A
Ques. 5 6 7 8
Ans. B C AC 108
"""
    document = inspect_pdf_bytes(make_pdf(table), "answer-table.pdf", "unknown")

    candidates = discover_answer_key_candidates([document])

    assert [candidate["subject"] for candidate in candidates] == [
        "PHYSICS", "CHEMISTRY", "MATHS"
    ]
    assert all(len(candidate["mappings"]) == 8 for candidate in candidates)
    assert candidates[0]["mappings"][1]["answer_raw"] == "BC"
    assert candidates[0]["mappings"][2]["answer_raw"] == "25.6"
    assert candidates[0]["mappings"][3]["answer_raw"] == "-0.4"
    assert candidates[1]["mappings"][6]["answer_raw"] == "ABC"
    assert candidates[0]["mappings"][0]["question_number"] == 1
    assert candidates[1]["mappings"][0]["question_number"] == 1
    assert candidates[0]["mappings"][0]["subject"] == "PHYSICS"
    assert candidates[1]["mappings"][0]["subject"] == "CHEMISTRY"
    assert candidates[0]["extraction_method"] == "subject_table_ques_ans_row_pairs"
