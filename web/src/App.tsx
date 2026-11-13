import { useEffect, useMemo, useRef, useState } from "react";
import {
  mountGoogleSignInButton,
  type GoogleLocalProfile,
} from "./lib/google-identity";
import {
  clearLocalData,
  deletePaperPackage,
  listPaperPackages,
  moveGuestPackagesToAccount,
  savePaperPackage,
} from "./lib/db";
import { discoverAnswerKeys } from "./lib/answer-discovery";
import { extractPdfLocally } from "./lib/pdf";
import QuestionReviewer from "./QuestionReviewer";
import AnswerKeyReviewer from "./AnswerKeyReviewer";
import { segmentQuestions } from "./lib/question-segmentation";
import {
  getQuestionTotal,
  TEST_SUBJECTS,
  validateTestDraft,
  type SubjectQuestionCounts,
  type TestSubject,
} from "./lib/test-builder";
import type {
  AnswerKeyCandidate,
  DocumentRole,
  PaperPackage,
} from "./types";

type Tab = "import" | "library" | "builder" | "review" | "answers";

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

function getStoredGoogleProfile(): GoogleLocalProfile | null {
  try {
    const value = localStorage.getItem("jeecbt.google-profile");
    if (!value) return null;
    const parsed = JSON.parse(value) as Partial<GoogleLocalProfile>;
    return typeof parsed.sub === "string" && parsed.sub.length > 0
      ? {
          sub: parsed.sub,
          name: typeof parsed.name === "string" ? parsed.name : undefined,
          email: typeof parsed.email === "string" ? parsed.email : undefined,
          picture: typeof parsed.picture === "string" ? parsed.picture : undefined,
        }
      : null;
  } catch {
    return null;
  }
}

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID ?? "";

