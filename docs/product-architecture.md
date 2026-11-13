# Product architecture and data boundaries

## Goals

JeeCBT is a local-first web CBT tool for personal practice with JEE Main and JEE Advanced papers. Users can upload a question paper and optional supporting PDFs, create a test from extracted questions, attempt it in a timed CBT interface, and get an immediate score.

The repository is for application source code, documentation, synthetic test fixtures, and CI only. It is not a question bank, PDF archive, answer-key archive, or user-data store.

## Data boundary

### GitHub repository

Allowed:
- application source code;
- schemas and parser rules;
- documentation;
- synthetic PDFs generated during tests;
- CI configuration.

Never commit:
- user-uploaded question papers;
- answer-key PDFs or solution booklets;
- extracted real question content;
- user answers, attempts, scores, Google credentials, or personal data;
- production secrets or environment files.

The repository ignore rules exclude PDF files, local upload directories, virtual environments, and environment files as a safety measure. The project should not use GitHub Issues, commits, Actions artifacts, or Releases to store user papers or results.

### Browser-local data (default)

The recommended default is to process and retain a user's paper package locally in the browser:
- original PDFs remain on the user's device;
- extracted structured question data is stored in IndexedDB;
- test configuration, attempt state, selected answers, and results are stored in IndexedDB;
- no upload is sent to the JeeCBT application server unless a future feature explicitly requires it and the user consents.

IndexedDB is preferred over localStorage because question sets and embedded figures may be larger than simple preference values. The app must provide a Delete local data action and explain that clearing browser site data can also erase unsynced attempts.

### Server-side processing (optional future mode)

The current FastAPI inspection endpoint accepts PDF bytes and extracts text in server memory; it does not persist the PDFs. However, those bytes still leave the user's device and reach the server. Therefore this endpoint must not be described as browser-only or end-to-end local processing.

Before exposing a hosted server-side parser, the UI must clearly disclose:
- which files are uploaded;
- whether the PDF bytes or extracted content are retained;
- the retention/deletion period;
- whether third-party OCR or AI providers receive any content.

For a strict local-only deployment, use browser-side PDF processing (for example PDF.js) and local OCR/worker adapters. The FastAPI parser can remain available for local development or for an explicitly opted-in transient-processing mode. If a temporary server mode is offered, implement bounded uploads, private temporary storage or memory processing, immediate cleanup, rate limits, and a clear privacy notice.

## Google authentication

Google sign-in and Google Drive backup are separate permissions and separate product actions.

### Sign-in

Request only OpenID Connect identity scopes (openid, email, profile) for account sign-in. The backend must verify the Google ID token and create the application's own session. Use the Google sub claim as the stable account identifier; do not use email as the primary key.

Recommended session handling:
- server-created, short-lived session;
- HttpOnly, Secure, appropriately SameSite cookie;
- CSRF protection on state-changing endpoints;
- validate token signature, issuer, audience, and expiry with Google's supported library;
- never store Google ID tokens or client secrets in GitHub or frontend source.

Google sign-in alone does not authorize Drive API access.

### Optional Drive backup

Offer a separate, explicit Connect Google Drive for backup action after sign-in. Explain the exact data being synced before requesting Drive permission.

Default backup proposal:
- store progress snapshots (test metadata, selected answers, score, timestamps, and analysis) in the app's hidden appDataFolder;
- use the narrow drive.appdata scope;
- do not request full Drive access (drive);
- do not upload original PDFs by default;
- let the user disconnect Drive and delete the app's backup data.

The appDataFolder is hidden from normal Drive browsing and accessible only to the app. Google notes that its folder is deleted when the user uninstalls the app from Drive, and users can also delete it manually. The application should explain this and allow exporting a human-readable backup.

A later option may allow syncing structured question-bank snapshots (without original PDFs) so a user can resume the exact test on another device. This should be a separate, clearly described setting because it syncs more data than progress summaries.

If a visible folder or file in My Drive is preferred instead, assess the narrower drive.file scope and Google Picker flow. Do not request broad Drive scopes merely to save test progress.

## Public exam sharing vs personal local practice

The first release should target personal practice:
- each user imports their own source PDFs;
- imported papers are private to that browser profile unless the user explicitly backs them up;
- no public question repository or public paper-sharing workflow is implied;
- exams and scores are generated locally.

A later shared-exam mode would require a separate product decision:
- where published structured questions and answer keys are stored;
- who can publish them;
- whether papers are private, link-shared, or public;
- how copyrighted source documents are handled;
- server-side answer-key isolation and evaluation.

## CBT behavior

A generated test must snapshot its question selection, order, question type, marking policy, and duration at the time the attempt begins. Later edits to the question bank must not change an in-progress attempt.

The examination interface should provide:
- question navigation palette;
- subject and section navigation;
- answer-state indicators;
- mark-for-review and clear-response controls;
- configurable question count and subject count/distribution;
- configured test duration;
- autosave of answers and attempt state;
- automatic submission when the deadline is reached;
- immediate result and question-wise review after submission.

For browser-local practice, the timer must survive a page refresh and derive remaining time from a stored deadline, not count down only in memory. A browser-local timer is not tamper-proof against a user who controls the device clock or developer tools. A high-integrity/public competitive exam mode requires a server-authoritative clock and server-side answer-key isolation.

## Parser and question schema

Document ingestion, question segmentation, answer-key discovery, question typing, and marking are independent stages.

A question's stable identity must include exam/session, paper, subject or section, and local question number. Repeated Q.1 labels must be valid when subjects or sections restart numbering.

Answer values must be preserved as raw strings and then normalized using the question type. Examples include:
- single option: A;
- multiple options: BC, ABD;
- numerical values: 25.6, 0.11, -2.7;
- other exam-specific response types.

A detected key is a proposed extraction, not verified truth. Every imported paper must go through a review state before the answer key is trusted for scoring.

## Current implementation status

- Multi-PDF FastAPI inspection endpoint exists.
- Selectable text is extracted page by page.
- Embedded numbered-key format is supported.
- Subject-wise PAPER-1 PHYSICS/CHEMISTRY/MATHS tables with Ques./Ans. row pairs are supported on the feature branch.
- The current parser is rule-based and intentionally conservative.
- OCR, full question segmentation, database persistence, Google authentication, Drive backup, and the web exam client are not implemented yet.
