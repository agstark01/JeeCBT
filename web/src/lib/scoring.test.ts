import { describe, expect, it } from "vitest";
import { createExamAttempt, evaluateAnswer, isAnswerCorrect } from "./scoring";
import type { QuestionDraft, ExtractedDocument } from "../types";
import type { EligibleTestQuestion } from "./test-builder";

const document: ExtractedDocument = {
  id: "paper-doc",
  filename: "paper.pdf",
  role: "question_paper",
  sizeBytes: 100,
  pageCount: 1,
  pages: [{ pageNumber: 1, text: "synthetic", textCharCount: 9, likelyScanned: false }],
  blob: new Blob(),
};

function eligible(
  questionType: QuestionDraft["questionType"],
  correctAnswerRaw: string,
  optionLabels?: string[],
): EligibleTestQuestion {
  const question: QuestionDraft = {
    id: "question-" + questionType,
    questionNumber: 1,
    blockNumber: 1,
    subject: "PHYSICS",
    questionType,
    statementText: "Synthetic scored question",
    sourceDocumentId: "paper-doc",
    sourceFilename: "paper.pdf",
    sourcePageStart: 1,
    sourcePageEnd: 1,
    optionLabels,
    status: "verified",
    detectionMethod: "question_number_marker",
  };
  return {
    packageId: "package-1",
    packageTitle: "Synthetic paper",
    question,
    correctAnswerRaw,
    answerSourceFilename: "key.pdf",
    answerSourcePage: 2,
    sourceDocument: document,
  };
}

describe("CBT answer scoring", () => {
  it("scores single-choice options exactly", () => {
    const item = eligible("single_choice", "B");
    expect(isAnswerCorrect(item.question, "B", "B")).toBe(true);
    expect(isAnswerCorrect(item.question, "A", "B")).toBe(false);
    expect(isAnswerCorrect(item.question, "BC", "B")).toBe(false);
  });

  it("compares complete multiple-correct option sets without order dependence", () => {
    const item = eligible("multiple_choice", "BC", ["A", "B", "C", "D"]);
    expect(isAnswerCorrect(item.question, "C,B", "BC")).toBe(true);
    expect(isAnswerCorrect(item.question, "B", "BC")).toBe(false);
    expect(isAnswerCorrect(item.question, "BCD", "BC")).toBe(false);
  });

  it("scores positive, negative and decimal numerical values", () => {
    const item = eligible("numerical", "-2.7");
    expect(isAnswerCorrect(item.question, "-2.7", "-2.7")).toBe(true);
    expect(isAnswerCorrect(item.question, "25.6", "-2.7")).toBe(false);
    const decimal = eligible("numerical", "0.11");
    expect(isAnswerCorrect(decimal.question, "0.1100000000001", "0.11")).toBe(true);
  });

  it("applies question-specific marking before test defaults", () => {
    const item = eligible("single_choice", "A");
    item.question.correctMarks = 3;
    item.question.incorrectMarks = -0.5;
    expect(evaluateAnswer(item, "A", { correctMarks: 4, incorrectMarks: -1 })).toMatchObject({
      status: "correct",
      pointsAwarded: 3,
      pointsPossible: 3,
    });
    expect(evaluateAnswer(item, "B", { correctMarks: 4, incorrectMarks: -1 })).toMatchObject({
      status: "incorrect",
      pointsAwarded: -0.5,
      pointsPossible: 3,
    });
    expect(evaluateAnswer(item, "", { correctMarks: 4, incorrectMarks: -1 })).toMatchObject({
      status: "unanswered",
      pointsAwarded: 0,
      pointsPossible: 3,
    });
  });

  it("produces the final score and per-question result rows", () => {
    const choice = eligible("single_choice", "A");
    const number = eligible("numerical", "25.6");
    number.question.id = "numeric-question";
    const attempt = createExamAttempt({
      ownerId: "local",
      title: "Synthetic test",
      packageIds: ["package-1"],
      questions: [choice, number],
      answers: { [choice.question.id]: "A", [number.question.id]: "25.6" },
      durationSeconds: 600,
      elapsedSeconds: 120,
      defaults: { correctMarks: 4, incorrectMarks: -1 },
      id: "attempt-1",
      createdAt: 1,
    });
    expect(attempt).toMatchObject({
      questionCount: 2,
      correctCount: 2,
      incorrectCount: 0,
      unansweredCount: 0,
      score: 8,
      maxScore: 8,
      percentage: 100,
    });
    expect(attempt.answers[1].correctAnswer).toBe("25.6");
    expect(attempt.answers[1].answerSourceFilename).toBe("key.pdf");
  });
});