export default function App() {
  const [user, setUser] = useState<GoogleLocalProfile | null>(getStoredGoogleProfile);
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
  const [reviewPackageId, setReviewPackageId] = useState("");
  const [selectedSourcePackageIds, setSelectedSourcePackageIds] = useState<string[]>([]);
  const [subjects, setSubjects] = useState<TestSubject[]>([...TEST_SUBJECTS]);
  const [subjectQuestionCounts, setSubjectQuestionCounts] = useState<SubjectQuestionCounts>({
    PHYSICS: 10,
    CHEMISTRY: 10,
    MATHS: 10,
  });
  const [durationMinutes, setDurationMinutes] = useState(60);
  const [shuffleQuestions, setShuffleQuestions] = useState(true);
  const fileInput = useRef<HTMLInputElement>(null);
  const googleButton = useRef<HTMLDivElement>(null);

  const ownerId = user?.sub ?? "local";
  const selectedPackage = useMemo(
    () => packages.find((item) => item.id === selectedPackageId) ?? packages[0],
    [packages, selectedPackageId],
  );
  const selectedSourcePackages = useMemo(
    () => packages.filter((item) => selectedSourcePackageIds.includes(item.id)),
    [packages, selectedSourcePackageIds],
  );
  const reviewPackage = useMemo(
    () => packages.find((item) => item.id === reviewPackageId),
    [packages, reviewPackageId],
  );
  const activeQuestionCounts = useMemo(
    () =>
      Object.fromEntries(
        TEST_SUBJECTS.map((subject) => [
          subject,
          subjects.includes(subject) ? subjectQuestionCounts[subject] : 0,
        ]),
      ) as SubjectQuestionCounts,
    [subjects, subjectQuestionCounts],
  );
  const requestedQuestionTotal = getQuestionTotal(activeQuestionCounts);
  const configurationErrors = validateTestDraft({
    sourcePackageIds: selectedSourcePackageIds,
    questionCounts: activeQuestionCounts,
    durationMinutes,
    shuffleQuestions,
  });

  useEffect(() => {
    const element = googleButton.current;
    if (!element || user || !GOOGLE_CLIENT_ID) return;

    let cancelled = false;
    let cleanup: (() => void) | undefined;
    void mountGoogleSignInButton(
      element,
      GOOGLE_CLIENT_ID,
      async (profile) => {
        if (cancelled) return;
        try {
          await moveGuestPackagesToAccount(profile.sub);
          localStorage.setItem("jeecbt.google-profile", JSON.stringify(profile));
          setUser(profile);
          setError("");
          setNotice("Signed in with Google. Your papers and attempts remain on this device.");
        } catch {
          setError("Google sign-in succeeded, but the local profile could not be opened.");
        }
      },
      (signInError) => {
        if (!cancelled) setError(signInError.message);
      },
    )
      .then((dispose) => {
        cleanup = dispose;
        if (cancelled) dispose();
      })
      .catch((signInError: unknown) => {
        if (!cancelled) {
          setError(signInError instanceof Error ? signInError.message : "Google sign-in could not be initialized.");
        }
      });

    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, [user?.sub]);

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
          setSelectedSourcePackageIds((current) => {
            const valid = current.filter((id) => items.some((item) => item.id === id));
            return valid.length > 0 ? valid : items[0] ? [items[0].id] : [];
          });
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
    const existing = new Set(pendingFiles.map((item) => item.file.name + ":" + item.file.size));
    const unique = pdfs.filter((file) => !existing.has(file.name + ":" + file.size));
    const additions = unique.slice(0, Math.max(0, 10 - pendingFiles.length));
    if (additions.length < unique.length) {
      setNotice("A paper package can contain at most 10 PDF files.");
    }
    setPendingFiles((current) => [
      ...current,
      ...additions.map((file) => ({ file, role: guessRole(file.name) })),
    ]);
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
    const extracted: import("./types").ExtractedDocument[] = [];
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
      setSelectedSourcePackageIds((current) =>
        current.includes(record.id) ? current : [...current, record.id],
      );
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
    setSelectedSourcePackageIds((current) => current.filter((packageId) => packageId !== id));
    if (selectedPackageId === id) setSelectedPackageId(refreshed[0]?.id ?? "");
    if (reviewPackageId === id) {
      setReviewPackageId("");
      setTab("library");
    }
    setNotice("The imported paper package was deleted from this browser.");
  };

  const segmentPackageQuestions = async (packageId: string) => {
    const source = packages.find((item) => item.id === packageId);
    if (!source) return;
    if (source.questions?.length && !window.confirm(
      "Run segmentation again? This replaces the current question drafts and discards their manual review edits.",
    )) return;

    setError("");
    setNotice("");
    try {
      const result = segmentQuestions(source.documents);
      const updated: PaperPackage = {
        ...source,
        questions: result.questions,
        questionRules: result.rules,
        questionSegmentationWarnings: result.warnings,
        questionSegmentationAt: Date.now(),
      };
      await savePaperPackage(updated);
      setPackages((current) => current.map((item) => item.id === updated.id ? updated : item));
      setReviewPackageId(updated.id);
      setTab("review");
      if (result.questions.length === 0) {
        setNotice("No question markers were detected. Check document roles and the source PDF.");
      } else {
        setNotice("Detected " + result.questions.length + " draft question(s). Review the text, subject and answer-key association before using them.");
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to segment questions locally.");
    }
  };

  const saveReviewedPackage = async (updated: PaperPackage) => {
    await savePaperPackage(updated);
    setPackages((current) => current.map((item) => item.id === updated.id ? updated : item));
  };

  const handleClearData = async () => {
    const confirmed = window.confirm(
      "Delete all JeeCBT paper packages and extracted data for this browser profile? This cannot be undone.",
    );
    if (!confirmed) return;
    await clearLocalData(ownerId);
    setPackages([]);
    setSelectedPackageId("");
    setReviewPackageId("");
    setSelectedSourcePackageIds([]);
    setNotice("Local JeeCBT data for this profile has been deleted.");
  };

  const handleGoogleSignOut = () => {
    localStorage.removeItem("jeecbt.google-profile");
    setUser(null);
    setNotice("Signed out of JeeCBT. Your local paper data has not been deleted.");
  };

  const toggleSubject = (subject: TestSubject) => {
    setSubjects((current) =>
      current.includes(subject)
        ? current.filter((item) => item !== subject)
        : [...current, subject],
    );
  };

  const toggleSourcePackage = (packageId: string) => {
    setSelectedSourcePackageIds((current) =>
      current.includes(packageId)
        ? current.filter((id) => id !== packageId)
        : [...current, packageId],
    );
  };

  const updateSubjectQuestionCount = (subject: TestSubject, count: number) => {
    setSubjectQuestionCounts((current) => ({ ...current, [subject]: count }));
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
          {tab === "review" && <button className="nav-link active" onClick={() => setTab("review")}>Review questions</button>}
          {tab === "answers" && <button className="nav-link active" onClick={() => setTab("answers")}>Review answer keys</button>}
        </nav>
        <div className="account-area">
          {user ? (
            <>
              <span className="user-chip" title={user.email ?? user.name ?? "Google profile"}>
                {user.picture ? <img src={user.picture} alt="" /> : <span className="avatar-fallback">{(user.name ?? user.email ?? "U").slice(0, 1).toUpperCase()}</span>}
                <span>{user.name ?? user.email ?? "Google profile"}</span>
              </span>
              <button className="button button-quiet button-small" onClick={handleGoogleSignOut}>Sign out</button>
            </>
          ) : GOOGLE_CLIENT_ID ? (
            <div className="google-signin-slot" ref={googleButton} />
          ) : (
            <button className="button button-outline button-small" disabled title="Set VITE_GOOGLE_CLIENT_ID in web/.env.local">
              <GoogleGlyph /> Google sign-in setup
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
                <p>Import one question paper per package. Include its separate answer-key PDFs in the same import, then repeat for each paper you want to combine.</p>
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
                  <p>Choose one question paper with its associated answer key or keys. Import each additional paper as a separate package.</p>
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
                    <div className="detail-actions">
                      <button className="button button-primary" onClick={() => void segmentPackageQuestions(selectedPackage.id)}>
                        {selectedPackage.questions?.length ? "Re-run segmentation" : "Segment questions"} <ArrowGlyph />
                      </button>
                      {selectedPackage.questions?.length ? (
                        <button className="button button-outline" onClick={() => { setReviewPackageId(selectedPackage.id); setTab("review"); }}>
                          Review {selectedPackage.questions.length} questions
                        </button>
                      ) : null}
                      <button className="button button-outline" onClick={() => { setReviewPackageId(selectedPackage.id); setTab("answers"); }}>
                        Review answer keys · {selectedPackage.candidates.reduce((sum, item) => sum + item.mappings.length, 0)}
                      </button>
                      <button className="button button-outline" onClick={() => setTab("builder")}>Configure a test</button>
                    </div>
                    {selectedPackage.questions?.length ? (
                      <div className="review-readiness-note">
                        {selectedPackage.questions.filter((question) => question.status === "verified").length} question(s) marked verified · {selectedPackage.questions.filter((question) => question.subject === "UNASSIGNED").length} still need a subject
                      </div>
                    ) : null}
                  </div>
                )}
              </div>
            )}
            <div className="danger-zone"><div><strong>Delete local data</strong><p>Remove every imported package for the current browser profile.</p></div><button className="button button-outline danger-outline" onClick={() => void handleClearData()} disabled={packages.length === 0}>Clear local library</button></div>
          </section>
        )}

        {tab === "review" && reviewPackage && (
          <QuestionReviewer
            key={reviewPackage.id}
            paperPackage={reviewPackage}
            onBack={() => setTab("library")}
            onSave={saveReviewedPackage}
          />
        )}

        {tab === "answers" && reviewPackage && (
          <AnswerKeyReviewer
            key={reviewPackage.id}
            paperPackage={reviewPackage}
            onBack={() => setTab("library")}
            onSave={saveReviewedPackage}
          />
        )}

        {tab === "builder" && (
          <section className="page-section builder-section">
            <div className="page-heading simple-heading">
              <div>
                <div className="eyebrow">CUSTOM PRACTICE SESSION</div>
                <h1>Build a mixed-paper test</h1>
                <p>Combine papers from your library, set a subject-wise question quota and choose your time limit.</p>
              </div>
              <span className="coming-tag">Question bank in development</span>
            </div>
            <div className="builder-layout">
              <div className="panel builder-form">
                <div className="builder-config-group">
                  <div className="builder-group-heading">
                    <span>01</span>
                    <div><h2>Choose source papers</h2><p>Select multiple imported papers. Each package keeps its own answer-key candidates attached.</p></div>
                  </div>
                  {packages.length === 0 ? (
                    <div className="inline-empty">Your library is empty. Import one or more question papers first.</div>
                  ) : (
                    <div className="source-options">
                      {packages.map((item) => {
                        const mappingTotal = item.candidates.reduce(
                          (sum, candidate) => sum + mappingCount(candidate),
                          0,
                        );
                        const keySummary = item.answerKeyStatus === "detected_needs_review"
                          ? mappingTotal + " proposed answer mappings · verification required"
                          : item.answerKeyStatus === "needs_ocr"
                            ? "Some pages need OCR"
                            : "No supported answer key detected";
                        return (
                          <label
                            key={item.id}
                            className={selectedSourcePackageIds.includes(item.id) ? "source-option selected" : "source-option"}
                          >
                            <input
                              type="checkbox"
                              checked={selectedSourcePackageIds.includes(item.id)}
                              onChange={() => toggleSourcePackage(item.id)}
                            />
                            <span className="source-option-copy">
                              <strong>{item.title}</strong>
                              <small>{item.examProfile.replace("_", " ").toUpperCase()} · {item.documents.length} PDF(s)</small>
                              <small>{keySummary}</small>
                            </span>
                            <span className="source-check" aria-hidden="true">{selectedSourcePackageIds.includes(item.id) ? "✓" : ""}</span>
                          </label>
                        );
                      })}
                    </div>
                  )}
                  <p className="builder-helper">
                    Answer keys are never shared between papers. For example, Q1 in one paper remains a different question from Q1 in another paper.
                  </p>
                </div>

                <div className="builder-config-group">
                  <div className="builder-group-heading">
                    <span>02</span>
                    <div><h2>Set question count by subject</h2><p>Choose the subjects and the exact number of questions to draw from each.</p></div>
                  </div>
                  <div className="subject-options">
                    {TEST_SUBJECTS.map((subject) => {
                      const checked = subjects.includes(subject);
                      const subjectName = subject === "MATHS" ? "Mathematics" : subject.charAt(0) + subject.slice(1).toLowerCase();
                      return (
                        <div className={checked ? "subject-config-card checked" : "subject-config-card"} key={subject}>
                          <label className="subject-option">
                            <input type="checkbox" checked={checked} onChange={() => toggleSubject(subject)} />
                            <span className={"subject-initial " + subject.toLowerCase().slice(0, 1)}>{subject.slice(0, 1)}</span>
                            <span>{subjectName}</span>
                          </label>
                          <label className="subject-count-label">
                            Questions
                            <input
                              className="subject-count-input"
                              type="number"
                              min="1"
                              max="180"
                              step="1"
                              value={subjectQuestionCounts[subject]}
                              disabled={!checked}
                              onChange={(event) => updateSubjectQuestionCount(subject, Number(event.target.value))}
                              aria-label={subjectName + " question count"}
                            />
                          </label>
                        </div>
                      );
                    })}
                  </div>
                  <div className="requested-total"><span>Total questions in this test</span><strong>{requestedQuestionTotal}</strong></div>
                </div>

                <div className="builder-config-group">
                  <div className="builder-group-heading">
                    <span>03</span>
                    <div><h2>Exam settings</h2><p>Set your available time and choose how questions are selected and ordered.</p></div>
                  </div>
                  <div className="builder-fields">
                    <label className="field-label">Time limit (minutes)
                      <input
                        type="number"
                        min="1"
                        max="360"
                        step="1"
                        value={durationMinutes}
                        onChange={(event) => setDurationMinutes(Number(event.target.value))}
                      />
                    </label>
                    <label className="shuffle-option">
                      <input
                        type="checkbox"
                        checked={shuffleQuestions}
                        onChange={(event) => setShuffleQuestions(event.target.checked)}
                      />
                      <span><strong>Shuffle questions</strong><small>Randomly select questions from the combined eligible pool, without duplicates.</small></span>
                    </label>
                  </div>
                  <div className="builder-validation">
                    {configurationErrors.length === 0
                      ? "Configuration is valid. The selected question bank still needs segmentation and answer verification."
                      : configurationErrors.join(" ")}
                  </div>
                </div>

                <button className="button button-primary button-wide" disabled>
                  Start examination <ArrowGlyph />
                </button>
                <div className="disabled-reason">
                  The current importer extracts answer-key candidates, not complete question records. The exam cannot start until questions are segmented, reviewed and linked to the correct paper-specific answer key.
                </div>
              </div>

              <aside className="panel builder-summary">
                <h3>Session summary</h3>
                <div className="summary-row">
                  <span>Source papers</span>
                  <strong>{selectedSourcePackages.length} selected</strong>
                </div>
                <div className="summary-source-list">
                  {selectedSourcePackages.length === 0
                    ? <span className="summary-muted">No source paper selected</span>
                    : selectedSourcePackages.map((item) => (
                      <div className="summary-source" key={item.id}>
                        <strong>{item.title}</strong>
                        <span>{item.candidates.length} answer-key candidate(s) · {item.candidates.reduce((sum, candidate) => sum + mappingCount(candidate), 0)} proposed mapping(s)</span>
                      </div>
                    ))}
                </div>
                <div className="summary-row"><span>Physics</span><strong>{subjects.includes("PHYSICS") ? subjectQuestionCounts.PHYSICS : 0}</strong></div>
                <div className="summary-row"><span>Chemistry</span><strong>{subjects.includes("CHEMISTRY") ? subjectQuestionCounts.CHEMISTRY : 0}</strong></div>
                <div className="summary-row"><span>Mathematics</span><strong>{subjects.includes("MATHS") ? subjectQuestionCounts.MATHS : 0}</strong></div>
                <div className="summary-row"><span>Total questions</span><strong>{requestedQuestionTotal}</strong></div>
                <div className="summary-row"><span>Duration</span><strong>{durationMinutes || "—"} min</strong></div>
                <div className="summary-row"><span>Selection order</span><strong>{shuffleQuestions ? "Random shuffle" : "Source order"}</strong></div>
                <div className="summary-note"><LockGlyph /> Your papers and corresponding answer-key records remain local. Actual question sampling will use verified records from these selected packages.</div>
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
