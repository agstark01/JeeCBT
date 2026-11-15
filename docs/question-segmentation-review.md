# Question segmentation and review

## Purpose

Convert an imported paper package into draft question records that can be checked and corrected locally before they are considered for the question bank.

The workflow runs entirely in the browser and saves its records inside the existing IndexedDB `PaperPackage`. Original PDFs remain as local Blobs. No PDF bytes or extracted question text are uploaded.

## Segmentation input and scope

- Documents labelled `question_paper` are segmented first.
- If a package has no `question_paper` role, documents labelled `unknown` are used as a fallback.
- Documents labelled `answer_key` or `solutions` are not segmented as question papers.
- The initial marker adapter recognizes line-start markers such as `Q.1`, `Q1.`, `Q. 1`, and `Question 1:`.
- Text after a marker is accumulated until the next marker or an end-of-paper marker. A question spanning multiple pages retains its start and end page numbers.
- Repeated numbering resets (for example, Q1 after Q18) create a new numbering block. The block is a structural hint, not a claim about the subject.
- Explicit standalone subject labels can be used. If no subject label is present, the subject remains `UNASSIGNED`; the parser does not infer subject order from JEE conventions.

The PDF importer stores normalized positioned text-line geometry and detects a likely page gutter. The reviewer renders the original PDF page locally and crops question and option regions from that rendered page, preserving diagrams, equations, tables, and typography. Crop boundaries still depend on detected question markers and option labels, so unusual layouts need validation.

## Review interface

The question reviewer provides:

- editable question number, subject, question type, and extracted text;
- source PDF filename and page provenance;
- an embedded local PDF preview at the question's first page;
- a visual question crop and a separate option-region crop rendered from the original PDF in the browser;
- bulk subject assignment by numbering block;
- block-level verification after subject and question-type classification, with explicit confirmation;
- bulk subject assignment by inclusive question-number range within a selected source PDF and optional block.

Question status is one of `needs_review`, `verified`, or `rejected`. Marking a question verified means the question text and metadata were reviewed. It does not verify its answer key or marking scheme.

Answer-key mappings are handled by the separate [answer-key review workflow](answer-key-review.md). That screen selects the key source PDF and target question-paper PDF, displays the original local key page, edits raw answer strings, resolves the exact question match, and verifies or rejects mappings independently of question text.

## Question identity and provenance

Every question retains:

- its containing `PaperPackage` identity;
- source document ID and filename;
- source page start and end;
- question number and numbering block;
- subject and optional section/paper label;
- visual crop regions in normalized page coordinates.

A question number alone is never a unique key. The containing package and source document distinguish repeated question numbers across different papers. Subject, paper, section, and block metadata help disambiguate numbering restarts within a paper. If multiple questions remain plausible, answer-key review requires an explicit selection rather than guessing.

## Question-type and marking-rule inference

The rule engine uses explicit question-level instructions, section headings, document-level rules, and question-number ranges. It retains the rule evidence and source page. More specific question-level instructions take precedence over broader rules. Conflicting or unsupported rules remain unknown and require manual review.

Option presence or A–D labels alone do not establish whether a question is single-correct or multiple-correct. The reviewer can correct the inferred type and marking values manually.

## Known limitations

- The marker parser does not cover every examination layout or arbitrary inline question markers.
- Scanned/image-only pages are flagged; OCR is not included.
- Mathematical notation is retained in the source PDF and extracted text; it is not normalized into MathML or LaTeX.
- Visual crops are generated on demand from the local PDF. Option crops depend on recognizable A–D or 1–4 option markers.
- Shared instructions before Q1 are not attached to a question; a warning prompts the reviewer to consult the source.
- Complex columns, floating diagrams, nested figures, and options continuing in unusual layouts may need manual inspection.
- The question reviewer does not verify answer-key mappings. Only the dedicated answer-key reviewer can verify a mapping.
- Scoring requires both verified question text and exactly one verified, package-scoped, supported answer mapping.

See [local-first browser architecture](local-first-browser-architecture.md) for IndexedDB storage and privacy boundaries, and [mixed-paper test builder and scoring](mixed-paper-test-builder.md) for scoring eligibility and current response-format limits.
