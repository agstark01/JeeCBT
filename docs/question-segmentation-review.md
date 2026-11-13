# Question segmentation and review

## Purpose

Convert an imported paper package into draft question records that can be checked and corrected locally before they are considered for the question bank.

The workflow runs entirely in the browser and saves the resulting records inside the existing IndexedDB `PaperPackage`. No PDF or extracted question text is uploaded.

## Segmentation input and scope

- Documents labelled `question_paper` are segmented first.
- If a package has no `question_paper` role, documents labelled `unknown` are used as a fallback.
- Documents labelled `answer_key` or `solutions` are never segmented as question papers.
- The initial marker adapter recognizes line-start markers such as `Q.1`, `Q1.`, `Q. 1`, and `Question 1:`.
- Text after a marker is accumulated until the next marker or an end-of-paper marker. A question spanning multiple pages retains its start and end page numbers.
- Repeated numbering resets (for example, Q1 after Q18) create a new numbering block. The block is a structural hint, not a claim about the subject.
- Explicit standalone subject labels can be used. If no subject label is present, the subject remains `UNASSIGNED`; the parser does not infer subject order from JEE conventions.

The PDF importer stores normalized positioned text-line geometry and detects a likely page gutter. The reviewer renders the original PDF page locally and crops question and option regions from that rendered page, preserving diagrams, equations, tables and typography. Crop boundaries still depend on detected question markers and option labels, so unusual layouts need validation.

## Review interface

The reviewer provides:

- editable question number, subject, question type and extracted text;
- source PDF filename and page provenance;
- an embedded local PDF preview at the question's first page;
- a full visual question crop and a separate option-region crop rendered from the original PDF locally in the browser;
- bulk subject assignment by numbering block;
- block-level verification after subject and question-type classification, with an explicit confirmation;
- bulk subject assignment by inclusive question-number range within a selected source PDF and optional block;
- a separate Answer-key review workflow that reconciles each mapping against its source and target paper, resolves ambiguity, and requires independent verification.

Question status is one of `needs_review`, `verified`, or `rejected`. Marking a question verified means the question text and metadata were reviewed. It does not mean the answer key was verified.

Answer-key mappings are reviewed in a separate screen. The reviewer chooses the answer-key source PDF and target question paper, inspects the key page, corrects raw answer text, selects the exact matching question, and verifies the mapping. A question and its answer mapping are independent verification gates; both must be verified before the question is eligible for a scored test.

## Provenance and identity

Every draft question retains:

- source paper package (through its containing record);
- source document ID and filename;
- source page start and end;
- question number;
- numbering block;
- subject and optional section/paper label.

A question number alone is never a unique key. The containing package and source document distinguish repeated Q1s across papers and papers with restarted subject numbering.

## Known limitations

- The marker parser does not cover every examination layout or arbitrary inline question markers.
- Scanned/image-only pages are flagged; OCR is not included.
- Mathematical notation is retained as extracted text only. It is not yet normalized into MathML/LaTeX.
- Visual question and option crops are generated on demand from the local PDF; raster crops are not sent to a server. Option crops depend on recognizable A–D or 1–4 option markers. Scanned/image-only pages do not yet have reliable marker geometry because OCR is not included.
- Shared instructions before Q1 are not attached to a question; a warning prompts the reviewer to consult the source.
- Subject detection is intentionally conservative. Use the block/range tools or per-question subject control where headings are absent. Explicit section headings with type descriptions, question-number ranges, and question-level instructions can infer question type and marking values. Question-level instructions take precedence; conflicting rules remain unknown. The parser does not infer single-vs-multiple choice from option labels alone.
- The question reviewer does not verify answer-key mappings. Use the dedicated answer-key reviewer for source/target selection and mapping verification.\n- The exam runner supports single choice, exact-set multiple choice, and numeric answers. It does not yet support JEE Advanced partial-credit rules, symbolic/range-based numeric acceptance, or all exam-specific response types.\n- The countdown is browser-local. In-progress responses are not yet persisted across page reloads; only submitted attempts are saved.

## Next prerequisites

1. Improve crop boundary detection for nested columns, floating diagrams, shared figures and options that continue across pages.
2. Add local OCR for scanned pages.
3. Extend section-rule inference to more publisher-specific wording while retaining explicit evidence and conflict handling.
4. Add an answer-key mapping reviewer with explicit verification and ambiguity handling.
5. Make mixed-paper question sampling depend only on reviewed question records and verified answer mappings.
