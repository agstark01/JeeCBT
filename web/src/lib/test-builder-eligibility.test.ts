import { describe, expect, it } from "vitest";
import {
  collectEligibleQuestions,
  selectTestQuestions,
  type SubjectQuestionCounts,
} from "./test-builder";
import type {
  AnswerKeyCandidate,
  AnswerMapping,
  ExtractedDocument,
  PaperPackage,
  QuestionDraft,
} from "../types";

function doc(id: string, filename: string, role: ExtractedDocument["role"]): ExtractedDocument {
  return {
    id,
    filename,
    role,
    sizeBytes: 10,
    pageCount: 1,
    pages: [{ pageNumber: 1, text: "synthetic", textCharCount: 9, likelyScanned: false }],
    blob: new Blob(),
  };
}

function question(status: QuestionDraft["status"] = "verified"): QuestionDraft {
  return {
    id: "q-1",
    questionNumber: 1,
    blockNumber: 1,
    subject: "PHYSICS",
    questionType: "single_choice",
    optionLabels: ["A", "B", "C", "D"],
    statementText: "Synthetic question",
    sourceDocumentId: "paper-doc",
    sourceFilename: "paper.pdf",
    sourcePageStart: 1,
    sourcePageEnd: 1,
    status,
    detectionMethod: "question_number_marker",
  };
}

function mapping(status: AnswerMapping["reviewStatus"] = "verified"): AnswerMapping {
  return {
    id: "map-1",
    questionNumber: 1,
    answerRaw: "B",
    sourceDocumentId: "key-doc",
    sourceFilename: "key.pdf",
    sourcePage: 1,
    subject: "PHYSICS",
    linkedQuestionId: "q-1",
    reviewStatus: status,
  };
}

function candidate(mappingStatus: AnswerMapping["reviewStatus"] = "verified"): AnswerKeyCandidate {
  return {
    id: "candidate-1",
    sourceDocumentId: "key-doc",
    targetDocumentId: "paper-doc",
    sourceFilename: "key.pdf",
    sourcePage: 1,
    subject: "PHYSICS",
    detectionReasons: ["test"],
    extractionMethod: "test",
    confidence: 1,
    rawExcerpt: "B",
    mappings: [mapping(mappingStatus)],
    reviewRequired: false,
  };
}

function paper(
  questionStatus: QuestionDraft["status"] = "verified",
  keyStatus: AnswerMapping["reviewStatus"] = "verified",
): PaperPackage {
  return {
    id: "package-1",
    ownerId: "local",
    title: "Synthetic paper",
    examProfile: "generic",
    createdAt: 1,
    documents: [
      doc("paper-doc", "paper.pdf", "question_paper"),
      doc("key-doc", "key.pdf", "answer_key"),
    ],
    answerKeyStatus: "detected_needs_review",
    candidates: [candidate(keyStatus)],
    warnings: [],
    questions: [question(questionStatus)],
  };
}

const onePhysics: SubjectQuestionCounts = { PHYSICS: 1, CHEMISTRY: 0, MATHS: 0 };

describe("verified CBT question selection", () => {
  it("includes only questions and answer mappings verified in the same package", () => {
    const eligible = collectEligibleQuestions([paper()], ["package-1"]);
    expect(eligible).toHaveLength(1);
    expect(eligible[0]).toMatchObject({
      packageId: "package-1",
      correctAnswerRaw: "B",
      answerSourceFilename: "key.pdf",
    });
  });

  it("excludes an unverified question or proposed key", () => {
    expect(collectEligibleQuestions([paper("needs_review", "verified")], ["package-1"])).toHaveLength(0);
    expect(collectEligibleQuestions([paper("verified", "proposed")], ["package-1"])).toHaveLength(0);
  });

  it("does not use a paper package that was not selected", () => {
    expect(collectEligibleQuestions([paper()], [])).toHaveLength(0);
  });

  it("reports a subject shortfall rather than silently reducing the quota", () => {
    const result = selectTestQuestions([], onePhysics, false);
    expect(result.questions).toHaveLength(0);
    expect(result.shortages.PHYSICS).toEqual({ requested: 1, available: 0 });
  });

  it("returns unique questions and honors the exact subject quotas", () => {
    const eligible = collectEligibleQuestions([paper()], ["package-1"]);
    const result = selectTestQuestions(eligible, onePhysics, true, () => 0);
    expect(result.shortages).toEqual({});
    expect(result.questions).toHaveLength(1);
    expect(new Set(result.questions.map((item) => item.question.id)).size).toBe(1);
  });
});
