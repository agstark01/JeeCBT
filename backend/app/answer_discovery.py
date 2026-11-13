from __future__ import annotations

import re
from typing import Any


ANSWER_HEADING_RE = re.compile(
    r"(?im)^\s*(?:(?:OFFICIAL|FINAL|PROVISIONAL|REVISED)\s+)?"
    r"(?:ANSWER\s+KEYS?|CORRECT\s+ANSWERS?|KEY\s+TO\s+(?:THE\s+)?QUESTIONS)"
    r"\s*:?\s*$"
)

# Supports compact keys such as: 1. (2)  2. (4)  3. (-2.7).
# Values stay strings because keys can mix options, integers and decimals.
PARENTHESIZED_MAPPING_RE = re.compile(
    r"(?<![A-Za-z0-9.])(?P<number>\d{1,3})\s*[.)]\s*"
    r"\(\s*(?P<answer>[^()\n]{1,32}?)\s*\)"
)


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
