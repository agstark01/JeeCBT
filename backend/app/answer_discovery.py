from __future__ import annotations

import re
from typing import Any


ANSWER_HEADING_RE = re.compile(
    r"(?im)^\s*(?:(?:OFFICIAL|FINAL|PROVISIONAL|REVISED)\s+)?"
    r"(?:ANSWER\s+KEYS?|CORRECT\s+ANSWERS?|KEY\s+TO\s+(?:THE\s+)?QUESTIONS)"
    r"(?:\s*[:\-].*)?\s*$"
)

# Supports compact keys such as: 1. (2)  2. (4)  3. (-2.7).
# Values stay strings because keys can mix options, integers and decimals.
PARENTHESIZED_MAPPING_RE = re.compile(
    r"(?<![A-Za-z0-9.])(?P<number>\d{1,3})\s*[.)]\s*"
    r"\(\s*(?P<answer>[^()\n]{1,32}?)\s*\)"
)

SUBJECT_HEADING_RE = re.compile(
    r"(?i)^\s*(?P<paper>PAPER[\s-]*\d+)\s+"
    r"(?P<subject>PHYSICS|CHEMISTRY|MATHS|MATHEMATICS)\s*$"
)
QUESTION_ROW_RE = re.compile(r"(?i)^\s*Ques?\.?\s+(?P<values>.+?)\s*$")
ANSWER_ROW_RE = re.compile(r"(?i)^\s*Ans?\.?\s+(?P<values>.+?)\s*$")


def parse_parenthesized_mappings(
    text: str, filename: str, page_number: int
) -> list[dict[str, Any]]:
    mappings: list[dict[str, Any]] = []
    for match in PARENTHESIZED_MAPPING_RE.finditer(text):
        answer = " ".join(match.group("answer").split()).strip()
        if not answer:
            continue
        mappings.append(
            {
                "question_number": int(match.group("number")),
                "answer_raw": answer,
                "source_filename": filename,
                "source_page": page_number,
                "review_status": "proposed",
            }
        )
    return mappings


def _parse_row_values(value: str) -> list[str]:
    return [token.strip() for token in re.split(r"\s+", value.strip()) if token.strip()]


def parse_subject_table_candidates(
    text: str, filename: str, page_number: int
) -> list[dict[str, Any]]:
    """Parse subject-wise Ques./Ans. table pairs from a PDF text page.

    Each candidate is scoped to a subject and paper label. Answer values are
    preserved verbatim as strings; e.g. 'BC', 'ABD', '25.6', or '0.11'.
    """
    candidates: list[dict[str, Any]] = []
    current: dict[str, Any] | None = None
    pending_questions: list[int] | None = None

    def finish_section() -> None:
        nonlocal current, pending_questions
        if current is not None and current["mappings"]:
            candidates.append(current)
        current = None
        pending_questions = None

    for line in text.splitlines():
        heading = SUBJECT_HEADING_RE.match(line)
        if heading:
            finish_section()
            current = {
                "source_filename": filename,
                "source_page": page_number,
                "detection_reasons": ["subject_wise_question_answer_table"],
                "extraction_method": "subject_table_ques_ans_row_pairs",
                "confidence": 0.96,
                "raw_excerpt": "",
                "subject": heading.group("subject").upper(),
                "paper_label": re.sub(r"\s+", "-", heading.group("paper").upper()),
                "mappings": [],
                "review_required": True,
            }
            continue

        if current is None:
            continue

        question_row = QUESTION_ROW_RE.match(line)
        if question_row:
            tokens = _parse_row_values(question_row.group("values"))
            if tokens and all(token.isdigit() for token in tokens):
                pending_questions = [int(token) for token in tokens]
            else:
                pending_questions = None
            continue

        answer_row = ANSWER_ROW_RE.match(line)
        if answer_row and pending_questions is not None:
            answers = _parse_row_values(answer_row.group("values"))
            if len(answers) == len(pending_questions):
                for question_number, answer_raw in zip(pending_questions, answers):
                    current["mappings"].append(
                        {
                            "question_number": question_number,
                            "answer_raw": answer_raw,
                            "source_filename": filename,
                            "source_page": page_number,
                            "subject": current["subject"],
                            "paper_label": current["paper_label"],
                            "review_status": "proposed",
                        }
                    )
            else:
                # Keep a warning-like evidence excerpt rather than pairing
                # values when the number of question/answer cells differs.
                current["raw_excerpt"] += (
                    f"\nUnmatched row pair: {line}\n"
                    f"Expected {len(pending_questions)} answers, found {len(answers)}."
                )
            pending_questions = None

    finish_section()

    for candidate in candidates:
        candidate["raw_excerpt"] = candidate["raw_excerpt"] or (
            f"{candidate['paper_label']} {candidate['subject']} "
            f"table detected on page {page_number}."
        )
    return candidates


def discover_answer_key_candidates(
    documents: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    candidates: list[dict[str, Any]] = []

    for document in documents:
        role = document.get("role", "unknown")
        for page in document.get("pages", []):
            text = page.get("text", "") or ""
            if not text.strip():
                continue

            # Prefer the more specific subject-table adapter. It yields one
            # candidate per subject section, retaining the repeated Q1..Qn IDs.
            table_candidates = parse_subject_table_candidates(
                text, document["filename"], page["page_number"]
            )
            if table_candidates:
                candidates.extend(table_candidates)
                continue

            heading_matches = list(ANSWER_HEADING_RE.finditer(text))
            has_heading = bool(heading_matches)
            role_hint = role == "answer_key"

            # Inspect all pages of all documents. The role is only a hint.
            if not has_heading and not role_hint:
                continue

            if has_heading:
                key_text = text[heading_matches[0].end():]
                reasons = ["answer_key_heading"]
            else:
                key_text = text
                reasons = []

            if role_hint:
                reasons.append("uploader_role_hint")

            mappings = parse_parenthesized_mappings(
                key_text, document["filename"], page["page_number"]
            )

            if len(mappings) >= 3 and has_heading:
                confidence = 0.98
            elif len(mappings) >= 3 and role_hint:
                confidence = 0.82
            elif has_heading:
                confidence = 0.68
            else:
                confidence = 0.55

            candidates.append(
                {
                    "source_filename": document["filename"],
                    "source_page": page["page_number"],
                    "detection_reasons": reasons,
                    "extraction_method": (
                        "heading_and_parenthesized_numbered_pairs"
                        if has_heading
                        else "role_hint_and_parenthesized_numbered_pairs"
                    ),
                    "confidence": confidence,
                    "raw_excerpt": key_text[:5000],
                    "mappings": mappings,
                    "review_required": True,
                }
            )

    return candidates
