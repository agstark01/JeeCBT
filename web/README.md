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

## Mixed-paper test builder

The builder lets you select multiple imported paper packages for one planned test. A package contains the question-paper import and any answer-key PDFs or embedded key candidates supplied with it. Package boundaries are preserved so identical question numbers from different papers cannot accidentally share an answer key.

Choose Physics, Chemistry, and/or Mathematics and set a question quota for each selected subject. The builder calculates the total, accepts a duration, and provides a shuffle option for the future question sampler. Random sampling will be without replacement and will preserve each question's source-paper and answer-key references.

At this stage these are configuration controls only. The importer has not yet created complete, reviewed question records; answer-key mappings are still proposals. The Start examination action therefore remains disabled. The app must not treat the number of extracted answers as the number of available questions.

See [the mixed-paper builder design](../docs/mixed-paper-test-builder.md) for the selection rules and the question-segmentation prerequisite.

## Question segmentation and review

After import, open a paper package in the library and choose **Segment questions**. The first local parser recognizes common line-start markers (`Q.1`, `Q1.`, `Question 1:`) and accumulates each question until the next marker. Each draft retains its source PDF, page range and numbering block.

Open the review screen to edit the extracted text, question number, subject and question type. When the PDF does not contain explicit subject labels, questions remain unassigned; use the block-level or question-number-range assignment controls. The original PDF is previewed locally alongside the editable draft.

A question marked verified has only had its question text and metadata reviewed. Answer-key candidates remain proposed mappings even when linked to a question. The current milestone does not verify answers, crop diagrams, or perform OCR. The exam runner remains disabled until these parts are addressed.

The parser is intentionally marker-based rather than a universal PDF parser. Papers with unusual or inline markers, scanned pages, complex columns, shared instructions, or heavy diagram/table content still require manual review. See [the segmentation design and limitations](../docs/question-segmentation-review.md).

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
