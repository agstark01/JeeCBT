import { useEffect, useMemo, useState } from "react";
import {
  canVerifyAnswerMapping,
  evaluateAnswerMapping,
  findMappingQuestionCandidates,
  setMappingReviewStatus,
  updateMappingAnswer,
} from "./lib/answer-review";
import type {
  AnswerKeyCandidate,
  AnswerMapping,
  PaperPackage,
  Subject,
} from "./types";

interface AnswerKeyReviewerProps {
  paperPackage: PaperPackage;
  onBack: () => void;
  onSave: (updated: PaperPackage) => Promise<void>;
}

const subjectOptions: Array<{ value: string; label: string }> = [
  { value: "", label: "Unassigned" },
  { value: "PHYSICS", label: "Physics" },
  { value: "CHEMISTRY", label: "Chemistry" },
  { value: "MATHS", label: "Mathematics" },
];

function mappingKey(mapping: AnswerMapping, index: number): string {
  return mapping.id ?? String(index);
}

function SourcePage({
  paperPackage,
  candidate,
}: {
  paperPackage: PaperPackage;
  candidate: AnswerKeyCandidate;
}) {
  const [url, setUrl] = useState("");
  const source = paperPackage.documents.find((document) =>
    document.id === candidate.sourceDocumentId
  );

  useEffect(() => {
    if (!source) return;
    const objectUrl = URL.createObjectURL(source.blob);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [source?.id, source?.blob]);

  if (!source || !url) {
    return <div className="source-preview-empty">Source PDF preview is unavailable until its document identity is resolved.</div>;
  }

  const pageUrl = url + "#page=" + candidate.sourcePage + "&toolbar=0&navpanes=0";
  return (
    <div className="source-preview">
      <iframe title={source.filename + " page " + candidate.sourcePage} src={pageUrl} />
      <a href={pageUrl} target="_blank" rel="noreferrer">Open {source.filename} at page {candidate.sourcePage}</a>
    </div>
  );
}

export default function AnswerKeyReviewer({
  paperPackage,
  onBack,
  onSave,
}: AnswerKeyReviewerProps) {
  const [workingPackage, setWorkingPackage] = useState(paperPackage);
  const [selectedCandidateId, setSelectedCandidateId] = useState(paperPackage.candidates[0]?.id ?? "");
  const [selectedMappingKey, setSelectedMappingKey] = useState(
    paperPackage.candidates[0]?.mappings[0]
      ? mappingKey(paperPackage.candidates[0].mappings[0], 0)
      : "",
  );
  const [draft, setDraft] = useState<AnswerMapping | null>(
    paperPackage.candidates[0]?.mappings[0]
      ? { ...paperPackage.candidates[0].mappings[0] }
      : null,
  );
  const [targetDocumentId, setTargetDocumentId] = useState(
    paperPackage.candidates[0]?.targetDocumentId ?? "",
  );
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  const candidate = useMemo(
    () => workingPackage.candidates.find((item) => item.id === selectedCandidateId),
    [workingPackage.candidates, selectedCandidateId],
  );

  const mappingIndex = candidate?.mappings.findIndex((mapping, index) =>
    mappingKey(mapping, index) === selectedMappingKey
  ) ?? -1;
  const selectedMapping = mappingIndex >= 0 ? candidate?.mappings[mappingIndex] : undefined;

  useEffect(() => {
    if (!workingPackage.candidates.some((item) => item.id === selectedCandidateId)) {
      const first = workingPackage.candidates[0];
      setSelectedCandidateId(first?.id ?? "");
      setSelectedMappingKey(first?.mappings[0] ? mappingKey(first.mappings[0], 0) : "");
    }
  }, [workingPackage.candidates, selectedCandidateId]);

  useEffect(() => {
    if (selectedMapping) setDraft({ ...selectedMapping });
  }, [selectedCandidateId, selectedMappingKey, workingPackage.id]);

  useEffect(() => {
    setTargetDocumentId(candidate?.targetDocumentId ?? "");
  }, [candidate?.id, candidate?.targetDocumentId]);

  const questionDocuments = useMemo(() => {
    const ids = new Set((workingPackage.questions ?? []).map((question) => question.sourceDocumentId));
    return workingPackage.documents.filter((document) =>
      document.role === "question_paper" || ids.has(document.id)
    );
  }, [workingPackage.documents, workingPackage.questions]);

  const statusCounts = useMemo(() => {
    const mappings = workingPackage.candidates.flatMap((item) => item.mappings);
    return {
      total: mappings.length,
      proposed: mappings.filter((item) => item.reviewStatus === "proposed").length,
      verified: mappings.filter((item) => item.reviewStatus === "verified").length,
      rejected: mappings.filter((item) => item.reviewStatus === "rejected").length,
    };
  }, [workingPackage.candidates]);

  const mappings = candidate?.mappings ?? [];
  const match = candidate && draft
    ? evaluateAnswerMapping(
        { ...workingPackage, candidates: workingPackage.candidates.map((item) =>
          item.id === candidate.id ? { ...item, targetDocumentId } : item
        ) },
        { ...candidate, targetDocumentId },
        draft,
      )
    : undefined;
  const mappingCandidates = candidate && draft
    ? findMappingQuestionCandidates(
        workingPackage,
        { ...candidate, targetDocumentId },
        draft,
      )
    : [];
  const canVerify = Boolean(
    candidate &&
    draft &&
    canVerifyAnswerMapping(
      { ...workingPackage, candidates: workingPackage.candidates.map((item) =>
        item.id === candidate.id ? { ...item, targetDocumentId } : item
      ) },
      { ...candidate, targetDocumentId },
      { ...draft, sourceDocumentId: draft.sourceDocumentId ?? candidate.sourceDocumentId },
    ),
  );

  const persistPackage = async (updated: PaperPackage) => {
    setSaving(true);
    setMessage("");
    try {
      await onSave(updated);
      setWorkingPackage(updated);
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : "Unable to save answer-key review to local storage.");
      throw caught;
    } finally {
      setSaving(false);
    }
  };

  const updateCandidateTarget = async (nextTarget: string) => {
    if (!candidate) return;
    setTargetDocumentId(nextTarget);
    const updated: PaperPackage = {
      ...workingPackage,
      candidates: workingPackage.candidates.map((item) =>
        item.id === candidate.id
          ? {
              ...item,
              targetDocumentId: nextTarget || undefined,
              mappings: item.mappings.map((mapping) => ({
                ...mapping,
                linkedQuestionId: undefined,
                reviewStatus: "proposed" as const,
              })),
            }
          : item
      ),
    };
    try {
      await persistPackage(updated);
      setMessage("Target paper updated. Previous question links and key verification were reset for safety.");
    } catch {
      // persistPackage has already reported the failure.
    }
  };

  const updateSourceDocument = async (nextSource: string) => {
    if (!candidate) return;
    const source = workingPackage.documents.find((document) => document.id === nextSource);
    if (!source) return;
    const updated: PaperPackage = {
      ...workingPackage,
      candidates: workingPackage.candidates.map((item) =>
        item.id === candidate.id
          ? {
              ...item,
              sourceDocumentId: source.id,
              sourceFilename: source.filename,
              mappings: item.mappings.map((mapping) => ({
                ...mapping,
                sourceDocumentId: source.id,
                sourceFilename: source.filename,
                reviewStatus: "proposed" as const,
              })),
            }
          : item
      ),
    };
    try {
      await persistPackage(updated);
      setMessage("Source document provenance saved locally.");
    } catch {
      // persistPackage has already reported the failure.
    }
  };

  const saveMapping = async (status?: AnswerMapping["reviewStatus"]) => {
    if (!candidate || !draft || mappingIndex < 0) return;
    let nextMapping: AnswerMapping = {
      ...draft,
      sourceDocumentId: draft.sourceDocumentId ?? candidate.sourceDocumentId,
      sourceFilename: draft.sourceFilename || candidate.sourceFilename,
      reviewStatus: status ?? "proposed",
    };
    const packageForMatch = {
      ...workingPackage,
      candidates: workingPackage.candidates.map((item) =>
        item.id === candidate.id ? { ...item, targetDocumentId } : item
      ),
    };
    const candidateForMatch = { ...candidate, targetDocumentId };

    if (!nextMapping.linkedQuestionId) {
      const unique = findMappingQuestionCandidates(packageForMatch, candidateForMatch, nextMapping);
      if (unique.length === 1) nextMapping.linkedQuestionId = unique[0].id;
    }

    try {
      if (status) {
        nextMapping = setMappingReviewStatus(
          packageForMatch,
          candidateForMatch,
          nextMapping,
          status,
        );
      }
      const updated: PaperPackage = {
        ...workingPackage,
        candidates: workingPackage.candidates.map((item) =>
          item.id === candidate.id
            ? {
                ...item,
                targetDocumentId: targetDocumentId || undefined,
                mappings: item.mappings.map((mapping, index) =>
                  index === mappingIndex ? nextMapping : mapping
                ),
              }
            : item
        ),
      };
      await persistPackage(updated);
      setDraft(nextMapping);
      setMessage(
        status === "verified"
          ? "Answer mapping verified. Question-text verification is still a separate requirement."
          : status === "rejected"
            ? "Answer mapping rejected."
            : "Answer mapping saved as a proposal.",
      );
    } catch (caught) {
      if (status === "verified") {
        setMessage(caught instanceof Error ? caught.message : "This mapping is not ready to verify.");
      }
    }
  };

  const updateDraft = (patch: Partial<AnswerMapping>) => {
    setDraft((current) => {
      if (!current) return current;
      const updated = { ...current, ...patch };
      if (patch.answerRaw !== undefined) {
        return updateMappingAnswer(current, patch.answerRaw);
      }
      if (
        patch.questionNumber !== undefined ||
        patch.subject !== undefined ||
        patch.sectionLabel !== undefined ||
        patch.blockNumber !== undefined ||
        patch.linkedQuestionId !== undefined
      ) {
        updated.reviewStatus = "proposed";
      }
      return updated;
    });
  };

  const selectedSourceDocument = candidate
    ? workingPackage.documents.find((document) => document.id === candidate.sourceDocumentId)
    : undefined;

  return (
    <section className="page-section answer-review-section">
      <div className="page-heading simple-heading">
        <div>
          <div className="eyebrow">ANSWER-KEY REVIEW</div>
          <h1>Verify answer mappings</h1>
          <p>{workingPackage.title} · mappings are never authoritative until individually verified.</p>
        </div>
        <button className="button button-outline" onClick={onBack}>Back to library</button>
      </div>

      <div className="answer-review-stats">
        <div><strong>{statusCounts.total}</strong><span>Extracted mappings</span></div>
        <div><strong>{statusCounts.proposed}</strong><span>Proposed</span></div>
        <div><strong>{statusCounts.verified}</strong><span>Verified</span></div>
        <div><strong>{statusCounts.rejected}</strong><span>Rejected</span></div>
      </div>

      {workingPackage.candidates.length === 0 ? (
        <div className="inline-empty">No answer-key candidates were extracted from this package. The importer may not recognize the PDF layout or it may require OCR.</div>
      ) : (
        <div className="answer-review-layout">
          <aside className="panel answer-candidate-list">
            <div className="review-list-heading"><strong>Answer-key candidates</strong><span>{workingPackage.candidates.length}</span></div>
            {workingPackage.candidates.map((item) => (
              <button
                key={item.id}
                type="button"
                className={item.id === selectedCandidateId ? "answer-candidate-item active" : "answer-candidate-item"}
                onClick={() => {
                  setSelectedCandidateId(item.id);
                  setSelectedMappingKey(item.mappings[0] ? mappingKey(item.mappings[0], 0) : "");
                  setMessage("");
                }}
              >
                <strong>{item.paperLabel ? item.paperLabel + " · " : ""}{item.subject ?? "Answer key"}</strong>
                <small>{item.sourceFilename} · page {item.sourcePage}</small>
                <small>{item.mappings.length} mappings · {item.mappings.filter((mapping) => mapping.reviewStatus === "verified").length} verified</small>
              </button>
            ))}
          </aside>

          <div className="answer-review-workspace">
            {candidate && (
              <div className="panel answer-candidate-detail">
                <div className="review-panel-title">
                  <div><strong>Candidate provenance and target</strong><span>Both documents must belong to this imported package.</span></div>
                </div>
                <div className="answer-provenance-fields">
                  <label>Key source PDF
                    {candidate.sourceDocumentId ? (
                      <input value={candidate.sourceFilename} readOnly />
                    ) : (
                      <select
                        value={candidate.sourceDocumentId ?? ""}
                        onChange={(event) => void updateSourceDocument(event.target.value)}
                      >
                        <option value="">Choose the source PDF</option>
                        {workingPackage.documents.filter((document) => document.filename === candidate.sourceFilename).map((document) => (
                          <option key={document.id} value={document.id}>{document.filename} · {document.pageCount} pages</option>
                        ))}
                      </select>
                    )}
                  </label>
                  <label>Question paper
                    <select
                      value={targetDocumentId}
                      onChange={(event) => void updateCandidateTarget(event.target.value)}
                    >
                      <option value="">Choose target question paper</option>
                      {questionDocuments.map((document) => (
                        <option key={document.id} value={document.id}>{document.filename}</option>
                      ))}
                    </select>
                  </label>
                </div>
                {candidate.sourceDocumentId && (
                  <div className="answer-source-meta">
                    Source: {candidate.sourceFilename} · PDF page {candidate.sourcePage} · {candidate.extractionMethod}
                  </div>
                )}
              </div>
            )}

            {candidate && (
              <div className="panel answer-mapping-panel">
                <div className="review-list-heading">
                  <strong>Individual mappings</strong>
                  <span>{mappings.length} in this candidate</span>
                </div>
                <div className="answer-mapping-list">
                  {mappings.map((mapping, index) => (
                    <button
                      key={mappingKey(mapping, index)}
                      type="button"
                      className={mappingIndex === index ? "answer-mapping-item active" : "answer-mapping-item"}
                      onClick={() => {
                        setSelectedMappingKey(mappingKey(mapping, index));
                        setMessage("");
                      }}
                    >
                      <strong>Q{mapping.questionNumber}</strong>
                      <code>{mapping.answerRaw}</code>
                      <span className={"answer-status " + mapping.reviewStatus}>{mapping.reviewStatus}</span>
                    </button>
                  ))}
                  {mappings.length === 0 && <div className="inline-empty">This candidate contains no aligned question/answer rows. Review its raw excerpt in the library.</div>}
                </div>
              </div>
            )}

            {candidate && draft && mappingIndex >= 0 && (
              <div className="panel answer-mapping-editor">
                <div className="review-editor-heading">
                  <div><div className="eyebrow">ANSWER ENTRY</div><h2>Q{draft.questionNumber}</h2></div>
                  <span className={"pill " + (draft.reviewStatus === "verified" ? "pill-success" : draft.reviewStatus === "rejected" ? "pill-warning" : "pill-review")}>{draft.reviewStatus}</span>
                </div>

                <div className="review-fields answer-mapping-fields">
                  <label>Question number
                    <input type="number" min="1" value={draft.questionNumber} onChange={(event) => updateDraft({ questionNumber: Number(event.target.value) })} />
                  </label>
                  <label>Subject context
                    <select
                      value={draft.subject ?? candidate.subject ?? ""}
                      onChange={(event) => updateDraft({ subject: event.target.value ? event.target.value as Subject : undefined, linkedQuestionId: undefined })}
                    >
                      {subjectOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                    </select>
                  </label>
                  <label>Section label
                    <input value={draft.sectionLabel ?? ""} placeholder="e.g. SECTION B" onChange={(event) => updateDraft({ sectionLabel: event.target.value || undefined, linkedQuestionId: undefined })} />
                  </label>
                  <label>Numbering block
                    <input type="number" min="1" value={draft.blockNumber ?? ""} placeholder="Optional" onChange={(event) => updateDraft({ blockNumber: event.target.value ? Number(event.target.value) : undefined, linkedQuestionId: undefined })} />
                  </label>
                </div>

                <label className="answer-raw-field">Raw answer exactly as extracted
                  <input
                    value={draft.answerRaw}
                    onChange={(event) => updateDraft({ answerRaw: event.target.value })}
                    spellCheck={false}
                    autoComplete="off"
                  />
                  <small>Keep option sets (BC, ABD) and numeric values (25.6, -2.7) as strings. Editing resets this mapping to proposed.</small>
                </label>

                <div className="answer-match-panel">
                  <div className="review-panel-title">
                    <div><strong>Question reconciliation</strong><span>{match?.reason}</span></div>
                    <span className={"answer-match-status " + (match?.status ?? "missing")}>{match?.status ?? "missing"}</span>
                  </div>
                  <label className="answer-link-field">Link to question
                    <select
                      value={draft.linkedQuestionId ?? (mappingCandidates.length === 1 ? mappingCandidates[0].id : "")}
                      onChange={(event) => updateDraft({ linkedQuestionId: event.target.value || undefined })}
                    >
                      <option value="">Choose a question explicitly</option>
                      {mappingCandidates.map((question) => (
                        <option key={question.id} value={question.id}>
                          Q{question.questionNumber} · {question.subject} · block {question.blockNumber}
                          {question.sectionLabel ? " · " + question.sectionLabel : ""}
                          {" · p." + question.sourcePageStart}
                        </option>
                      ))}
                    </select>
                  </label>
                  {match?.status === "ambiguous" && (
                    <div className="warning-line"><span>!</span>Several questions can match. The mapping cannot be verified until one exact question is selected.</div>
                  )}
                  {match?.status === "mismatched" && (
                    <div className="warning-line"><span>!</span>The question number exists, but the paper, subject, section or block context does not agree. Correct the mapping context; do not force a cross-paper join.</div>
                  )}
                  {match?.status === "missing" && (
                    <div className="warning-line"><span>!</span>No matching segmented question exists in this source paper. The key entry remains unverified.</div>
                  )}
                </div>

                <div className="answer-mapping-provenance">
                  <strong>Answer-key source</strong>
                  <span>{draft.sourceFilename}</span>
                  <span>PDF page {draft.sourcePage}</span>
                  {selectedSourceDocument && <span>{selectedSourceDocument.pageCount} page source document</span>}
                  {draft.reviewNote && <span>{draft.reviewNote}</span>}
                </div>
                {message && <div className="review-message" role="status">{message}</div>}
                <div className="review-actions">
                  <button className="button button-outline" onClick={() => void saveMapping()} disabled={saving}>Save proposal</button>
                  <button className="button button-primary" onClick={() => void saveMapping("verified")} disabled={saving || !canVerify}>Verify mapping</button>
                  <button className="text-button danger-text" onClick={() => void saveMapping("rejected")} disabled={saving}>Reject mapping</button>
                </div>
                <small className="review-verification-note">Key verification does not verify the question text. Scoring is eligible only after both the mapping and its linked question are verified.</small>
              </div>
            )}

            {candidate && candidate.sourceDocumentId && (
              <div className="panel review-source-panel">
                <div className="review-panel-title"><div><strong>Original answer-key PDF</strong><span>{candidate.sourceFilename} · page {candidate.sourcePage}</span></div></div>
                <SourcePage paperPackage={workingPackage} candidate={candidate} />
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
