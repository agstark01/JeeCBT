import { describe, expect, it } from "vitest";
import {
  canVerifyAnswerMapping,
  evaluateAnswerMapping,
  findMappingQuestionCandidates,
  isMappingScoringEligible,
  setMappingReviewStatus,
  updateMappingAnswer,
} from "./answer-review";
import type {
  AnswerKeyCandidate,
  AnswerMapping,
  ExtractedDocument,
  PaperPackage,
  QuestionDraft,
} from "../types";

function question(
  id: string,
  number: number,
  subject: QuestionDraft["subject"],
  block: number,
  documentId = "question-doc",
  status: QuestionDraft["status"] = "needs_review",
): QuestionDraft {
  return {
    id,
    questionNumber: number,
    blockNumber: block,
    subject,
    questionType: "multiple_choice",
    statementText: "Synthetic test question " + id,
    sourceDocumentId: documentId,
    sourceFilename: documentId + ".pdf",
    sourcePageStart: 1,
    sourcePageEnd: 1,
    status,
    detectionMethod: "question_number_marker",
  };
}

function doc(id: string, filename: string, role: ExtractedDocument["role"]): ExtractedDocument {
  return {
    id,
    filename,
    role,
    sizeBytes: 100,
    pageCount: 1,
    pages: [{ pageNumber: 1, text: "synthetic", textCharCount: 9, likelyScanned: false }],
    blob: new Blob(),
  };
}

function mapping(answerRaw = "BC", overrides: Partial<AnswerMapping> = {}): AnswerMapping {
  return {
    id: "mapping-1",
    questionNumber: 1,
    answerRaw,
    sourceDocumentId: "key-doc",
    sourceFilename: "key.pdf",
    sourcePage: 1,
    subject: "PHYSICS",
    reviewStatus: "proposed",
    ...overrides,
  };
}

function candidate(overrides: Partial<AnswerKeyCandidate> = {}): AnswerKeyCandidate {
  return {
    id: "candidate-1",
    sourceDocumentId: "key-doc",
    targetDocumentId: "question-doc",
    sourceFilename: "key.pdf",
    sourcePage: 1,
    subject: "PHYSICS",
    detectionReasons: ["synthetic"],
    extractionMethod: "test",
    confidence: 0.9,
    rawExcerpt: "synthetic",
    mappings: [],
    reviewRequired: true,
    ...overrides,
  };
}

function packageWith(questions: QuestionDraft[]): PaperPackage {
  return {
    id: "package-1",
    ownerId: "local",
    title: "Synthetic package",
    examProfile: "generic",
    createdAt: 1,
    documents: [
      doc("question-doc", "paper.pdf", "question_paper"),
      doc("key-doc", "key.pdf", "answer_key"),
    ],
    answerKeyStatus: "detected_needs_review",
    candidates: [],
    warnings: [],
    questions,
  };
}

describe("answer-key reconciliation", () => {
  it("uses subject to distinguish repeated Q1 values across subject blocks", () => {
    const pkg = packageWith([
      question("physics-q1", 1, "PHYSICS", 1),
      question("chem-q1", 1, "CHEMISTRY", 2),
      question("maths-q1", 1, "MATHS", 3),
    ]);
    const key = candidate();
    const answer = mapping("BC");
    expect(findMappingQuestionCandidates(pkg, key, answer).map((q) => q.id)).toEqual(["physics-q1"]);
    expect(evaluateAnswerMapping(pkg, key, answer).status).toBe("matched");
  });

  it("surfaces ambiguity when repeated numbers cannot be distinguished by available metadata", () => {
    const pkg = packageWith([
      question("q1-block-a", 1, "UNASSIGNED", 1),
      question("q1-block-b", 1, "UNASSIGNED", 2),
    ]);
    const key = candidate({ subject: undefined });
    const answer = mapping("A", { subject: undefined });
    expect(evaluateAnswerMapping(pkg, key, answer).status).toBe("ambiguous");
  });

  it("never matches an answer mapping against a different package", () => {
    const pkg = packageWith([]);
    expect(evaluateAnswerMapping(pkg, candidate(), mapping()).status).toBe("missing");
  });

  it("flags subject mismatches instead of joining by question number", () => {
    const pkg = packageWith([question("chem-q1", 1, "CHEMISTRY", 1)]);
    const result = evaluateAnswerMapping(pkg, candidate(), mapping());
    expect(result.status).toBe("mismatched");
    expect(result.reason).toContain("conflicts");
  });

  it("requires a target question document for separate answer-key PDFs when target is not unique", () => {
    const pkg = packageWith([question("q1", 1, "PHYSICS", 1)]);
    pkg.documents.push(doc("question-doc-2", "paper-2.pdf", "question_paper"));
    const result = evaluateAnswerMapping(pkg, candidate({ targetDocumentId: undefined }), mapping());
    expect(result.status).toBe("ambiguous");
  });

  it("preserves option sets and numeric answer strings exactly when editing", () => {
    expect(updateMappingAnswer(mapping("BC"), "ABD").answerRaw).toBe("ABD");
    expect(updateMappingAnswer(mapping("25.6"), "-2.7").answerRaw).toBe("-2.7");
    expect(updateMappingAnswer(mapping("0.11"), "0.11").answerRaw).toBe("0.11");
  });

  it("resets verification to proposed when the raw answer is edited", () => {
    const edited = updateMappingAnswer(mapping("A", { reviewStatus: "verified" }), "B");
    expect(edited.reviewStatus).toBe("proposed");
  });

  it("does not allow verifying missing, ambiguous or provenance-free mappings", () => {
    const pkg = packageWith([]);
    const key = candidate();
    const answer = mapping();
    expect(canVerifyAnswerMapping(pkg, key, answer)).toBe(false);
    expect(() => setMappingReviewStatus(pkg, key, answer, "verified")).toThrow();
  });

  it("requires both key verification and question-text verification for scoring eligibility", () => {
    const unverifiedQuestion = question("physics-q1", 1, "PHYSICS", 1);
    const pkg = packageWith([unverifiedQuestion]);
    const key = candidate();
    const proposed = mapping();
    const verifiedKey = setMappingReviewStatus(pkg, key, proposed, "verified");
    expect(isMappingScoringEligible(pkg, key, verifiedKey)).toBe(false);

    const verifiedPackage = packageWith([
      question("physics-q1", 1, "PHYSICS", 1, "question-doc", "verified"),
    ]);
    expect(isMappingScoringEligible(verifiedPackage, key, verifiedKey)).toBe(true);
  });

  it("requires a user-selected question when multiple candidates remain", () => {
    const pkg = packageWith([
      question("q1-a", 1, "UNASSIGNED", 1),
      question("q1-b", 1, "UNASSIGNED", 1),
    ]);
    const key = candidate({ subject: undefined });
    const answer = mapping("D", { subject: undefined });
    const before = evaluateAnswerMapping(pkg, key, answer);
    expect(before.status).toBe("ambiguous");
    const selected = { ...answer, linkedQuestionId: "q1-b" };
    expect(evaluateAnswerMapping(pkg, key, selected).selectedQuestion?.id).toBe("q1-b");
  });
});
