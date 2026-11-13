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

## Google sign-in (optional)

Google sign-in is provided through Firebase Authentication. This is separate from PDF processing and does not grant Drive access.

1. Create a Firebase project.
2. Add a Web app in Firebase project settings.
3. Under Authentication, enable Google as a sign-in provider.
4. Add your local development origin, for example http://localhost:5173, to Firebase Authentication's authorized domains.
5. Copy the Firebase web app configuration values into web/.env.local, using web/.env.example as the template.
6. Restart the Vite development server.

Firebase web configuration values are public identifiers intended for a client application. Do not put Firebase service-account credentials, private keys, or other server secrets in VITE_ variables.

When a user signs in, the client uses the Firebase UID to namespace records in local IndexedDB. Guest imports are re-assigned to that local namespace on sign-in. This is a local database operation only; it does not upload any paper or attempt data to Firebase.

## Google Drive backup

Drive backup is intentionally not part of this first client milestone. Google authentication and Drive authorization are separate operations. A future backup feature must explicitly ask the user to connect Drive and request only the narrow scope required for application data. No PDF or attempt data is sent to Drive in the current version.

## Scripts

    npm run dev
    npm run typecheck
    npm test
    npm run build
