# Document ingestion and answer-key discovery

## Input model

A paper package contains one or more PDF documents. A question paper is expected, but supporting documents are optional. Supporting documents can be an answer key, a solution booklet, an addendum, or an erratum.

The uploader may label document roles as hints. The labels are never used as the only discovery mechanism: every page of every uploaded PDF is scanned for answer-key material.

## Pipeline

1. Validate file signature, size, page count, password protection, and PDF readability.
2. Extract text per page while retaining filename, page number, document hash, metadata, image count, and text-extraction status.
3. Flag pages with little extractable text as likely image-based. These pages need OCR or manual inspection.
4. Scan all pages for strong answer-key headings.
5. Parse answer mappings only when the page matches a known layout. Preserve the original page text as evidence.
6. Match proposed answers to question identities after question segmentation.
7. Send candidates to a human review screen. Only reviewer-approved answer mappings can be published.

## Candidate status

- detected_needs_review: at least one answer-key candidate page was found.
- not_detected: no candidate was found in readable text. This is not proof that an answer key is absent.
- needs_ocr: no candidate was found and all inspected pages appear to have little extractable text.

The system must never silently convert not_detected into "key absent".

## Initial answer-key grammar

The first parser supports headings such as ANSWER KEY, ANSWER KEYS, OFFICIAL ANSWERS, and compact numbered pairs such as 1. (2) 2. (4) 3. (-2.7).

Answer values are preserved as strings. This is intentional: a response can be an option identifier, a multi-option response, an integer, a signed decimal, or another paper-specific value.

Other answer-key layouts are retained as candidate page evidence and should be added as separately tested parser adapters. Do not add a permissive regex that guesses answers from ordinary question text.

## Question identity and repeated numbering

A printed question number is not globally unique. The stable identity must include at least:

- examination and year/session;
- paper identifier (for example, Paper 1 or Paper 2);
- subject or section identifier;
- question number within that subject/section.

This prevents repeated labels such as Q.1 from colliding when a paper restarts numbering for another subject.

## Important constraints

- A solution is not automatically an answer key. It may contain an answer, but it must be classified separately and reviewed.
- The question PDF itself may contain the answer key after the final question.
- A separate key may contain no explicit heading; an uploader-provided role is a useful hint but still requires validation.
- Question parsing and answer-key discovery are separate stages.
- The ingestion service does not publish a paper and does not assign final answer truth. It only creates proposed extraction results.
