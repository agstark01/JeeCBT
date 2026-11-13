# JeeCBT

An open-source exam-paper ingestion and computer-based testing platform, initially targeting JEE Main and JEE Advanced.

JeeCBT accepts one or more source PDFs, discovers question-paper and answer-key material wherever it appears, and is being developed into a structured question bank and timed mock-test platform.

> **Project status:** early development. The current backend milestone inspects PDFs and proposes answer-key candidates. It does not yet segment all questions or run full examinations.

## Core idea

The system must not assume that every examination has the same paper layout or that every answer key is a separate PDF. A paper may contain its answer key in later pages, a separate answer-key PDF may be supplied, or no key may be available yet.

JEE Main and JEE Advanced are initial exam profiles, not hard-coded parser formats. Question types, paper structure, and marking rules will be configurable data.

## Product workflow

1. An uploader creates a paper package and uploads the question paper plus any optional supporting PDFs (answer keys, solutions, corrections, or addenda).
2. The ingestion pipeline inspects every page of every uploaded PDF and extracts selectable text with page-level provenance.
3. The answer-key discovery stage scans all uploaded documents, including the final pages of the question paper itself.
4. The matching stage aligns answer candidates with question identities, sections, paper codes, and shifts. It records ambiguity rather than silently guessing.
5. A reviewer verifies question boundaries, options, equations, diagrams, subject labels, answer mappings, question types, and marking rules.
6. The verified paper enters the question bank.
7. A student configures a test: exam profile, subjects, total or per-subject question counts, duration, and source-paper pool.
8. The exam client provides question navigation, answer states, review controls, autosave, and a server-authoritative timer.
9. Submission or timeout freezes the attempt and invokes the marking engine.
10. Results show the score, subject-wise breakdown, question-wise responses, correct answers, and marking rationale.

## Design principles

- **Documents are sources; questions are structured records.** Store question content as structured data; represent mathematical expressions in LaTeX and render them in the browser with MathJax/KaTeX. LaTeX export can be added, but a .tex file is not the canonical database format.
- **Answer-key discovery is independent of question parsing.** A key may be embedded in the question PDF, supplied in another PDF, or absent. The pipeline supports all three cases as separate states.
- **Do not confuse answer keys with solutions.** Solutions may contain a correct answer, but they need a separate classification and reviewer-approved extraction path.
- **Human verification before publication.** OCR can confuse signs, superscripts, subscripts, chemical notation, option labels, and diagrams. Never publish or score an unreviewed extraction as authoritative.
- **Exam profiles are configuration, not parser branches.** JEE Main and JEE Advanced can have different question types, sections, durations, and marking rules without duplicating the ingestion engine.
- **Extensible question types.** Question types are identified by stable type keys and handled by registered renderers and scorers.
- **Paper-specific marking.** Never assume every question is +4/-1. Marking is configured per question or section from the official paper instructions.
- **Deterministic evaluation.** Scoring is rule-based and tested. OCR/AI must never decide a student's marks.
- **Server-authoritative exam time.** The backend owns the deadline. Refreshing or changing the client clock must not extend an attempt.
- **Traceability.** Preserve source document, page number, extracted region, answer-key source, reviewer changes, and marking policy.

## Data and privacy

GitHub stores application code and documentation only. User PDFs, extracted questions, answer keys, attempts, and scores must never be committed. The recommended product direction is local-first browser storage with optional Google Drive backup for progress. See [Product architecture and data boundaries](docs/product-architecture.md) for the privacy model, Google sign-in/Drive separation, and CBT requirements.

## Initial stack

- Python 3.11+
- FastAPI + Pydantic
- PyMuPDF for text extraction from text-based PDFs
- PostgreSQL for durable question bank and exam state (planned)
- Redis + a worker for long-running OCR/diagram processing (planned)
- Next.js/TypeScript exam client (planned)
- MathJax or KaTeX for browser-side math rendering (planned)
- Docker Compose for local development (planned)

## Run the backend locally

    cd backend
    python -m venv .venv
    source .venv/bin/activate
    pip install -e ".[dev]"
    uvicorn app.main:app --reload

Open http://127.0.0.1:8000/docs for the interactive API.

## Inspect uploaded PDFs

The current endpoint accepts multiple PDFs under the same field. Document roles are optional hints, not requirements.

    curl -X POST http://127.0.0.1:8000/api/v1/ingestion/inspect \
      -F "exam_profile=jee_main" \
      -F 'roles_json=["question_paper","answer_key"]' \
      -F "documents=@question-paper.pdf" \
      -F "documents=@answer-key.pdf"

For an embedded key, upload only the question-paper PDF. The service scans all its pages.

The endpoint reports one of three states:

- detected_needs_review: an answer-key candidate was detected; proposed mappings still need verification.
- not_detected: no candidate was found in readable text. This does not prove that the answer key is absent.
- needs_ocr: at least one page appears to have little extractable text and no key candidate was found.

Uploads are processed in memory and are not persisted by this initial endpoint. The response includes page metadata, text excerpts, candidate answer mappings, and source-page references.

## Run tests

    cd backend
    pytest

## Repository layout

    backend/
      app/
        main.py
        pdf_ingest.py
        answer_discovery.py
        schemas.py
      tests/
        test_answer_discovery.py
    docs/
      ingestion-pipeline.md
      sample-validation.md

## Development status

- [x] Multi-PDF upload inspection endpoint
- [x] PDF signature, size, page-count and password checks
- [x] Page-level text extraction and source provenance
- [x] Embedded answer-key heading detection
- [x] Initial numbered answer mapping extraction for parenthesized keys
- [x] Separate answer-key document support via uploader role hint
- [x] Synthetic tests for embedded keys, separate keys and OCR-needed pages
- [x] Initial observations recorded for the supplied JEE Main and JEE Advanced samples
- [ ] OCR for image-based pages
- [ ] More answer-key layout adapters and robust table extraction
- [ ] Subject/section boundary detection and question segmentation
- [ ] Math, chemical notation, tables, and diagram/figure extraction
- [ ] Reviewer/editor UI and verified question-bank persistence
- [ ] Exam profiles and question-type registry
- [ ] Configurable test builder and server-side attempts/timer
- [ ] Deterministic marking engine and subject-wise results
- [ ] Exam client and analytics

## Contributing

Contributions are welcome. Open an issue before large architectural changes. Do not commit copyrighted exam papers, answer keys, solutions, or diagrams unless redistribution is explicitly permitted. Tests generate synthetic PDFs at runtime.

## License

The application source code is intended to use the MIT License. This does not grant rights to third-party question papers, answer keys, diagrams, or other uploaded content.
