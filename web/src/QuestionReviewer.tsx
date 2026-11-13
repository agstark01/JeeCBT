import { useEffect, useMemo, useState } from "react";
import QuestionCapture from "./QuestionCapture";
import type {
  PaperPackage,
  QuestionDraft,
  QuestionSubject,
  QuestionType,
} from "./types";

interface QuestionReviewerProps {
  paperPackage: PaperPackage;
  onBack: () => void;
  onSave: (updated: PaperPackage) => Promise<void>;
}

const subjectOptions: Array<{ value: QuestionSubject; label: string }> = [
  { value: "UNASSIGNED", label: "Unassigned" },
  { value: "PHYSICS", label: "Physics" },
  { value: "CHEMISTRY", label: "Chemistry" },
  { value: "MATHS", label: "Mathematics" },
];

const questionTypeOptions: Array<{ value: QuestionType; label: string }> = [
  { value: "unknown", label: "Not classified" },
  { value: "single_choice", label: "Single correct option" },
  { value: "multiple_choice", label: "Multiple correct options" },
  { value: "numerical", label: "Numerical answer" },
];

function answerReferenceValue(question: QuestionDraft): string {
  return question.answerKeyReference
    ? question.answerKeyReference.candidateId + ":" + question.answerKeyReference.mappingIndex
    : "";
}

function parseAnswerReference(value: string): QuestionDraft["answerKeyReference"] {
  if (!value) return undefined;
  const separator = value.lastIndexOf(":");
  if (separator < 1) return undefined;
  const candidateId = value.slice(0, separator);
  const mappingIndex = Number(value.slice(separator + 1));
  return Number.isInteger(mappingIndex) && mappingIndex >= 0
    ? { candidateId, mappingIndex }
    : undefined;
}

