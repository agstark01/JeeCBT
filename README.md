# JeeCBT

JeeCBT is an open-source, local-first JEE Main and JEE Advanced practice examination platform. Import a question paper and its answer key, review the extracted questions and answers, build a timed test, and inspect the resulting score without uploading exam content to a JeeCBT server.

**Privacy model:** original PDFs, extracted paper content, question records, answer mappings, review state, and submitted attempts are stored in the browser's IndexedDB database. GitHub contains application source, documentation, and synthetic tests only.

## Current implementation

The static browser application is in `web/` and uses React, TypeScript, Vite, PDF.js, and Dexie.

- PDF text and positioned line geometry are extracted locally in the browser.
- Original PDF Blobs, extracted pages, question drafts, answer-key candidates, mapping provenance, verification state, and question-to-answer links are stored in IndexedDB.
- The initial answer-key adapters recognize numbered parenthesized answer lists and subject-wise `Ques.` / `Ans.` tables. Extracted answers remain raw strings and start as proposals.
- Question segmentation recognizes common line-start markers and creates source-page-aware drafts. The question reviewer displays local visual question and option crops rendered from the original PDF.
- Question-type and marking-rule inference uses explicit question, section, and question-range instructions. Evidence is retained; conflicting or unsupported rules remain unclassified.
- The answer-key reviewer lets the user choose the source key PDF and target question-paper PDF, inspect the original key page, edit raw answers, reconcile mappings, resolve ambiguity, and independently verify or reject each mapping.
- Reconciliation is confined to the containing `PaperPackage` and selected question-paper document. It uses question number plus available subject, paper, section, and numbering-block metadata; a question number alone is never a global key.
- The test builder selects only questions with verified text and exactly one verified, package-scoped, supported answer mapping. It reports subject-pool shortfalls and samples without replacement.
- The browser CBT runner supports single choice, exact-set multiple choice, and numerical responses. Submitted attempts and score details are saved in IndexedDB.

## Typical workflow

1. Import the question paper and its answer-key PDF(s) together as one paper package.
2. Segment the question paper and inspect each question against its local PDF preview/crop. Correct its text, subject, type, and marking metadata, then verify the question.
3. Open answer-key review. Confirm the source PDF and target question paper, inspect the key page, correct any raw answer, resolve the exact question match, then verify or reject the mapping.
4. Configure subject quotas, duration, shuffle preference, and fallback marks. Only fully verified question/key pairs count toward the available pool.
5. Attempt the timed test and review the score and question-wise answer comparison.

Question-text verification and answer-key verification are independent gates. Neither one implies the other. Proposed, rejected, missing, ambiguous, mismatched, unsupported, or otherwise unverified mappings are excluded from scoring.

## Supported scoring and limitations

- **Single choice:** one option label must match.
- **Multiple correct:** the complete option set must match; option order is ignored.
- **Numerical:** parsed numeric values are compared using a small floating-point tolerance.
- Question-specific positive/negative marks take precedence over configurable test defaults (initially +4 / -1).

Current limitations:

- Scanned/image-only PDFs need OCR; local OCR is not implemented.
- Question segmentation and visual crop boundaries are marker/layout heuristics, not a universal PDF parser. Complex columns, shared diagrams/instructions, and unusual option layouts need manual source-page review.
- JEE Advanced partial-credit schemes for multiple-correct questions are not implemented; multiple-correct scoring uses exact-set matching.
- Numeric ranges, units, symbolic equivalence, matrix-match, integer-grid, and other specialized answer formats are not supported.
- In-progress test responses are held in memory and are lost if the page reloads before submission. Only submitted attempts are persisted.
- The countdown is browser-local and is not proctored or tamper-proof.
- Google sign-in only selects a local IndexedDB namespace. It does not synchronize or back up papers or attempts. Google Drive backup is not implemented.

## Run locally

Requirements: Node.js 22.12+ and npm.

```bash
cd web
cp .env.example .env.local
npm install
npm run dev
```

Validation scripts:

```bash
npm run typecheck
npm test
npm audit
npm run build
```

The Python/FastAPI backend is a development/reference parser and synthetic-test environment. The browser client does not use its PDF-upload endpoint.

## Data boundaries

JeeCBT must never commit or upload user-provided question papers, answer keys, extracted real questions, answer mappings, responses, scores, credentials, or personal data. Do not add real exam material to fixtures. Tests must use synthetic records or fixtures explicitly licensed for redistribution.

IndexedDB is local to the browser profile and device. Clearing browser site data can delete it. Google sign-in does not provide cloud backup or synchronization. The current app stores submitted attempts locally; it does not persist an in-progress attempt across reloads.

## Documentation

- [Local-first browser architecture](docs/local-first-browser-architecture.md)
- [Question segmentation and review](docs/question-segmentation-review.md)
- [Answer-key review and reconciliation](docs/answer-key-review.md)
- [Mixed-paper test builder and scoring](docs/mixed-paper-test-builder.md)
- [Product architecture](docs/product-architecture.md)
- [Web client setup and workflow](web/README.md)

## Development roadmap

- [x] Multi-PDF local import and PDF.js text extraction
- [x] Initial embedded and separate answer-key discovery
- [x] IndexedDB paper-package storage and library
- [x] Marker-based question segmentation and local question review
- [x] Visual question and option crops rendered from original PDFs
- [x] Explicit section/range/question-instruction inference
- [x] Independent answer-key review and package-scoped question reconciliation
- [x] Verified question/key eligibility, subject quotas, and sampling without replacement
- [x] Local timed CBT runner, scoring, results, and submitted-attempt history
- [ ] Local OCR for scanned PDFs
- [ ] More robust parsing for publisher-specific layouts, shared instructions, equations, tables, and complex diagrams
- [ ] JEE Advanced partial-credit and additional exam-specific scoring schemes
- [ ] Numeric range, unit-aware, symbolic, and specialized response formats
- [ ] In-progress attempt autosave and reload recovery
- [ ] Optional, separately consented backup/export and cross-device synchronization

## Contributing

Open an issue before large architectural changes. Do not commit copyrighted exam papers, answer keys, solutions, or diagrams unless redistribution is explicitly permitted. Keep all user exam content local by default.

## License

The application source code is intended to use the MIT License. This does not grant rights to third-party question papers, answer keys, diagrams, or other uploaded content.
