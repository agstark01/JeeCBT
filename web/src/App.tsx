import { useEffect, useMemo, useRef, useState } from "react";
import {
  onAuthStateChanged,
  signInWithPopup,
  signOut,
  type User,
} from "firebase/auth";
import { auth, createGoogleProvider, firebaseConfigured } from "./lib/firebase";
import {
  clearLocalData,
  deletePaperPackage,
  listPaperPackages,
  savePaperPackage,
} from "./lib/db";
import { discoverAnswerKeys } from "./lib/answer-discovery";
import { extractPdfLocally } from "./lib/pdf";
import type {
  AnswerKeyCandidate,
  DocumentRole,
  PaperPackage,
} from "./types";

type Tab = "import" | "library" | "builder";

interface PendingFile {
  file: File;
  role: DocumentRole;
}

const roleLabels: Record<DocumentRole, string> = {
  question_paper: "Question paper",
  answer_key: "Answer key",
  solutions: "Solutions",
  unknown: "Unclassified PDF",
};

function guessRole(filename: string): DocumentRole {
  const lower = filename.toLowerCase();
  if (/(answer|key|ans[-_ ]?key)/.test(lower)) return "answer_key";
  if (/(solution|solutions|explanation)/.test(lower)) return "solutions";
  if (/(question|paper|jee|advanced|mains?)/.test(lower)) return "question_paper";
  return "unknown";
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return Math.max(1, Math.round(bytes / 1024)) + " KB";
  return (bytes / (1024 * 1024)).toFixed(1) + " MB";
}

function statusText(status: PaperPackage["answerKeyStatus"]): string {
  if (status === "detected_needs_review") return "Answer key detected · review required";
  if (status === "needs_ocr") return "Some pages need OCR";
  return "No answer key detected";
}