function PdfSourcePreview({
  document,
  pageNumber,
}: {
  document: PaperPackage["documents"][number];
  pageNumber: number;
}) {
  const [url, setUrl] = useState("");

  useEffect(() => {
    const objectUrl = URL.createObjectURL(document.blob);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [document.id, document.blob]);

  if (!url) return <div className="source-preview-empty">Preparing local PDF preview…</div>;

  const pageUrl = url + "#page=" + pageNumber + "&toolbar=0&navpanes=0";
  return (
    <div className="source-preview">
      <iframe title={document.filename + " page " + pageNumber} src={pageUrl} />
      <a href={pageUrl} target="_blank" rel="noreferrer">Open source PDF at page {pageNumber}</a>
    </div>
  );
}

export default function QuestionReviewer({
  paperPackage,
  onBack,
  onSave,
}: QuestionReviewerProps) {
  const questions = paperPackage.questions ?? [];
  const [selectedQuestionId, setSelectedQuestionId] = useState(questions[0]?.id ?? "");
  const [draft, setDraft] = useState<QuestionDraft | null>(questions[0] ? { ...questions[0] } : null);
  const [filter, setFilter] = useState("");
  const [rangeDocumentId, setRangeDocumentId] = useState("");
  const [rangeBlock, setRangeBlock] = useState("all");
  const [rangeStart, setRangeStart] = useState(1);
  const [rangeEnd, setRangeEnd] = useState(25);
  const [rangeSubject, setRangeSubject] = useState<QuestionSubject>("PHYSICS");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!questions.some((question) => question.id === selectedQuestionId)) {
      const first = questions[0];
      setSelectedQuestionId(first?.id ?? "");
      setDraft(first ? { ...first } : null);
    }
  }, [questions, selectedQuestionId]);

  useEffect(() => {
    const firstDocumentId = questions[0]?.sourceDocumentId ?? "";
    setRangeDocumentId((current) =>
      current && questions.some((question) => question.sourceDocumentId === current)
        ? current
        : firstDocumentId,
    );
  }, [questions]);

  const selectedQuestion = useMemo(
    () => questions.find((question) => question.id === selectedQuestionId),
    [questions, selectedQuestionId],
  );

  useEffect(() => {
    if (selectedQuestion) setDraft({ ...selectedQuestion });
  }, [selectedQuestionId, paperPackage.id]);

  const filteredQuestions = useMemo(() => {
    const query = filter.trim().toLowerCase();
    if (!query) return questions;
    return questions.filter((question) =>
      [
        "q" + question.questionNumber,
        question.statementText,
        question.subject,
        question.sourceFilename,
        "block " + question.blockNumber,
      ].some((value) => value.toLowerCase().includes(query)),
    );
  }, [filter, questions]);

  const blockGroups = useMemo(() => {
    const groups = new Map<string, QuestionDraft[]>();
    for (const question of questions) {
      const key = question.sourceDocumentId + ":" + question.blockNumber;
      const group = groups.get(key) ?? [];
      group.push(question);
      groups.set(key, group);
    }
    return [...groups.entries()].map(([key, group]) => ({
      key,
      questions: group,
      sourceDocumentId: group[0].sourceDocumentId,
      blockNumber: group[0].blockNumber,
      minQuestion: Math.min(...group.map((question) => question.questionNumber)),
      maxQuestion: Math.max(...group.map((question) => question.questionNumber)),
    }));
  }, [questions]);

  const sourceDocuments = useMemo(() => {
    const ids = new Set(questions.map((question) => question.sourceDocumentId));
    return paperPackage.documents.filter((document) => ids.has(document.id));
  }, [paperPackage.documents, questions]);

  const statusCounts = useMemo(
    () => ({
      needsReview: questions.filter((question) => question.status === "needs_review").length,
      verified: questions.filter((question) => question.status === "verified").length,
      rejected: questions.filter((question) => question.status === "rejected").length,
    }),
    [questions],
  );

  const answerKeyOptions = useMemo(() => {
    if (!draft) return [];
    return paperPackage.candidates.flatMap((candidate) =>
      candidate.mappings.flatMap((mapping, mappingIndex) => {
        if (mapping.questionNumber !== draft.questionNumber) return [];
        if (
          draft.subject !== "UNASSIGNED" &&
          candidate.subject &&
          candidate.subject !== draft.subject &&
          !(candidate.subject === "MATHEMATICS" && draft.subject === "MATHS")
        ) {
          return [];
        }
        const label = [
          candidate.paperLabel,
          candidate.subject,
          candidate.sourceFilename + " p." + candidate.sourcePage,
          "answer " + mapping.answerRaw,
          "unverified",
        ].filter(Boolean).join(" · ");
        return [{
          value: candidate.id + ":" + mappingIndex,
          label,
        }];
      }),
    );
  }, [draft?.questionNumber, draft?.subject, paperPackage.candidates]);

  const updateDraft = <K extends keyof QuestionDraft>(
    key: K,
    value: QuestionDraft[K],
  ) => {
    setDraft((current) => {
      if (!current) return current;
      const next = {
        ...current,
        [key]: value,
        status: "needs_review" as const,
      };
      if (key === "questionNumber" || key === "subject") {
        next.answerKeyReference = undefined;
      }
      if (key === "questionType") {
        next.questionTypeInference = {
          source: "manual",
          evidence: "Set manually in the question reviewer.",
          confidence: 1,
        };
      }
      return next;
    });
  };

  const persistQuestions = async (nextQuestions: QuestionDraft[]) => {
    setSaving(true);
    setMessage("");
    try {
      await onSave({ ...paperPackage, questions: nextQuestions });
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : "Unable to save the reviewed questions locally.");
      throw caught;
    } finally {
      setSaving(false);
    }
  };

  const saveCurrentDraft = async (status?: QuestionDraft["status"]) => {
    if (!draft) return;
    const nextDraft: QuestionDraft = {
      ...draft,
      status: status ?? (selectedQuestion?.status === "verified" ? "needs_review" : draft.status),
    };
    try {
      await persistQuestions(
        questions.map((question) => question.id === nextDraft.id ? nextDraft : question),
      );
      setDraft(nextDraft);
      setMessage(
        status === "verified"
          ? "Question text and metadata marked verified. Its answer-key mapping remains a separate unverified item."
          : status === "rejected"
            ? "Question marked as rejected."
            : "Question changes saved in this browser.",
      );
    } catch {
      // persistQuestions already reports the storage error.
    }
  };

  const applyBlockSubject = async (
    sourceDocumentId: string,
    blockNumber: number,
    subject: QuestionSubject,
  ) => {
    const nextQuestions = questions.map((question) =>
      question.sourceDocumentId === sourceDocumentId && question.blockNumber === blockNumber
        ? { ...question, subject, answerKeyReference: undefined, status: "needs_review" as const }
        : question,
    );
    try {
      await persistQuestions(nextQuestions);
      if (draft?.sourceDocumentId === sourceDocumentId && draft.blockNumber === blockNumber) {
        setDraft({ ...draft, subject, status: "needs_review" });
      }
      setMessage("Subject assigned to all questions in that numbering block.");
    } catch {
      // persistQuestions already reports the storage error.
    }
  };

  const applyRangeSubject = async () => {
    if (!Number.isInteger(rangeStart) || !Number.isInteger(rangeEnd) || rangeStart < 1 || rangeEnd < rangeStart) {
      setMessage("Enter a valid inclusive question-number range.");
      return;
    }
    const matching = questions.filter((question) =>
      question.sourceDocumentId === rangeDocumentId &&
      (rangeBlock === "all" || question.blockNumber === Number(rangeBlock)) &&
      question.questionNumber >= rangeStart &&
      question.questionNumber <= rangeEnd,
    );
    if (matching.length === 0) {
      setMessage("No questions matched that document, block and question-number range.");
      return;
    }
    const matchedIds = new Set(matching.map((question) => question.id));
    const nextQuestions = questions.map((question) =>
      matchedIds.has(question.id)
        ? { ...question, subject: rangeSubject, answerKeyReference: undefined, status: "needs_review" as const }
        : question,
    );
    try {
      await persistQuestions(nextQuestions);
      if (draft && matchedIds.has(draft.id)) {
        setDraft({ ...draft, subject: rangeSubject, status: "needs_review" });
      }
      setMessage("Assigned " + matching.length + " question(s) to " + rangeSubject + ".");
    } catch {
      // persistQuestions already reports the storage error.
    }
  };

  const hasUnsavedChanges = () =>
    Boolean(draft && selectedQuestion && JSON.stringify(draft) !== JSON.stringify(selectedQuestion));

  const selectQuestion = (question: QuestionDraft) => {
    if (hasUnsavedChanges() && !window.confirm("Discard unsaved changes to this question?")) {
      return;
    }
    setSelectedQuestionId(question.id);
    setDraft({ ...question });
    setMessage("");
  };

  const handleBack = () => {
    if (hasUnsavedChanges() && !window.confirm("Discard unsaved changes before returning to the library?")) {
      return;
    }
    onBack();
  };

  const documentForDraft = draft
    ? paperPackage.documents.find((document) => document.id === draft.sourceDocumentId)
    : undefined;

  const dirty = hasUnsavedChanges();
  const canVerify = Boolean(
    draft &&
    Number.isInteger(draft.questionNumber) &&
    draft.questionNumber > 0 &&
    draft.statementText.trim() &&
    draft.subject !== "UNASSIGNED",
  );

  return (
    <section className="page-section review-section">
      <div className="page-heading simple-heading">
        <div>
          <div className="eyebrow">QUESTION BANK REVIEW</div>
          <h1>Review detected questions</h1>
          <p>{paperPackage.title} · {questions.length} detected question(s)</p>
        </div>
        <button className="button button-outline" onClick={handleBack}>Back to library</button>
      </div>

      <div className="review-stats">
        <div><strong>{questions.length}</strong><span>Detected</span></div>
        <div><strong>{statusCounts.needsReview}</strong><span>Needs review</span></div>
        <div><strong>{statusCounts.verified}</strong><span>Question verified</span></div>
        <div><strong>{statusCounts.rejected}</strong><span>Rejected</span></div>
      </div>

      {paperPackage.questionSegmentationWarnings?.map((warning) => (
        <div className="warning-line" key={warning}><span>!</span>{warning}</div>
      ))}

      <div className="review-bulk panel">
        <div className="review-panel-title">
          <div><strong>Assign subjects in bulk</strong><span>Useful when a paper has one continuous numbering sequence or repeated subject blocks.</span></div>
        </div>
        {blockGroups.length > 0 && (
          <div className="block-assignment-list">
            {blockGroups.map((group) => {
              const documentName = paperPackage.documents.find((document) => document.id === group.sourceDocumentId)?.filename ?? "Source PDF";
              return (
                <div className="block-assignment" key={group.key}>
                  <div><strong>{documentName}</strong><small>Block {group.blockNumber} · Q{group.minQuestion}–Q{group.maxQuestion} · {group.questions.length} question(s)</small></div>
                  <select
                    aria-label={"Assign subject to block " + group.blockNumber}
                    value={group.questions.every((question) => question.subject === group.questions[0].subject)
                      ? group.questions[0].subject
                      : "UNASSIGNED"}
                    onChange={(event) => {
                      void applyBlockSubject(group.sourceDocumentId, group.blockNumber, event.target.value as QuestionSubject);
                    }}
                    disabled={saving}
                  >
                    {subjectOptions.map((subject) => <option key={subject.value} value={subject.value}>{subject.label}</option>)}
                  </select>
                </div>
              );
            })}
          </div>
        )}
        {sourceDocuments.length > 0 && (
          <div className="range-assignment">
            <div className="range-heading">Or assign a question-number range</div>
            <div className="range-fields">
              <label>Source PDF
                <select value={rangeDocumentId} onChange={(event) => { setRangeDocumentId(event.target.value); setRangeBlock("all"); }}>
                  {sourceDocuments.map((document) => <option key={document.id} value={document.id}>{document.filename}</option>)}
                </select>
              </label>
              <label>Block
                <select value={rangeBlock} onChange={(event) => setRangeBlock(event.target.value)}>
                  <option value="all">All blocks</option>
                  {blockGroups.filter((group) => group.sourceDocumentId === rangeDocumentId).map((group) => (
                    <option key={group.key} value={String(group.blockNumber)}>Block {group.blockNumber}</option>
                  ))}
                </select>
              </label>
              <label>From Q<input type="number" min="1" value={rangeStart} onChange={(event) => setRangeStart(Number(event.target.value))} /></label>
              <label>To Q<input type="number" min="1" value={rangeEnd} onChange={(event) => setRangeEnd(Number(event.target.value))} /></label>
              <label>Subject
                <select value={rangeSubject} onChange={(event) => setRangeSubject(event.target.value as QuestionSubject)}>
                  {subjectOptions.filter((subject) => subject.value !== "UNASSIGNED").map((subject) => <option key={subject.value} value={subject.value}>{subject.label}</option>)}
                </select>
              </label>
              <button className="button button-outline" onClick={() => void applyRangeSubject()} disabled={saving || !rangeDocumentId}>Apply range</button>
            </div>
            <small>When question numbers repeat in different blocks, select a specific block before applying a range.</small>
          </div>
        )}
      </div>

      <div className="review-layout">
        <aside className="panel review-question-panel">
          <div className="review-list-heading"><strong>Questions</strong><span>{filteredQuestions.length} shown</span></div>
          <input className="review-search" value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Filter by number, subject or text…" />
          <div className="review-question-list">
            {filteredQuestions.map((question) => (
              <button
                type="button"
                key={question.id}
                className={selectedQuestionId === question.id ? "review-question-item active" : "review-question-item"}
                onClick={() => selectQuestion(question)}
              >
                <span className="review-question-number">Q{question.questionNumber}</span>
                <span className="review-question-copy">
                  <strong>{question.subject === "UNASSIGNED" ? "Subject unassigned" : question.subject}</strong>
                  <small>Block {question.blockNumber} · PDF p.{question.sourcePageStart}{question.sourcePageEnd > question.sourcePageStart ? "–" + question.sourcePageEnd : ""}</small>
                  <small>{question.statementText.slice(0, 85) || "No selectable text found"}</small>
                </span>
                <span className={"review-status-dot " + question.status} title={question.status} />
              </button>
            ))}
            {filteredQuestions.length === 0 && <div className="inline-empty">No questions match this filter.</div>}
          </div>
        </aside>

        <div className="review-workspace">
          <div className="panel review-editor">
            {!draft ? (
              <div className="inline-empty">No question is selected.</div>
            ) : (
              <>
                <div className="review-editor-heading">
                  <div><div className="eyebrow">QUESTION METADATA</div><h2>Q{draft.questionNumber}</h2></div>
                  <span className={"pill " + (draft.status === "verified" ? "pill-success" : draft.status === "rejected" ? "pill-warning" : "pill-review")}>{draft.status.replace("_", " ")}</span>
                </div>
                <div className="review-fields">
                  <label>Question number
                    <input type="number" min="1" value={draft.questionNumber} onChange={(event) => updateDraft("questionNumber", Number(event.target.value))} />
                  </label>
                  <label>Subject
                    <select value={draft.subject} onChange={(event) => updateDraft("subject", event.target.value as QuestionSubject)}>
                      {subjectOptions.map((subject) => <option key={subject.value} value={subject.value}>{subject.label}</option>)}
                    </select>
                  </label>
                  <label>Question type
                    <select value={draft.questionType} onChange={(event) => updateDraft("questionType", event.target.value as QuestionType)}>
                      {questionTypeOptions.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}
                    </select>
                  </label>
                  <label>Numbering block
                    <input value={"Block " + draft.blockNumber} readOnly />
                  </label>
                </div>
                {draft.questionTypeInference && (
                  <div className="question-inference-note">
                    <strong>Classification: {draft.questionTypeInference.source.replace("_", " ")}</strong>
                    <span>{draft.questionTypeInference.evidence}</span>
                    <small>Confidence {Math.round(draft.questionTypeInference.confidence * 100)}%</small>
                    {draft.correctMarks !== undefined && <small>Correct: +{draft.correctMarks} marks</small>}
                    {draft.incorrectMarks !== undefined && <small>Incorrect: {draft.incorrectMarks} marks</small>}
                  </div>
                )}
                <label className="review-text-label">Extracted question text
                  <textarea value={draft.statementText} onChange={(event) => updateDraft("statementText", event.target.value)} rows={12} />
                </label>
                <label className="review-answer-label">Matching answer-key entry
                  <select
                    value={answerReferenceValue(draft)}
                    onChange={(event) => updateDraft("answerKeyReference", parseAnswerReference(event.target.value))}
                  >
                    <option value="">No answer-key entry linked</option>
                    {answerKeyOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </select>
                  <small>Only entries with the same question number are shown. These are proposed mappings and are not verified answers.</small>
                </label>
                <div className="review-provenance">
                  <strong>Source provenance</strong>
                  <span>{draft.sourceFilename}</span>
                  <span>PDF page {draft.sourcePageStart}{draft.sourcePageEnd > draft.sourcePageStart ? " to " + draft.sourcePageEnd : ""}</span>
                  {draft.sectionLabel && <span>{draft.sectionLabel}</span>}
                </div>
                {message && <div className="review-message" role="status">{message}</div>}
                <div className="review-actions">
                  <button className="button button-outline" onClick={() => void saveCurrentDraft()} disabled={!dirty || saving}>Save changes</button>
                  <button className="button button-primary" onClick={() => void saveCurrentDraft("verified")} disabled={!canVerify || saving}>Mark question verified</button>
                  <button className="text-button danger-text" onClick={() => void saveCurrentDraft("rejected")} disabled={saving}>Reject question</button>
                </div>
                <small className="review-verification-note">“Question verified” confirms the extracted question text and metadata only. The linked answer-key entry remains unverified and must be checked separately before scoring.</small>
              </>
            )}
          </div>
          {documentForDraft && draft && (
            <>
              <div className="panel review-capture-panel">
                <div className="review-panel-title">
                  <div><strong>Detected question capture</strong><span>Rendered from the original local PDF. Diagrams, options and page formatting remain intact.</span></div>
                </div>
                <QuestionCapture
                  document={documentForDraft}
                  regions={draft.sourceRegions ?? []}
                  questionNumber={draft.questionNumber}
                />
              </div>
              <div className="panel review-source-panel">
                <div className="review-panel-title"><div><strong>Original PDF source</strong><span>{documentForDraft.filename} · page {draft.sourcePageStart}</span></div></div>
                <PdfSourcePreview document={documentForDraft} pageNumber={draft.sourcePageStart} />
              </div>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
