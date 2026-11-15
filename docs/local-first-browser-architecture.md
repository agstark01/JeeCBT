# Local-first browser architecture

## Decision

JeeCBT uses strict browser-local processing for personal practice. The web client is a static React application. It does not send user PDFs, extracted questions, answer keys, mapping decisions, test responses, or scores to the JeeCBT backend.

The Python/FastAPI PDF endpoint is retained as a development/reference implementation only. It is not called by the browser client and must not become the document-ingestion path for the local-first product.

## Processing and review flow

1. The user selects a question paper and any associated answer-key or solution PDFs using the browser File API.
2. PDF.js extracts selectable text and positioned text-line geometry in the browser.
3. The answer-key discovery adapters inspect every page and create proposed candidates and raw answer mappings. They do not mark extracted answers verified.
4. Question segmentation creates draft question records with source-document/page provenance, numbering blocks, and normalized crop regions.
5. The question reviewer renders the original PDF and question/option crops locally. The user corrects question text and metadata, then verifies or rejects the question independently of its key.
6. The answer-key reviewer selects the key source PDF and target question-paper PDF, previews the original key page, edits raw answer strings if needed, resolves the exact question relationship, and verifies or rejects each mapping.
7. The test builder reads the selected packages from IndexedDB and includes only questions with verified text and exactly one verified, package-scoped, supported answer mapping.
8. The exam runner evaluates the selected test locally. Submitted attempts and score snapshots are stored in IndexedDB.

No step uploads original PDF bytes or extracted exam content. Local visual crops are rendered on demand from retained PDF Blobs; rasterized crops are not sent to a server or committed to Git.

## IndexedDB data model

Dexie manages the `jeecbt-local` IndexedDB database.

### `paperPackages`

Each `PaperPackage` is the identity boundary for one imported paper set. It contains:

- original PDF Blobs and document metadata (filename, role, page count);
- extracted page text, page geometry, and positioned text lines;
- answer-key candidates and their individual raw answer mappings;
- source document IDs, source filenames, and source page numbers for each mapping;
- question drafts, subject/section/paper labels, numbering blocks, question/option crop regions, and inference evidence;
- independent question and answer-mapping review statuses;
- explicit question-to-answer links and segmentation warnings.

The source question paper and its key must be imported into the same package. The application does not resolve a key against questions in another package. Within a package, a candidate also has an explicit target question-paper document ID; source and target are separate because a key may be embedded in the paper or supplied as a separate PDF.

### `testAttempts`

Submitted attempts are stored separately with their owner namespace, selected package IDs, duration/elapsed time, per-question response and scoring results, correct raw answer, and source provenance. The current schema is version 2; version 2 added the submitted-attempt table without removing the version 1 paper-package store.

In-progress answers are held in application memory and are not written to IndexedDB until submission. Closing or reloading the page before submission loses the in-progress attempt.

## Local ownership and sign-in

IndexedDB records are namespaced by `ownerId`:

- `local` for guest mode;
- the verified Google OpenID Connect subject (`sub`) for an optional locally signed-in profile.

On first sign-in, guest packages and submitted attempts are reassigned to that local profile namespace in one IndexedDB transaction. This is a local database operation, not a cloud upload.

Google sign-in is a profile selector, not server-side authentication. The browser validates the Google ID token signature and its issuer, audience, and expiry. The verified profile fields are stored in localStorage so the local namespace can be selected after reload. No Google access token is retained.

The Google Identity Services script and public signing keys are loaded from Google when sign-in is used. This network traffic is unrelated to exam content: PDFs, extracted text, answer keys, attempts, and scores remain in the browser.

## Browser storage properties

- Data is specific to the browser profile and device.
- Clearing browser site data can delete IndexedDB and localStorage.
- Google sign-in alone does not synchronize or back up data across devices.
- Users can delete locally stored packages and attempts from the library.
- No Google Drive permission is requested in the current application. Any future backup must be a separate, explicit opt-in with a narrowly scoped permission and clear export/delete controls.

## Scoring eligibility boundary

A question is eligible only when all relevant checks pass:

1. It belongs to a selected `PaperPackage` and a known question-paper document.
2. Its subject and question type are assigned, and its question text/metadata are verified.
3. Exactly one answer mapping in that same package resolves to the exact question.
4. The mapping has consistent source-document, filename, and page provenance.
5. The mapping's raw answer is nonempty, supported for that question type, and independently verified.

A question marked verified does not verify its answer mapping. Proposed, rejected, missing, ambiguous, mismatched, unsupported, or otherwise unverified mappings are excluded from scoring. Question number alone is never a cross-document or cross-package key.

## Current browser capabilities

- Multi-PDF import and selectable-text extraction with PDF.js.
- Initial embedded numbered-key and subject-wise `Ques.` / `Ans.` table discovery.
- Marker-based question segmentation and on-demand visual question/option crops.
- Explicit question-type and marking-rule inference with retained evidence; conflicting or unsupported rules remain unclassified.
- Separate question-text and answer-key review workflows.
- Package-scoped answer reconciliation with source/target PDF selection and local page preview.
- Verified question/key eligibility, subject quotas, sampling without replacement, timed tests, scoring, results, and submitted-attempt history.

## Known limitations

- OCR for scanned/image-only pages is not implemented.
- The parser is heuristic and does not cover every PDF layout, inline question marker, shared instruction, multi-column arrangement, or floating diagram.
- Math/chemical notation and complex tables/diagrams are preserved in the source PDF but are not semantically normalized.
- Multiple-correct scoring currently requires an exact option set; JEE Advanced partial-credit marking schemes are not implemented.
- Numeric ranges, units, symbolic equivalence, and specialized response types are not supported.
- The countdown is browser-local and not tamper-proof.
- In-progress attempt autosave/recovery is not implemented.

## Backend policy

The hosted static web client must not configure a backend API origin for PDF, question, answer-key, response, or score data. Any future remote feature must be independently designed, explicitly disclosed, and separately opted into. It cannot silently replace local processing or IndexedDB as the default storage boundary.
