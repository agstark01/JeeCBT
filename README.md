# JeeCBT

An open-source JEE Advanced-style computer-based test platform.

JeeCBT turns uploaded previous-year question papers and answer keys into a structured question bank, then lets students build timed mock tests and receive deterministic, question-wise results.

> **Project status:** early development. The first milestone establishes the PDF ingestion and scoring foundations. Extracted content must be reviewed before a paper is published or used for scoring.

## Product workflow

1. An uploader submits a question-paper PDF and its matching answer-key PDF.
2. The ingestion pipeline extracts page text and retains page references and source files.
3. A reviewer edits and verifies question boundaries, options, equations, diagrams, subject labels, answer mappings, question types, and marking rules.
4. The verified paper enters the question bank.
5. A student configures a test: subjects, question count or per-subject counts, duration, and optionally a year/paper or mixed-paper pool.
6. The exam client provides a JEE-style question palette, timer, answer states, review controls, and autosave.
7. Submission or timeout freezes the attempt and invokes the marking engine.
8. Results show the score, subject-wise breakdown, question-wise responses, correct answers, and marking rationale.

## Design principles

- **Structured data first, LaTeX where needed.** Store question content as structured JSON/HTML-safe text with math expressions represented as LaTeX. Render math in the browser with MathJax/KaTeX. A .tex export can be added, but LaTeX is not the canonical database format.
- **Human verification before publication.** OCR can confuse signs, superscripts, subscripts, chemical notation, option labels, and diagrams. Never publish or score an unreviewed extraction as authoritative.
- **Paper-specific marking.** Do not assume every question is +4/-1. Marking is configured per question or section from the official paper instructions.
- **Deterministic evaluation.** The scoring engine must be rule-based and covered by tests. OCR/AI must never decide a student's marks.
- **Server-authoritative exam time.** The backend owns the deadline. Refreshing or changing the client clock must not extend an attempt.
- **Traceability.** Keep the source paper, source page, extraction status, reviewer changes, answer-key source, and marking policy attached to every published question.

## Initial stack

- Python 3.12+
- FastAPI + Pydantic
- PyMuPDF for text extraction from text-based PDFs
- PostgreSQL for durable question bank and exam state (planned)
- Redis + a worker for long-running OCR/diagram processing (planned)
- Next.js/TypeScript exam client (planned)
- MathJax or KaTeX for browser-side math rendering (planned)
- Docker Compose for local development

The first ingestion implementation stores uploads locally and extracts selectable PDF text. Scanned PDFs require an OCR adapter, which will be added after testing representative papers. Local file storage is for development only; production deployment must use private object storage and access controls.

## Repository layout

    backend/
      app/
        main.py          FastAPI application and health endpoint
        pdf_ingest.py    PDF validation, storage, and page extraction
        scoring.py       Deterministic marking primitives
        schemas.py       Initial API and question data contracts
      tests/
    docs/
      architecture.md
      question-schema.md

## Run locally

    cd backend
    python -m venv .venv
    source .venv/bin/activate
    pip install -e ".[dev]"
    uvicorn app.main:app --reload

Open the API docs at http://127.0.0.1:8000/docs.

## Run tests

    cd backend
    pytest

## Current scope and limitations

- [x] Repository/product foundation
- [x] Initial question and marking contracts
- [x] Basic PDF upload and page-text extraction endpoint
- [x] Deterministic scoring primitives and tests
- [ ] Real-paper question segmentation and answer-key mapping
- [ ] OCR for scanned pages and equation/diagram handling
- [ ] Reviewer/editor UI and publication workflow
- [ ] PostgreSQL persistence and authentication
- [ ] Test builder, exam attempt API, autosave, and server-side timer
- [ ] Exam client and result analytics

## Contributing

Contributions are welcome. Please open an issue before making large architectural changes. Do not commit copyrighted exam PDFs or answer keys unless their redistribution is explicitly permitted. Test fixtures should be synthetic or legally redistributable.

## License

The application source code is intended to use the MIT License. This does not grant rights to third-party question papers, answer keys, diagrams, or other uploaded content.
