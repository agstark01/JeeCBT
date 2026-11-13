# JeeCBT Web

The web client is a static, local-first React application. It processes PDFs in the browser using PDF.js and stores source files plus extracted metadata in IndexedDB.

## Requirements

- Node.js 22.12+ recommended.
- npm.
- A modern browser with Web Workers, IndexedDB, and Web Crypto support.

## Run locally

    cd web
    cp .env.example .env.local
    npm install
    npm run dev

Open the local URL printed by Vite.

## Local-only document processing

The browser client does not call the FastAPI ingestion endpoint. PDF bytes are read with the browser File API, parsed with PDF.js and its worker, and stored in IndexedDB. The original file is kept as a Blob in the local database so the source remains available for future rendering and question review.

No upload or extracted paper content is sent to the JeeCBT backend. The current client has no API URL configured.

The first version extracts selectable text. Pages with very little selectable text are flagged as likely scanned; OCR is not enabled yet. Diagrams and page images remain available in the retained source PDF but are not yet segmented into individual question assets.

## End-to-end question review and CBT workflow

Each PaperPackage contains one question paper and its associated answer-key/solution PDFs. Keep a question paper and its key in the same import so question identities and keys cannot leak across papers.

1. Import the question paper and its key PDF(s) together. The import is processed in the browser and saved to IndexedDB.
2. Open the package in **My library** and choose **Segment questions**.
3. In **Review questions**, inspect the extracted text and the local visual crop. Assign the correct subject and question type, correct any extraction errors, then mark each usable question verified.
4. Open **Review answer keys**. Choose the source key PDF and the target question paper, inspect the original key page, edit any incorrect raw answer values, link the mapping to the exact question, and mark it verified. Ambiguous and mismatched mappings cannot be verified until resolved.
5. Open **Build a test**. Select source packages, choose per-subject quotas, duration, shuffle preference and fallback correct/incorrect marks. The builder shows how many fully verified pairs are eligible for each subject.
6. Start the timed test. The exam palette shows question state; answers support single choice, multiple choice and numeric input. The timer submits automatically at zero. Manual submission is also available.
7. The result screen shows total score, percentage, correct/incorrect/unanswered totals, positive and negative marks, and a question-wise comparison against the verified answer key. Submitted attempts are stored in IndexedDB.

Only questions with verified text and exactly one verified, package-scoped answer mapping are eligible. The question number alone is never used to join records across papers.

## Scoring behavior and current limits

- Question-specific positive/negative marks are used when the parser extracted them; otherwise the test builder's configurable defaults are used (initially +4 / -1).
- Single-choice answers require one exact option label.
- Multiple-correct answers require the complete option set. Partial-credit JEE Advanced rules are not implemented in this version; use a marking scheme that follows exact-set scoring or treat the score as provisional.
- Numeric answers compare parsed numbers with a small floating-point tolerance. Range-based numeric acceptance, units, tolerances from an exam's official marking instructions, and non-numeric formats are not yet supported.
- The countdown is browser-local and is not tamper-proof. It does not recover an in-progress attempt after a page reload; answers are saved in the submitted result only.
- Scanned PDFs still require OCR, which is not yet enabled. Complex crop boundaries and unusual PDF layouts require manual source-page review.

## Question segmentation and review

The first local parser recognizes common line-start markers (Q.1, Q1., Question 1:) and accumulates each question until the next marker. Each draft retains source PDF/page provenance and a numbering block. The original PDF page and generated visual question/option crops are rendered locally.

Question status (needs_review, verified, rejected) covers the question text and metadata only. Answer-key mappings have their own independent review status. Only the dedicated answer-key reviewer can make a key eligible for scoring.

The parser remains marker-based rather than a universal PDF parser. Papers with unusual or inline markers, scanned pages, complex columns, shared instructions, or heavy diagram/table content still require manual review. See the segmentation design and limitations in ../docs/question-segmentation-review.md.

## Google sign-in (optional)

Google sign-in uses Google's Identity Services JavaScript library. The browser verifies the returned ID token signature and its issuer, audience, and expiry against Google's public signing keys. The Google subject identifier is used only as a local IndexedDB namespace.

1. Create a project in Google Cloud Console.
2. Configure the OAuth consent screen.
3. Create an OAuth 2.0 Client ID of type Web application.
4. Add your local development origin, for example http://localhost:5173, to Authorized JavaScript origins. Add the deployed static-site origin before publishing.
5. Copy the client ID into web/.env.local as VITE_GOOGLE_CLIENT_ID.
6. Restart the Vite development server.

The Google Identity Services script and Google's public signing keys are loaded from Google when sign-in is used. The app stores only the verified profile fields (sub, name, email, picture) in localStorage. No Google access token is retained.

This is a local profile selector, not server-side account authentication. The app has no user database or protected server resources. Local browser data is user-controlled and is not protected from someone who already has access to the same browser profile.

## Google Drive backup

Drive backup is intentionally not part of this first client milestone. Google sign-in does not request Drive permissions. A future backup feature must be a separate opt-in action and request only the narrow scope required for application data. No PDF or attempt data is sent to Drive in the current version.

## Scripts

    npm run dev
    npm run typecheck
    npm test
    npm run build
