import { useEffect, useMemo, useState } from "react";
import {
  canVerifyAnswerMapping,
  evaluateAnswerMapping,
  setMappingReviewStatus,
  updateMappingAnswer,
} from "./lib/answer-review";
import type { AnswerKeyCandidate, AnswerMapping, PaperPackage, QuestionDraft, Subject } from "./types";

interface AnswerKeyReviewerProps {
  paperPackage: PaperPackage;
  onBack: () => void;
  onSave: (updated: PaperPackage) => Promise<void>;
}

const subjectOptions: Array<{ value: Subject | ""; label: string }> = [
  { value: "", label: "Use detected / unspecified subject" },
  { value: "PHYSICS", label: "Physics" },
  { value: "CHEMISTRY", label: "Chemistry" },
  { value: "MATHS", label: "Mathematics" },
];


function normalizeLegacyPackage(paperPackage: PaperPackage): PaperPackage {
  const questionDocuments = paperPackage.documents.filter((document) => document.role === "question_paper");
  return {
    ...paperPackage,
    candidates: paperPackage.candidates.map((candidate) => {
      const sourceMatches = paperPackage.documents.filter((document) =>
        document.filename === candidate.sourceFilename &&
        document.pageCount >= candidate.sourcePage,
      );
      const sourceDocumentId = candidate.sourceDocumentId ??
        (sourceMatches.length === 1 ? sourceMatches[0].id : undefined);
      const sourceIsQuestionPaper = questionDocuments.some((document) => document.id === sourceDocumentId);
      const targetDocumentId = candidate.targetDocumentId ??
        (sourceIsQuestionPaper
          ? sourceDocumentId
          : questionDocuments.length === 1
            ? questionDocuments[0].id
            : undefined);
      return {
        ...candidate,
        sourceDocumentId,
        targetDocumentId,
        mappings: candidate.mappings.map((mapping, index) => ({
          ...mapping,
          id: mapping.id ?? candidate.id + "-mapping-" + index,
          sourceDocumentId: mapping.sourceDocumentId ?? sourceDocumentId,
        })),
      };
    }),
  };
}

