import type {
  AnswerKeyCandidate,
  AnswerMapping,
  PaperPackage,
  QuestionDraft,
  Subject,
} from "../types";

export type MappingMatchStatus = "matched" | "missing" | "mismatched" | "ambiguous";

export interface MappingMatch {
  status: MappingMatchStatus;
  candidates: QuestionDraft[];
  selectedQuestion?: QuestionDraft;
  reason: string;
}

function normalizedSubject(subject?: Subject): "PHYSICS" | "CHEMISTRY" | "MATHS" | undefined {
  if (!subject) return undefined;
  return subject === "MATHEMATICS" ? "MATHS" : subject;
}

function sameLabel(left?: string, right?: string): boolean {
  return !left || !right || left.trim().toUpperCase() === right.trim().toUpperCase();
}

/**
 * All reconciliation is package-scoped. A separate answer-key PDF is connected
 * to a question-paper document through candidate.targetDocumentId; a question
 * number alone is never treated as a globally unique identifier.
 */
export function findMappingQuestionCandidates(
  paperPackage: PaperPackage,
  candidate: AnswerKeyCandidate,
  mapping: AnswerMapping,
): QuestionDraft[] {
  const questions = paperPackage.questions ?? [];
  const targetDocumentId = candidate.targetDocumentId;
  if (!targetDocumentId) return [];

  const subject = normalizedSubject(mapping.subject ?? candidate.subject);
  return questions.filter((question) => {
    if (question.sourceDocumentId !== targetDocumentId) return false;
    if (question.questionNumber !== mapping.questionNumber) return false;
    if (subject && question.subject !== "UNASSIGNED" && normalizedSubject(question.subject) !== subject) {
      return false;
    }
    if (!sameLabel(mapping.paperLabel ?? candidate.paperLabel, question.paperLabel)) return false;
    if (!sameLabel(mapping.sectionLabel ?? candidate.sectionLabel, question.sectionLabel)) return false;
    if (mapping.blockNumber !== undefined && question.blockNumber !== mapping.blockNumber) return false;
    return true;
  });
}

export function evaluateAnswerMapping(
  paperPackage: PaperPackage,
  candidate: AnswerKeyCandidate,
  mapping: AnswerMapping,
): MappingMatch {
  const allQuestions = paperPackage.questions ?? [];
  const targetDocumentId = candidate.targetDocumentId;

  if (!targetDocumentId) {
    return {
      status: "ambiguous",
      candidates: [],
      reason: "Choose the question-paper document this answer-key candidate belongs to.",
    };
  }

  if (mapping.linkedQuestionId) {
    const linked = allQuestions.find((question) => question.id === mapping.linkedQuestionId);
    if (
      linked &&
      linked.sourceDocumentId === targetDocumentId &&
      linked.questionNumber === mapping.questionNumber &&
      findMappingQuestionCandidates(paperPackage, candidate, mapping).some((question) => question.id === linked.id)
    ) {
      return {
        status: "matched",
        candidates: [linked],
        selectedQuestion: linked,
        reason: "Explicitly linked to this question in the same paper package.",
      };
    }
    return {
      status: "mismatched",
      candidates: [],
      reason: "The saved question link no longer matches this package, source paper, subject, section or question number.",
    };
  }

  const matching = findMappingQuestionCandidates(paperPackage, candidate, mapping);
  if (matching.length === 1) {
    return {
      status: "matched",
      candidates: matching,
      selectedQuestion: matching[0],
      reason: "One question matches the available package, source, subject and numbering context.",
    };
  }
  if (matching.length > 1) {
    return {
      status: "ambiguous",
      candidates: matching,
      reason: "More than one question shares this identity. Select the intended question explicitly.",
    };
  }

  const sameNumberInTarget = allQuestions.filter((question) =>
    question.sourceDocumentId === targetDocumentId &&
    question.questionNumber === mapping.questionNumber
  );
  if (sameNumberInTarget.length > 0) {
    return {
      status: "mismatched",
      candidates: sameNumberInTarget,
      reason: "The question number exists in this source paper, but its subject, section, paper label or block conflicts with the answer mapping.",
    };
  }

  const sameNumberElsewhere = allQuestions.filter((question) =>
    question.questionNumber === mapping.questionNumber
  );
  if (sameNumberElsewhere.length > 0) {
    return {
      status: "mismatched",
      candidates: sameNumberElsewhere,
      reason: "This number exists only in another source document. Cross-document linking is not automatic.",
    };
  }

  return {
    status: "missing",
    candidates: [],
    reason: "No segmented question with this number exists in the selected source paper.",
  };
}

export function canVerifyAnswerMapping(
  paperPackage: PaperPackage,
  candidate: AnswerKeyCandidate,
  mapping: AnswerMapping,
): boolean {
  const document = paperPackage.documents.find((item) =>
    item.id === (mapping.sourceDocumentId ?? candidate.sourceDocumentId)
  );
  const match = evaluateAnswerMapping(paperPackage, candidate, mapping);
  return Boolean(
    mapping.answerRaw.trim() &&
    mapping.questionNumber > 0 &&
    document &&
    mapping.sourceFilename &&
    mapping.sourcePage >= 1 &&
    match.status === "matched" &&
    match.selectedQuestion,
  );
}

export function updateMappingAnswer(
  mapping: AnswerMapping,
  answerRaw: string,
): AnswerMapping {
  if (answerRaw === mapping.answerRaw) return mapping;
  return {
    ...mapping,
    answerRaw,
    reviewStatus: "proposed",
    reviewNote: undefined,
  };
}

export function setMappingReviewStatus(
  paperPackage: PaperPackage,
  candidate: AnswerKeyCandidate,
  mapping: AnswerMapping,
  status: AnswerMapping["reviewStatus"],
): AnswerMapping {
  if (status === "verified" && !canVerifyAnswerMapping(paperPackage, candidate, mapping)) {
    throw new Error("A mapping can only be verified when its source provenance and question match are resolved.");
  }
  return {
    ...mapping,
    reviewStatus: status,
  };
}

/** Question text verification and key verification are independent gates. */
export function isMappingScoringEligible(
  paperPackage: PaperPackage,
  candidate: AnswerKeyCandidate,
  mapping: AnswerMapping,
): boolean {
  if (mapping.reviewStatus !== "verified") return false;
  const match = evaluateAnswerMapping(paperPackage, candidate, mapping);
  return match.status === "matched" && match.selectedQuestion?.status === "verified";
}
