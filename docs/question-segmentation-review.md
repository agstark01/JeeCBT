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

The current PDF text reconstruction detects a likely page gutter and emits the left column before the right column. It remains a heuristic and should be checked against actual PDFs that use complex tables, equations, or unusual layouts.

## Review interface

The reviewer provides:

- editable question number, subject, question type and extracted text;
- source PDF filename and page provenance;
- an embedded local PDF preview at the question's first page;
- bulk subject assignment by numbering block;
- bulk subject assignment by inclusive question-number range within a selected source PDF and optional block;
- optional linking to an answer-key candidate mapping with the same question number.

Question status is one of `needs_review`, `verified`, or `rejected`. Marking a question verified means the question text and metadata were reviewed. It does not mean the answer key was verified.

Answer-key mappings are still proposals in this milestone. The reviewer can attach an exact candidate/mapping reference, but it does not promote the mapping to verified. Question scoring must remain disabled until answer-key review and question-to-answer validation are implemented.

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
- Diagrams, figures, tables and multi-page visual regions are not cropped into standalone question assets. The original PDF and page references remain available for review.
- Shared instructions before Q1 are not attached to a question; a warning prompts the reviewer to consult the source.
- Subject detection is intentionally conservative. Use the block/range tools or per-question subject control where headings are absent.
- The current question review state does not verify answer-key mappings or marking schemes.

## Next prerequisites

1. Add richer page geometry and layout-aware segmentation for multi-column text, diagrams and tables.
2. Add local OCR for scanned pages.
3. Extract and preserve question figures and shared section instructions.
4. Add an answer-key mapping reviewer with explicit verification and ambiguity handling.
5. Make mixed-paper question sampling depend only on reviewed question records and verified answer mappings.
