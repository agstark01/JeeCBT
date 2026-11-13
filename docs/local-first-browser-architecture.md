# Local-first browser architecture

## Decision

JeeCBT uses Option A: strict browser-local document processing for the personal-practice product.

The web client is a static single-page application. User question papers, answer-key PDFs, extracted question data, test attempts, and results are not uploaded to JeeCBT application servers.

## Processing flow

1. The user selects one or more PDFs using the browser File API.
2. PDF.js reads each file in the browser and uses a Web Worker for PDF parsing.
3. Text items are grouped by their PDF page coordinates to reconstruct lines and table rows.
4. The browser-side answer-key adapters inspect every page of every selected document.
5. Original PDF Blobs, extracted page text, answer-key candidates, and metadata are stored in IndexedDB via Dexie.
6. The UI shows answer candidates and warnings. Extracted answers remain proposals and require verification.
7. Later milestones add local question segmentation, question editing, local test assembly, timed attempts, deterministic scoring, and local result history.

The parser must not rely on the document role as the only signal. Even when the user labels a file as a question paper, every page is scanned because an answer key can be embedded at the end. A separately labelled answer-key PDF may use a format with no explicit answer-key heading, so the role is a hint for a narrower fallback parser.

## Browser storage

IndexedDB stores records namespaced by ownerId:
- local for guest mode;
- Google OIDC subject (sub) for a locally signed-in Google profile.

On first sign-in, guest paper packages are reassigned to that profile namespace in the same local IndexedDB database. This is not a cloud upload. When the profile signs out, account-scoped records remain on that device and are hidden from the guest namespace.

The UI must make clear that browser storage is device/browser-specific. Google sign-in alone does not synchronize data across browsers or devices. Users can delete their locally stored data from the library screen. Browser site-data clearing may also delete IndexedDB records.

## Google sign-in

The optional sign-in uses Google Identity Services. It requests basic OpenID Connect identity only. The browser validates the signed ID token using Google's rotating public signing keys and checks issuer, audience, and expiry before using the Google subject as the local profile namespace.

The verified profile fields are stored in localStorage so the local namespace can be selected again after a page reload. The ID token and access tokens are not retained. This is not server-side authentication: JeeCBT has no user database, no protected server API, and no server-side authorization. Data on a user-controlled browser remains user-controlled.

The Google Identity Services script and public signing keys are loaded from Google when the user signs in. PDF bytes, extracted question text, answer keys, attempts, and results do not go to Google.

## Drive backup: separate future permission

No Google Drive API permission is requested in the current application. If backup is implemented, it must be a separate opt-in action with a clear description of which records will be copied.

For progress-only backup, assess the narrow drive.appdata scope and Google Drive's application-data folder. Do not request broad Drive access. Do not back up original PDFs by default. Provide disconnect and delete-backup controls, and a portable export option.

## Backend policy

The current backend/app/main.py endpoint accepts PDF bytes. It is retained only as a development/reference implementation for parser work and synthetic tests. It must not be connected to the hosted web client or deployed as the document-ingestion path for the strict local-first product.

The product's static web deployment must not configure a backend API origin for PDF or question data. Any future optional remote service must be separately designed, disclosed, and opted into; it cannot silently become a dependency of local practice.

## Current UI milestone

The current web client provides:
- local multi-PDF selection with per-file role hints;
- browser-side text extraction using PDF.js;
- answer-key discovery for the initial numbered-answer and subject-table formats;
- local IndexedDB storage of source PDFs and extraction results;
- a paper library, status/warning display, and data deletion;
- optional Google Identity Services sign-in with local profile namespacing;
- an early test configuration screen, with start disabled until question segmentation and review exist.

Not yet implemented:
- scanned-PDF OCR;
- question and diagram segmentation;
- editable answer review;
- the interactive CBT examination runner;
- automatic submission and marking;
- result history and subject analytics;
- Drive backup/synchronization.
