# Answer-key review and question reconciliation

## Scope and trust model

Answer-key extraction is a proposal, not authoritative data. Every imported key candidate and mapping starts in `proposed` state. A user must inspect the retained source PDF, resolve the target paper and question, and explicitly verify or reject the mapping.

The containing `PaperPackage` is the hard source boundary. A key from one package is never matched against questions in another package. A separate key PDF is associated with a question-paper document using the candidate's `targetDocumentId`; the source key document and target question document are distinct identities.

Question-text verification and answer-key verification are independent. A question marked `verified` does not verify its answer. A verified key mapping does not verify the question text.

## Local data model

The browser stores the following data as part of the Dexie `paperPackages` table in IndexedDB:

- `ExtractedDocument`: original PDF Blob, filename, role, page count, and extracted page text/geometry;
- `AnswerKeyCandidate`: candidate ID, source document ID, source filename/page, optional subject/paper/section context, extraction evidence, raw excerpt, and mappings;
- `AnswerMapping`: question number, exact `answerRaw` string, source document ID, source filename/page, optional subject/paper/section/block metadata, review status, and optional linked question ID;
- `QuestionDraft`: question number, subject, block/section/paper identity, source document/page range, question review status, and optional answer reference.

Raw answer strings are not coerced into a single-choice enum. Values such as `A`, `BC`, `ABD`, `25.6`, and `-2.7` remain strings through extraction and editing. The scoring layer interprets a verified raw string only after the linked question type is known.

## Reviewer workflow

1. Import the question paper and all associated answer-key/solution PDFs in one package.
2. Segment the question paper and review its question text, subject, type, marks, and local visual crop. Verify usable questions independently.
3. Open answer-key review for that package.
4. For each candidate, select the PDF containing the key entry and the question-paper PDF it describes. The original key PDF is previewed at the candidate's source page using the locally retained Blob.
5. Inspect each mapping's raw answer, question number, subject, paper/section context, and source filename/page. Edit the raw string if extraction was incorrect.
6. Inspect the reconciliation result. Select the exact question when multiple candidates remain. A mapping with missing, mismatched, or ambiguous identity cannot be verified.
7. Verify or reject each mapping, then save the review to IndexedDB.

Changing the source PDF updates the candidate and mapping filenames/document IDs together, clears stale question links, and returns affected mappings to `proposed`. Changing the target question paper also clears question links and returns mappings to `proposed`.

The **Verify all unambiguous** action is deliberately constrained: it only proposes verification for mappings that have source provenance, a unique question match, a supported answer format, and no competing mapping to the same question. Ambiguous or unsupported rows remain for manual resolution.

## Reconciliation contract

A mapping is reconciled only against questions in the supplied `PaperPackage` and the candidate's selected target question-paper document. The matcher uses:

1. target question-paper document ID;
2. question number;
3. subject, when available;
4. paper label and section label, when available;
5. numbering block, when supplied.

A saved `linkedQuestionId` is revalidated against the same target document and available identity metadata; it is not accepted solely because the ID exists.

The matcher reports one of four states:

- **matched** — exactly one question satisfies the available identity constraints, or a saved explicit link is still valid;
- **ambiguous** — more than one question remains plausible, or the target question paper has not been selected;
- **mismatched** — the number exists but subject/section/paper/block context conflicts, the saved link is stale, or the number appears only in another source document;
- **missing** — no question with that number exists in the selected source paper or package.

Optional metadata is not fabricated. If block or section information is absent, the matcher cannot use it to distinguish questions; multiple remaining candidates are shown as ambiguous and require an explicit choice. A unique auto-suggestion is still only a proposal until the reviewer verifies it.

## Provenance and verification gates

Every mapping retains its source filename and page number plus a source document ID when resolvable. The reviewer exposes the corresponding local PDF page. Verification requires:

- a nonempty raw answer and positive question number;
- a retained source document belonging to the package;
- candidate and mapping source document IDs and filenames consistent with that document;
- the candidate and mapping source page numbers present in that document;
- a matched target question;
- a raw answer supported by the selected question type;
- no competing supported mapping to the same question.

A mapping can be rejected or reopened as proposed. Editing the raw answer invalidates previous verification. Changing its source or target invalidates previous approval and links.

## Scoring eligibility

A question enters the eligible pool only when its text/metadata status is `verified`, its subject and question type are assigned, and exactly one mapping in the same package resolves to it with `verified` mapping status. The answer format must also be supported by the current scorer.

- Single-choice keys require one option label.
- Multiple-correct keys preserve the complete option set and use exact-set comparison (order-independent).
- Numerical keys remain raw strings and are parsed by the scorer for numeric comparison with a small floating-point tolerance.

Proposed, rejected, missing, ambiguous, mismatched, unsupported, or otherwise unverified mappings are excluded. Duplicate verified mappings to the same question make that question ineligible.

## Data handling

PDF parsing, answer discovery, question matching, source-page preview, review state, and scoring run in the browser. Original PDF Blobs, extracted text, raw keys, provenance, links, and statuses are saved in Dexie/IndexedDB. The browser client does not call the FastAPI PDF-upload endpoint.

Do not commit real exam PDFs, extracted real questions, answer keys, mappings, student responses, or scores. Repository fixtures must be synthetic or explicitly licensed for redistribution.

## Current extraction and scoring limitations

- Initial extraction supports numbered parenthesized answer pairs and subject-wise `Ques.` / `Ans.` tables; arbitrary publisher-specific formats may be missed or misread.
- Scanned/image-only key pages require OCR, which is not implemented.
- The matcher depends on the metadata present in the extracted paper. Incorrect or missing subject/section/block labels can leave a mapping ambiguous; the source PDF remains the review authority.
- Multiple-correct scoring currently requires an exact option set. JEE Advanced partial-credit marking schemes are not implemented.
- Numeric ranges, units, symbolic equivalence, matrix-match, integer-grid, and other specialized answer types are not supported.
- The local browser countdown is not tamper-proof. In-progress test answers are not persisted until submission.