function AnswerKeyPdfPreview({
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
  if (!url) return <div className="source-preview-empty">Preparing local key PDF preview…</div>;
  const pageUrl = url + "#page=" + pageNumber + "&toolbar=0&navpanes=0";
  return (
    <div className="source-preview answer-key-source-preview">
      <iframe title={document.filename + " answer key page " + pageNumber} src={pageUrl} />
      <a href={pageUrl} target="_blank" rel="noreferrer">Open answer-key source page {pageNumber}</a>
    </div>
  );
}

function mappingStatusLabel(status: AnswerMapping["reviewStatus"]): string {
  return status === "verified" ? "Verified key" : status === "rejected" ? "Rejected" : "Needs review";
}

function matchLabel(status: ReturnType<typeof evaluateAnswerMapping>["status"]): string {
  return status === "matched" ? "Question matched" :
    status === "ambiguous" ? "Ambiguous match" :
      status === "mismatched" ? "Metadata mismatch" : "Question missing";
}

export default function AnswerKeyReviewer({
  paperPackage,
  onBack,
  onSave,
}: AnswerKeyReviewerProps) {
  const [draftPackage, setDraftPackage] = useState<PaperPackage>(() => normalizeLegacyPackage(paperPackage));
  const [filter, setFilter] = useState("");
  const [candidateFilter, setCandidateFilter] = useState("all");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [dirty, setDirty] = useState(false);

  const questionDocuments = useMemo(
    () => draftPackage.documents.filter((document) => document.role === "question_paper"),
    [draftPackage.documents],
  );

  const totals = useMemo(() => {
    const mappings = draftPackage.candidates.flatMap((candidate) =>
      candidate.mappings.map((mapping) => ({ candidate, mapping })),
    );
    return {
      total: mappings.length,
      verified: mappings.filter(({ mapping }) => mapping.reviewStatus === "verified").length,
      rejected: mappings.filter(({ mapping }) => mapping.reviewStatus === "rejected").length,
      proposed: mappings.filter(({ mapping }) => mapping.reviewStatus === "proposed").length,
      ambiguous: mappings.filter(({ candidate, mapping }) =>
        evaluateAnswerMapping(draftPackage, candidate, mapping).status === "ambiguous",
      ).length,
    };
  }, [draftPackage]);

  const updateCandidate = (
    candidateId: string,
    updater: (candidate: AnswerKeyCandidate) => AnswerKeyCandidate,
  ) => {
    setDraftPackage((current) => ({
      ...current,
      candidates: current.candidates.map((candidate) =>
        candidate.id === candidateId ? updater(candidate) : candidate,
      ),
    }));
    setDirty(true);
    setMessage("");
  };

  const updateMapping = (
    candidateId: string,
    mappingIndex: number,
    updater: (mapping: AnswerMapping) => AnswerMapping,
  ) => {
    updateCandidate(candidateId, (candidate) => ({
      ...candidate,
      mappings: candidate.mappings.map((mapping, index) =>
        index === mappingIndex ? updater(mapping) : mapping,
      ),
      reviewRequired: true,
    }));
  };

  const setCandidateTarget = (candidate: AnswerKeyCandidate, targetDocumentId: string) => {
    updateCandidate(candidate.id, (current) => ({
      ...current,
      targetDocumentId: targetDocumentId || undefined,
      mappings: current.mappings.map((mapping) => ({
        ...mapping,
        linkedQuestionId: undefined,
        reviewStatus: "proposed",
      })),
    }));
  };

  const setCandidateSource = (candidate: AnswerKeyCandidate, sourceDocumentId: string) => {
    updateCandidate(candidate.id, (current) => ({
      ...current,
      sourceDocumentId: sourceDocumentId || undefined,
      mappings: current.mappings.map((mapping) => ({
        ...mapping,
        sourceDocumentId: sourceDocumentId || undefined,
        reviewStatus: "proposed",
      })),
    }));
  };

  const save = async () => {
    setSaving(true);
    setError("");
    setMessage("");
    try {
      await onSave(draftPackage);
      setDirty(false);
      setMessage("Answer-key review saved in this browser.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save the answer-key review.");
    } finally {
      setSaving(false);
    }
  };

  const verifyMapping = (candidate: AnswerKeyCandidate, mapping: AnswerMapping) => {
    try {
      const verified = setMappingReviewStatus(draftPackage, candidate, mapping, "verified");
      const index = candidate.mappings.indexOf(mapping);
      updateMapping(candidate.id, index, () => verified);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "This answer mapping cannot be verified yet.");
    }
  };

  const visibleCandidates = draftPackage.candidates.filter((candidate) =>
    candidateFilter === "all" || candidate.id === candidateFilter,
  );

  return (
    <section className="page-section answer-review-section">
      <div className="page-heading simple-heading">
        <div>
          <div className="eyebrow">ANSWER-KEY RECONCILIATION</div>
          <h1>Review answer mappings</h1>
          <p>{draftPackage.title} · {totals.total} detected answer(s)</p>
        </div>
        <div className="answer-review-heading-actions">
          <button className="button button-outline" onClick={onBack}>Back to library</button>
          <button className="button button-primary" onClick={() => void save()} disabled={!dirty || saving}>
            {saving ? "Saving…" : "Save review"}
          </button>
        </div>
      </div>

      <div className="review-stats">
        <div><strong>{totals.total}</strong><span>Detected</span></div>
        <div><strong>{totals.verified}</strong><span>Verified keys</span></div>
        <div><strong>{totals.proposed}</strong><span>Needs review</span></div>
        <div><strong>{totals.ambiguous}</strong><span>Ambiguous matches</span></div>
      </div>

      <div className="panel answer-review-toolbar">
        <label>Filter key candidate
          <select value={candidateFilter} onChange={(event) => setCandidateFilter(event.target.value)}>
            <option value="all">All answer-key sections</option>
            {draftPackage.candidates.map((candidate) => (
              <option value={candidate.id} key={candidate.id}>
                {(candidate.paperLabel ? candidate.paperLabel + " · " : "") +
                  (candidate.subject ?? "Answer key") + " · " + candidate.sourceFilename + " p." + candidate.sourcePage}
              </option>
            ))}
          </select>
        </label>
        <label>Find question / answer
          <input value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="e.g. Q12, BC, -2.7" />
        </label>
      </div>

      {questionDocuments.length === 0 && (
        <div className="warning-line">Import and segment a question-paper PDF before reconciling answer mappings.</div>
      )}

      {visibleCandidates.map((candidate) => (
        <section className="panel answer-candidate-panel" key={candidate.id}>
          <div className="answer-candidate-header">
            <div>
              <div className="eyebrow">ANSWER-KEY SOURCE</div>
              <h2>{candidate.paperLabel ? candidate.paperLabel + " · " : ""}{candidate.subject ?? "Answer key"}</h2>
              <p>{candidate.sourceFilename} · PDF page {candidate.sourcePage} · {candidate.extractionMethod}</p>
            </div>
            <span className="pill pill-review">{candidate.mappings.length} mapping(s)</span>
          </div>

          <div className="answer-candidate-target">
            <label>Which PDF contains this answer-key entry?
              <select
                value={candidate.sourceDocumentId ?? ""}
                onChange={(event) => setCandidateSource(candidate, event.target.value)}
              >
                <option value="">Choose source PDF…</option>
                {draftPackage.documents.filter((document) => document.pageCount >= candidate.sourcePage).map((document) => (
                  <option value={document.id} key={document.id}>{document.filename} · {document.role}</option>
                ))}
              </select>
            </label>
            <label>Which question paper does this key belong to?
              <select
                value={candidate.targetDocumentId ?? ""}
                onChange={(event) => setCandidateTarget(candidate, event.target.value)}
              >
                <option value="">Choose a question paper…</option>
                {questionDocuments.map((document) => (
                  <option value={document.id} key={document.id}>{document.filename}</option>
                ))}
              </select>
            </label>
            <small>Target selection is package-scoped. Answer keys are never connected to another imported package.</small>
          </div>
          {draftPackage.documents.find((document) => document.id === candidate.sourceDocumentId) && (
            <AnswerKeyPdfPreview
              document={draftPackage.documents.find((document) => document.id === candidate.sourceDocumentId)!}
              pageNumber={candidate.sourcePage}
            />
          )}


          <div className="answer-mapping-list">
            {candidate.mappings.map((originalMapping, mappingIndex) => {
              const mapping = draftPackage.candidates.find((item) => item.id === candidate.id)?.mappings[mappingIndex] ?? originalMapping;
              const query = filter.trim().toLowerCase();
              if (query && ![
                "q" + mapping.questionNumber,
                String(mapping.questionNumber),
                mapping.answerRaw,
                mapping.subject ?? candidate.subject ?? "",
              ].some((value) => value.toLowerCase().includes(query))) return null;

              const currentCandidate = draftPackage.candidates.find((item) => item.id === candidate.id) ?? candidate;
              const match = evaluateAnswerMapping(draftPackage, currentCandidate, mapping);
              const candidates = match.candidates;
              const canVerify = canVerifyAnswerMapping(draftPackage, currentCandidate, mapping);
              const selectedId = mapping.linkedQuestionId ?? match.selectedQuestion?.id ?? "";
              const selectedQuestion = match.selectedQuestion ??
                draftPackage.questions?.find((question) => question.id === mapping.linkedQuestionId);

              return (
                <article className="answer-mapping-row" key={mapping.id ?? candidate.id + ":" + mappingIndex}>
                  <div className="answer-mapping-identity">
                    <strong>Q{mapping.questionNumber}</strong>
                    <span>{mapping.sourceFilename} · p.{mapping.sourcePage}</span>
                    <span className={"pill " + (mapping.reviewStatus === "verified" ? "pill-success" : mapping.reviewStatus === "rejected" ? "pill-warning" : "pill-review")}>{mappingStatusLabel(mapping.reviewStatus)}</span>
                  </div>
                  <div className="answer-mapping-fields">
                    <label>Raw answer
                      <input
                        value={mapping.answerRaw}
                        onChange={(event) => updateMapping(candidate.id, mappingIndex, (current) =>
                          updateMappingAnswer(current, event.target.value),
                        )}
                        aria-label={"Raw answer for question " + mapping.questionNumber}
                      />
                    </label>
                    <label>Subject
                      <select
                        value={(mapping.subject ?? candidate.subject ?? "") as Subject | ""}
                        onChange={(event) => updateMapping(candidate.id, mappingIndex, (current) => ({
                          ...current,
                          subject: event.target.value ? event.target.value as Subject : undefined,
                          linkedQuestionId: undefined,
                          reviewStatus: "proposed",
                        }))}
                      >
                        {subjectOptions.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}
                      </select>
                    </label>
                    <label>Matched question
                      <select
                        value={selectedId}
                        onChange={(event) => updateMapping(candidate.id, mappingIndex, (current) => ({
                          ...current,
                          linkedQuestionId: event.target.value || undefined,
                          reviewStatus: "proposed",
                        }))}
                        disabled={!candidate.targetDocumentId || candidates.length === 0}
                      >
                        <option value="">Select matching question…</option>
                        {candidates.map((question: QuestionDraft) => (
                          <option value={question.id} key={question.id}>
                            {question.subject} · Block {question.blockNumber} · Q{question.questionNumber} · p.{question.sourcePageStart}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                  <div className="answer-match-state">
                    <strong>{matchLabel(match.status)}</strong>
                    <span>{match.reason}</span>
                    {selectedQuestion && (
                      <small>
                        {selectedQuestion.sourceFilename} · page {selectedQuestion.sourcePageStart} ·
                        {" "}{selectedQuestion.subject} · {selectedQuestion.status.replace("_", " ")}
                      </small>
                    )}
                  </div>
                  <div className="answer-mapping-actions">
                    <button
                      className="button button-primary button-small"
                      onClick={() => verifyMapping(currentCandidate, mapping)}
                      disabled={!canVerify || mapping.reviewStatus === "verified"}
                    >
                      Verify answer
                    </button>
                    <button
                      className="button button-outline button-small"
                      onClick={() => updateMapping(candidate.id, mappingIndex, (current) => ({
                        ...current,
                        reviewStatus: "rejected",
                      }))}
                      disabled={mapping.reviewStatus === "rejected"}
                    >
                      Reject
                    </button>
                    {mapping.reviewStatus !== "proposed" && (
                      <button
                        className="text-button"
                        onClick={() => updateMapping(candidate.id, mappingIndex, (current) => ({
                          ...current,
                          reviewStatus: "proposed",
                        }))}
                      >
                        Reopen
                      </button>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      ))}

      {draftPackage.candidates.length === 0 && (
        <div className="panel answer-review-empty">
          <h2>No answer-key mappings detected</h2>
          <p>Check the document roles during import. Scanned answer keys need OCR, which is not included yet.</p>
        </div>
      )}

      {(error || message) && <div className={error ? "message message-error" : "review-message"} role="status">{error || message}</div>}
      <div className="answer-review-footer">
        <small>Verification requires source provenance, an exact question-paper target and a resolved question match. Only verified question text plus a verified answer mapping can enter a scored test.</small>
        <button className="button button-primary" onClick={() => void save()} disabled={!dirty || saving}>Save answer-key review</button>
      </div>
    </section>
  );
}