function mappingCount(candidate: AnswerKeyCandidate): number {
  return candidate.mappings.length;
}

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [tab, setTab] = useState<Tab>("import");
  const [pendingFiles, setPendingFiles] = useState<PendingFile[]>([]);
  const [packages, setPackages] = useState<PaperPackage[]>([]);
  const [examProfile, setExamProfile] = useState<PaperPackage["examProfile"]>("jee_advanced");
  const [paperTitle, setPaperTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [selectedPackageId, setSelectedPackageId] = useState("");
  const [subjects, setSubjects] = useState(["PHYSICS", "CHEMISTRY", "MATHS"]);
  const [questionCount, setQuestionCount] = useState(30);
  const [durationMinutes, setDurationMinutes] = useState(60);
  const fileInput = useRef<HTMLInputElement>(null);

  const ownerId = user?.uid ?? "local";
  const selectedPackage = useMemo(
    () => packages.find((item) => item.id === selectedPackageId) ?? packages[0],
    [packages, selectedPackageId],
  );

  useEffect(() => {
    if (!auth) return;
    return onAuthStateChanged(auth, setUser);
  }, []);

  useEffect(() => {
    let active = true;
    listPaperPackages(ownerId)
      .then((items) => {
        if (active) {
          setPackages(items);
          setSelectedPackageId((current) =>
            current && items.some((item) => item.id === current)
              ? current
              : items[0]?.id ?? "",
          );
        }
      })
      .catch(() => {
        if (active) setError("Unable to read this browser's local question library.");
      });
    return () => {
      active = false;
    };
  }, [ownerId]);

  const addFiles = (files: FileList | File[]) => {
    const pdfs = Array.from(files).filter(
      (file) =>
        file.type === "application/pdf" ||
        file.name.toLowerCase().endsWith(".pdf"),
    );
    if (pdfs.length === 0) {
      setError("Choose at least one PDF file.");
      return;
    }
    setError("");
    setPendingFiles((current) => {
      const next = [...current];
      for (const file of pdfs) {
        if (!next.some((item) => item.file.name === file.name && item.file.size === file.size)) {
          next.push({ file, role: guessRole(file.name) });
        }
      }
      return next;
    });
  };

  const updateRole = (index: number, role: DocumentRole) => {
    setPendingFiles((current) =>
      current.map((item, itemIndex) =>
        itemIndex === index ? { ...item, role } : item,
      ),
    );
  };

  const importPapers = async () => {
    if (pendingFiles.length === 0) return;
    setBusy(true);
    setError("");
    setNotice("");
    const extracted = [];
    try {
      for (let index = 0; index < pendingFiles.length; index += 1) {
        const item = pendingFiles[index];
        setProgress("Reading " + item.file.name + " in this browser…");
        const document = await extractPdfLocally(item.file, item.role, (page, total) => {
          setProgress(
            "Reading " + item.file.name + " · page " + page + " of " + total,
          );
        });
        extracted.push(document);
      }

      setProgress("Searching all uploaded pages for answer keys…");
      const candidates = discoverAnswerKeys(extracted);
      const hasLowTextPages = extracted.some((document) =>
        document.pages.some((page) => page.likelyScanned),
      );
      const answerKeyStatus = candidates.length > 0
        ? "detected_needs_review"
        : hasLowTextPages
          ? "needs_ocr"
          : "not_detected";

      const warnings: string[] = [];
      for (const document of extracted) {
        const scannedCount = document.pages.filter((page) => page.likelyScanned).length;
        if (scannedCount > 0) {
          warnings.push(
            document.filename + ": " + scannedCount +
            " page(s) have little selectable text; local OCR is not enabled yet.",
          );
        }
      }
      if (candidates.length === 0) {
        warnings.push(
          "No supported answer-key layout was found. This does not prove that the paper has no key.",
        );
      }
      const mismatchCount = candidates.reduce(
        (sum, candidate) =>
          sum + (candidate.rawExcerpt.includes("Unmatched Ques./Ans.") ? 1 : 0),
        0,
      );
      if (mismatchCount > 0) {
        warnings.push(
          "At least one subject table has mismatched question and answer cells. Verify it manually.",
        );
      }

      const record: PaperPackage = {
        id: crypto.randomUUID(),
        ownerId,
        title:
          paperTitle.trim() ||
          pendingFiles[0].file.name.replace(/\.pdf$/i, ""),
        examProfile,
        createdAt: Date.now(),
        documents: extracted,
        answerKeyStatus,
        candidates,
        warnings,
      };
      await savePaperPackage(record);
      const refreshed = await listPaperPackages(ownerId);
      setPackages(refreshed);
      setSelectedPackageId(record.id);
      setPendingFiles([]);
      if (fileInput.current) fileInput.current.value = "";
      setPaperTitle("");
      setNotice(
        "Import complete. The PDFs and extracted data were saved in this browser only.",
      );
      setTab("library");
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "PDF import failed.";
      setError(message);
    } finally {
      setBusy(false);
      setProgress("");
    }
  };

  const removePackage = async (id: string) => {
    await deletePaperPackage(id, ownerId);
    const refreshed = await listPaperPackages(ownerId);
    setPackages(refreshed);
    if (selectedPackageId === id) setSelectedPackageId(refreshed[0]?.id ?? "");
    setNotice("The imported paper package was deleted from this browser.");
  };

  const handleClearData = async () => {
    const confirmed = window.confirm(
      "Delete all JeeCBT paper packages and extracted data for this browser profile? This cannot be undone.",
    );
    if (!confirmed) return;
    await clearLocalData(ownerId);
    setPackages([]);
    setSelectedPackageId("");
    setNotice("Local JeeCBT data for this profile has been deleted.");
  };

  const handleGoogleSignIn = async () => {
    if (!auth) {
      setError("Google sign-in is not configured. Follow web/README.md to connect Firebase Authentication.");
      return;
    }
    try {
      await signInWithPopup(auth, createGoogleProvider());
      setError("");
      setNotice("Signed in. Imported papers remain stored locally on this device.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Google sign-in failed.");
    }
  };

  const handleGoogleSignOut = async () => {
    if (auth) await signOut(auth);
    setNotice("Signed out. Your local paper data has not been deleted.");
  };

  const toggleSubject = (subject: string) => {
    setSubjects((current) =>
      current.includes(subject)
        ? current.filter((item) => item !== subject)
        : [...current, subject],
    );
  };

  const totalAnswers = packages.reduce(
    (sum, item) =>
      sum + item.candidates.reduce((candidateSum, candidate) => candidateSum + mappingCount(candidate), 0),
    0,
  );

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="#" onClick={(event) => { event.preventDefault(); setTab("import"); }}>
          <span className="brand-mark">J</span>
          <span>Jee<span className="brand-light">CBT</span></span>
        </a>
        <nav className="main-nav" aria-label="Main navigation">
          <button className={tab === "import" ? "nav-link active" : "nav-link"} onClick={() => setTab("import")}>Import papers</button>
          <button className={tab === "library" ? "nav-link active" : "nav-link"} onClick={() => setTab("library")}>My library <span className="nav-count">{packages.length}</span></button>
          <button className={tab === "builder" ? "nav-link active" : "nav-link"} onClick={() => setTab("builder")}>Build a test</button>
        </nav>
        <div className="account-area">
          {user ? (
            <>
              <span className="user-chip" title={user.email ?? user.displayName ?? "Signed in"}>
                {user.photoURL ? <img src={user.photoURL} alt="" /> : <span className="avatar-fallback">{(user.displayName ?? user.email ?? "U").slice(0, 1).toUpperCase()}</span>}
                <span>{user.displayName ?? user.email ?? "Google user"}</span>
              </span>
              <button className="button button-quiet button-small" onClick={handleGoogleSignOut}>Sign out</button>
            </>
          ) : (
            <button className="button button-outline button-small" onClick={handleGoogleSignIn} disabled={!firebaseConfigured}>
              <GoogleGlyph /> Sign in with Google
            </button>
          )}
        </div>
      </header>

      <main className="main-content">
        <div className="privacy-banner">
          <span className="privacy-icon">●</span>
          <span><strong>Local-first by design.</strong> Your PDFs, extracted questions, answer keys and attempts stay in this browser.</span>
          <span className="privacy-tag">No paper uploads to JeeCBT servers</span>
        </div>

        {(error || notice) && (
          <div className={error ? "message message-error" : "message message-success"} role="status">
            <span>{error || notice}</span>
            <button onClick={() => { setError(""); setNotice(""); }} aria-label="Dismiss message">×</button>
          </div>
        )}

        {tab === "import" && (
          <section className="page-section">
            <div className="page-heading">
              <div>
                <div className="eyebrow">YOUR PERSONAL QUESTION BANK</div>
                <h1>Bring your paper. <span>We'll prepare the test.</span></h1>
                <p>Import a question paper and its answer key. They can be in one PDF or separate files.</p>
              </div>
              <div className="heading-stats">
                <div><strong>{packages.length}</strong><span>Imported papers</span></div>
                <div><strong>{totalAnswers}</strong><span>Answer mappings found</span></div>
              </div>
            </div>

            <div className="import-layout">
              <div className="panel upload-panel">
                <div className="panel-header">
                  <div>
                    <h2>1. Add your PDFs</h2>
                    <p>Upload the question paper, answer key, or both.</p>
                  </div>
                  <span className="step-number">01</span>
                </div>
                <div
                  className="drop-zone"
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={(event) => {
                    event.preventDefault();
                    addFiles(event.dataTransfer.files);
                  }}
                >
                  <div className="upload-symbol"><UploadGlyph /></div>
                  <h3>Drop PDF files here</h3>
                  <p>Question paper and answer key can be selected together.</p>
                  <button className="button button-primary" onClick={() => fileInput.current?.click()} disabled={busy}>Browse PDFs</button>
                  <input
                    ref={fileInput}
                    className="visually-hidden"
                    type="file"
                    accept="application/pdf,.pdf"
                    multiple
                    onChange={(event) => event.target.files && addFiles(event.target.files)}
                  />
                  <div className="file-limit">PDF only · Maximum 25 MB per file · Up to 10 files</div>
                </div>

                {pendingFiles.length > 0 && (
                  <div className="pending-list">
                    <div className="pending-heading"><strong>{pendingFiles.length} file(s) selected</strong><button className="text-button" onClick={() => setPendingFiles([])} disabled={busy}>Clear all</button></div>
                    {pendingFiles.map((item, index) => (
                      <div className="pending-file" key={item.file.name + item.file.size}>
                        <span className="pdf-icon">PDF</span>
                        <div className="file-meta"><strong>{item.file.name}</strong><span>{formatBytes(item.file.size)}</span></div>
                        <select value={item.role} onChange={(event) => updateRole(index, event.target.value as DocumentRole)} aria-label={"Role for " + item.file.name}>
                          {Object.entries(roleLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                        </select>
                        <button className="remove-file" onClick={() => setPendingFiles((current) => current.filter((_, i) => i !== index))} aria-label={"Remove " + item.file.name}>×</button>
                      </div>
                    ))}
                    <div className="import-config">
                      <label className="field-label">Paper title <span>Optional</span><input value={paperTitle} onChange={(event) => setPaperTitle(event.target.value)} placeholder="e.g. JEE Advanced 2020 — Paper 1" /></label>
                      <label className="field-label">Examination profile<select value={examProfile} onChange={(event) => setExamProfile(event.target.value as PaperPackage["examProfile"])}><option value="jee_advanced">JEE Advanced</option><option value="jee_main">JEE Main</option><option value="generic">Other / generic</option></select></label>
                      <button className="button button-primary button-wide" onClick={importPapers} disabled={busy}>
                        {busy ? "Processing locally…" : "Analyse PDFs"}
                        {!busy && <ArrowGlyph />}
                      </button>
                      {busy && <div className="progress-line"><span className="spinner" />{progress}</div>}
                    </div>
                  </div>
                )}
              </div>

              <aside className="panel side-panel">
                <div className="side-icon"><ScanGlyph /></div>
                <h2>What happens after upload?</h2>
                <ol className="process-list">
                  <li><span>1</span><div><strong>Read every page</strong><p>Text is extracted in your browser. No file is sent to a server.</p></div></li>
                  <li><span>2</span><div><strong>Find answer keys</strong><p>We look for embedded keys and separately uploaded answer tables.</p></div></li>
                  <li><span>3</span><div><strong>Review the results</strong><p>Detected answers remain proposals until you verify them.</p></div></li>
                  <li><span>4</span><div><strong>Prepare your test</strong><p>Question segmentation and the timed exam runner are the next build stage.</p></div></li>
                </ol>
                <div className="privacy-note"><LockGlyph /><span>Files and extracted content are stored in this browser's IndexedDB. Clearing site data can remove them.</span></div>
              </aside>
            </div>

            <div className="supported-formats">
              <div><span className="format-dot dot-main" /> <strong>Embedded answer key</strong><span>e.g. JEE Main papers with an answer-key page at the end</span></div>
              <div><span className="format-dot dot-table" /> <strong>Subject-wise table</strong><span>e.g. Paper 1 Physics / Chemistry / Maths with Ques. and Ans. rows</span></div>
              <div><span className="format-dot dot-separate" /> <strong>Separate answer-key PDF</strong><span>Upload it alongside the question paper</span></div>
            </div>
          </section>
        )}

        {tab === "library" && (
          <section className="page-section">
            <div className="page-heading simple-heading">
              <div><div className="eyebrow">ON THIS DEVICE</div><h1>My paper library</h1><p>Imported documents and proposed answer mappings saved in this browser.</p></div>
              <button className="button button-primary" onClick={() => setTab("import")}><UploadGlyph /> Import papers</button>
            </div>
            {packages.length === 0 ? (
              <div className="empty-state"><div className="empty-symbol"><FolderGlyph /></div><h2>Your library is empty</h2><p>Import a question paper to start building your personal practice bank.</p><button className="button button-primary" onClick={() => setTab("import")}>Import your first paper</button></div>
            ) : (
              <div className="library-layout">
                <div className="package-list">
                  {packages.map((item) => (
                    <button key={item.id} className={selectedPackageId === item.id ? "package-card selected" : "package-card"} onClick={() => setSelectedPackageId(item.id)}>
                      <span className="package-icon"><FileGlyph /></span>
                      <span className="package-card-content"><strong>{item.title}</strong><span>{item.examProfile.replace("_", " ").toUpperCase()} · {item.documents.length} PDF(s)</span><span>{new Date(item.createdAt).toLocaleString()}</span></span>
                      <span className={item.answerKeyStatus === "detected_needs_review" ? "status-dot success" : "status-dot warning"} />
                    </button>
                  ))}
                </div>
                {selectedPackage && (
                  <div className="panel package-detail">
                    <div className="detail-title"><div><div className="eyebrow">IMPORTED PAPER</div><h2>{selectedPackage.title}</h2></div><button className="text-button danger-text" onClick={() => void removePackage(selectedPackage.id)}>Delete package</button></div>
                    <div className="detail-status"><span className={selectedPackage.answerKeyStatus === "detected_needs_review" ? "pill pill-success" : "pill pill-warning"}>{statusText(selectedPackage.answerKeyStatus)}</span><span>{selectedPackage.documents.reduce((sum, doc) => sum + doc.pageCount, 0)} pages inspected</span></div>
                    <div className="document-list">
                      {selectedPackage.documents.map((doc) => (
                        <div className="document-row" key={doc.id}><span className="pdf-icon">PDF</span><div><strong>{doc.filename}</strong><span>{roleLabels[doc.role]} · {doc.pageCount} pages · {formatBytes(doc.sizeBytes)}</span></div></div>
                      ))}
                    </div>
                    <h3 className="subheading">Detected answer-key sections</h3>
                    {selectedPackage.candidates.length === 0 ? (
                      <div className="inline-empty">No supported answer-key layout was detected in readable text. Scanned pages may require OCR.</div>
                    ) : (
                      selectedPackage.candidates.map((candidate) => (
                        <div className="candidate-card" key={candidate.id}>
                          <div className="candidate-heading"><div><strong>{candidate.paperLabel ? candidate.paperLabel + " · " : ""}{candidate.subject ?? "Answer key"}</strong><span>{candidate.sourceFilename} · PDF page {candidate.sourcePage}</span></div><span className="pill pill-review">{candidate.mappings.length} answers · proposed</span></div>
                          <div className="answer-preview">
                            {candidate.mappings.slice(0, 18).map((mapping) => <span className="answer-chip" key={mapping.questionNumber}><small>Q{mapping.questionNumber}</small><strong>{mapping.answerRaw}</strong></span>)}
                            {candidate.mappings.length > 18 && <span className="more-chip">+{candidate.mappings.length - 18} more</span>}
                          </div>
                          <div className="candidate-foot">Parser: {candidate.extractionMethod} · confidence is a detection heuristic, not answer correctness.</div>
                        </div>
                      ))
                    )}
                    {selectedPackage.warnings.map((warning) => <div className="warning-line" key={warning}><span>!</span>{warning}</div>)}
                    <div className="detail-actions"><button className="button button-primary" onClick={() => setTab("builder")}>Configure a test <ArrowGlyph /></button><span>Full question extraction and answer verification are next.</span></div>
                  </div>
                )}
              </div>
            )}
            <div className="danger-zone"><div><strong>Delete local data</strong><p>Remove every imported package for the current browser profile.</p></div><button className="button button-outline danger-outline" onClick={() => void handleClearData()} disabled={packages.length === 0}>Clear local library</button></div>
          </section>
        )}

        {tab === "builder" && (
          <section className="page-section builder-section">
            <div className="page-heading simple-heading"><div><div className="eyebrow">CUSTOM PRACTICE SESSION</div><h1>Build a test</h1><p>Choose a paper, subjects, question count and your available time.</p></div><span className="coming-tag">Exam runner in development</span></div>
            <div className="builder-layout">
              <div className="panel builder-form">
                <h2>Test configuration</h2>
                <label className="field-label">Question source
                  <select value={selectedPackage?.id ?? ""} onChange={(event) => setSelectedPackageId(event.target.value)} disabled={packages.length === 0}>
                    {packages.length === 0 ? <option value="">Import a paper first</option> : packages.map((item) => <option value={item.id} key={item.id}>{item.title}</option>)}
                  </select>
                </label>
                <div className="field-label">Subjects</div>
                <div className="subject-options">
                  {["PHYSICS", "CHEMISTRY", "MATHS"].map((subject) => <label key={subject} className={subjects.includes(subject) ? "subject-option checked" : "subject-option"}><input type="checkbox" checked={subjects.includes(subject)} onChange={() => toggleSubject(subject)} /><span className={"subject-initial " + subject.toLowerCase().slice(0, 1)}>{subject.slice(0, 1)}</span>{subject === "MATHS" ? "Mathematics" : subject.charAt(0) + subject.slice(1).toLowerCase()}</label>)}
                </div>
                <div className="builder-fields">
                  <label className="field-label">Number of questions<input type="number" min="1" max="180" value={questionCount} onChange={(event) => setQuestionCount(Number(event.target.value))} /></label>
                  <label className="field-label">Time limit (minutes)<input type="number" min="1" max="360" value={durationMinutes} onChange={(event) => setDurationMinutes(Number(event.target.value))} /></label>
                </div>
                <button className="button button-primary button-wide" disabled>Start examination <ArrowGlyph /></button>
                <div className="disabled-reason">The question segmentation and verified question bank are not implemented yet. This form records the intended test configuration; it cannot start a real test yet.</div>
              </div>
              <aside className="panel builder-summary">
                <h3>Session summary</h3>
                <div className="summary-row"><span>Source</span><strong>{selectedPackage?.title ?? "No paper selected"}</strong></div>
                <div className="summary-row"><span>Subjects</span><strong>{subjects.length} selected</strong></div>
                <div className="summary-row"><span>Questions</span><strong>{questionCount || "—"}</strong></div>
                <div className="summary-row"><span>Duration</span><strong>{durationMinutes || "—"} min</strong></div>
                <div className="summary-note"><LockGlyph /> Your test answers and score will be saved locally when the exam runner is available.</div>
              </aside>
            </div>
          </section>
        )}
      </main>

      <footer className="footer">
        <span>JeeCBT <span>·</span> Open-source practice tools</span>
        <span><LockGlyph /> Local-first · No central paper database</span>
      </footer>
    </div>
  );
}

function GoogleGlyph() {
  return <svg viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.76 7.18l7.73 6C44.42 37.95 46.98 31.84 46.98 24.55z"/><path fill="#FBBC05" d="M10.53 28.59a14.4 14.4 0 0 1 0-9.18l-7.98-6.19a23.93 23.93 0 0 0 0 21.56l7.98-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.91-5.8l-7.73-6c-2.14 1.45-4.89 2.3-8.18 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>;
}
function UploadGlyph() { return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5M4 16v3h16v-3" /></svg>; }
function ArrowGlyph() { return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14m-6-6 6 6-6 6" /></svg>; }
function ScanGlyph() { return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8V5a1 1 0 0 1 1-1h3m8 0h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3m-8 0H5a1 1 0 0 1-1-1v-3M4 12h16M8 9v6m8-6v6" /></svg>; }
function LockGlyph() { return <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3" /></svg>; }
function FolderGlyph() { return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6.5A1.5 1.5 0 0 1 4.5 5H10l2 2h7.5A1.5 1.5 0 0 1 21 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5z" /></svg>; }
function FileGlyph() { return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h8l5 5v13H6zM14 3v5h5M9 13h7M9 17h7" /></svg>; }
