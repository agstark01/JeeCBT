# JeeCBT

An open-source exam-paper ingestion and computer-based testing platform, initially targeting JEE Main and JEE Advanced.

JeeCBT accepts one or more source PDFs, discovers question content and answer-key material wherever it appears, converts the result into a structured question bank, and lets students build timed mock tests with deterministic, question-wise evaluation.

> **Project status:** early development. Extraction is assistive, not authoritative. A reviewer must verify questions, answer mappings, and marking rules before a paper can be published or used for scoring.

## Core idea

The system must not assume that every examination has the same paper layout or that every answer key is a separate PDF. A paper may contain its answer key in later pages, a separate answer-key PDF may be supplied, or no key may be available yet.

JEE Main and JEE Advanced are initial exam profiles, not hard-coded parser formats. Question types, paper structure, and marking rules are configurable data.

## Product workflow

1. An uploader creates a paper package and uploads the question paper plus any optional supporting PDFs (answer keys, solutions, corrections, or addenda).
2. The ingestion pipeline extracts page text, page images/figures when needed, and document metadata.
3. The answer-key discovery stage scans **all uploaded documents and all pages of the question paper itself** for answer-key sections, answer tables, answer lists, and possible answer/solution material.
4. The matching stage aligns answer candidates with question identifiers, sections, paper codes, and shifts. It records ambiguity rather than silently guessing.
5. A reviewer edits and verifies question boundaries, options, equations, diagrams, subject labels, answer mappings, question types, and marking rules.
6. The verified paper enters the question bank.
7. A student configures a test: exam profile, subjects, total or per-subject question counts, duration, and source-paper pool.
8. The exam client provides question navigation, answer states, review controls, autosave, and a server-authoritative timer.
9. Submission or timeout freezes the attempt and invokes the marking engine.
10. Results show the score, subject-wise breakdown, question-wise responses, correct answers, and marking rationale.

## Design principles

- **Documents are sources; questions are structured records.** Keep uploaded PDFs and page-level provenance. Store question content as structured data; represent mathematical expressions in LaTeX and render them in the browser with MathJax/KaTeX. LaTeX export can be added, but TEX is not the canonical database format.
- **Answer-key discovery is independent of question parsing.** A key may be embedded in the question PDF, supplied in another PDF, or absent. The pipeline must support all three cases.
- **Do not confuse answer keys with solutions.** Solutions may contain a correct answer, but they need a separate classification and a reviewer-approved extraction path.
- **Human verification before publication.** OCR can confuse signs, superscripts, subscripts, chemical notation, option labels, and diagrams. Never publish or score an unreviewed extraction as authoritative.
- **Exam profiles are configuration, not parser branches.** JEE Main and JEE Advanced can have different question types, sections, durations, and marking rules without duplicating the ingestion engine.
- **Extensible question types.** Question types are identified by stable type keys and handled by registered renderers and scorers. New types must not require redesigning the document model.
- **Paper-specific marking.** Never assume every question is +4/-1. Marking is configured per question or section from the official paper instructions.
- **Deterministic evaluation.** Scoring is rule-based and tested. OCR/AI must never decide a student's marks.
- **Server-authoritative exam time.** The backend owns the deadline. Refreshing or changing the client clock must not extend an attempt.
- **Traceability.** Preserve source document, page number, extracted region, answer-key source, reviewer changes, and marking policy.

## Initial stack

- Python 3.12+
- FastAPI + Pydantic
- PyMuPDF for text extraction from text-based PDFs
- PostgreSQL for durable question bank and exam state (planned)
- Redis + a worker for long-running OCR/diagram processing (planned)
- Next.js/TypeScript exam client (planned)
- MathJax or KaTeX for browser-side math rendering (planned)
- Docker Compose for local development

The first ingestion implementation will extract selectable text and report pages with little/no text as likely scanned pages. OCR and diagram extraction will be adapters, added and evaluated against real papers. Local file storage is development-only; production must use private object storage and access controls.

## Repository layout

    backend/
      app/
        main.py
        pdf_ingest.py
        answer_discovery.py
        schemas.py
      tests/
    docs/
      architecture.md
      ingestion-pipeline.md
      question-schema.md

## Development status

- [x] Repository/product foundation
- [x] Generic source-document and embedded/separate answer-key requirements documented
- [ ] PDF validation and page-text extraction
- [ ] Answer-key candidate discovery with page-level provenance
- [ ] Question segmentation and answer/question matching
- [ ] OCR for scanned pages and equation/diagram handling
- [ ] Reviewer/editor and paper publication workflow
- [ ] Exam profiles and extensible question-type registry
- [ ] Configurable test builder and server-side attempts/timer
- [ ] Deterministic marking engine and subject-wise results
- [ ] Exam client and analytics

## Contributing

Contributions are welcome. Open an issue before large architectural changes. Do not commit copyrighted exam papers, answer keys, solutions, or diagrams unless redistribution is explicitly permitted. Test fixtures should be synthetic or legally redistributable.

## License

The application source code is intended to use the MIT License. This does not grant rights to third-party question papers, answer keys, diagrams, or other uploaded content.
