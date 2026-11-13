# JeeCBT

JeeCBT is an open-source, local-first JEE Main and JEE Advanced practice examination platform.

The goal is to let a student import a previous-year question paper and its answer key (embedded in the same PDF or supplied separately), prepare a structured question bank, configure a timed test, attempt it in a computer-based examination interface, and receive an immediate result.

**Privacy model:** source PDFs, extracted questions, answer keys, attempts, and scores remain in the user's browser. GitHub contains application source code and documentation only.

## Product direction

- Generic document ingestion, not a hard-coded PDF format for each exam.
- Scan every page of every selected document for answer keys.
- Support answer keys embedded in the question paper and separate answer-key PDFs.
- Preserve subject, paper/section, question number, and source-page provenance.
- Preserve answer values as raw strings: single options, multiple options, and numeric responses.
- Require human verification of extracted content before scoring.
- Support paper-specific question types and marking rules.
- Local-first data, with optional Google authentication and separately opt-in Drive backup.

## Current implementation

### Browser application

The web client is a static React + TypeScript + Vite application in the web directory.

- PDF.js extracts selectable PDF text in the browser using its worker.
- Text fragments are grouped by page coordinates to reconstruct lines and table rows.
- Browser-side parsing detects initial numbered answer-key and subject-wise Ques./Ans. table formats.
- Dexie stores original PDF Blobs, extracted page text, and candidate mappings in IndexedDB.
- The paper library displays source documents, detected answer-key candidates, and OCR warnings.
- Optional Google Identity Services sign-in validates a Google ID token in the browser and uses the subject as a local IndexedDB namespace. It does not upload papers or sync data.
- A test configuration screen is present. Starting an exam remains disabled until question segmentation and verified question storage are implemented.

Run the browser app:


See web/README.md for Firebase setup and local development details.

### Parser reference backend

The Python/FastAPI directory contains a local development/reference implementation and synthetic tests. Its PDF-upload endpoint is not used by the browser app and must not be deployed as the document-ingestion path for the strict local-first product.

Run reference tests:

    cd backend
    python -m venv .venv
    source .venv/bin/activate
    pip install -e ".[dev]"
    pytest

## Data boundaries

GitHub is never a storage location for:
- uploaded question papers or answer keys;
- extracted real questions or answer mappings;
- user responses, exam attempts, scores, or personal data;
- Google credentials or secrets.

The .gitignore excludes PDF files, local upload directories, virtual environments, and local environment files. Only example environment templates are tracked.

The browser stores local data in IndexedDB. This data is specific to the browser and device. Google sign-in alone does not provide backup or synchronization. Google Drive integration is a separate future opt-in feature.

See docs/local-first-browser-architecture.md for the data model and privacy boundaries.

## Development roadmap

- [x] Multi-PDF local upload and PDF.js text extraction
- [x] Embedded answer-key discovery for numbered parenthesized answer lists
- [x] Subject-wise Physics/Chemistry/Maths Ques./Ans. table detection
- [x] Separate answer-key document role support
- [x] Local IndexedDB storage and paper library
- [x] Optional Google sign-in with per-account local data namespace
- [ ] OCR for scanned pages
- [ ] Full question segmentation and subject/section identification
- [ ] Extraction of mathematical expressions, chemical notation, tables, and diagrams
- [ ] Editable review and verification workflow
- [ ] Extensible question type and marking-scheme registry
- [ ] Test selection and configurable subject/question counts
- [ ] JEE-style exam interface, countdown, autosave, and auto-submission
- [ ] Deterministic evaluation and immediate subject-wise results
- [ ] Local attempt history and analytics
- [ ] Optional Google Drive progress backup

## Contributing

Contributions are welcome. Open an issue before large architectural changes. Do not commit copyrighted exam papers, answer keys, solutions, or diagrams unless redistribution is explicitly permitted. Automated tests should generate synthetic PDFs or use fixtures that are licensed for redistribution.

## License

The application source code is intended to use the MIT License. This does not grant rights to third-party question papers, answer keys, diagrams, or other uploaded content.
