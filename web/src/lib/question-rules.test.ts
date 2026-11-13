import { describe, expect, it } from "vitest";
import { applyQuestionRules, detectQuestionRules } from "./question-rules";
import type { ExtractedDocument } from "../types";

function paper(text: string): ExtractedDocument {
  return {
    id: "paper-doc",
    filename: "physics-paper.pdf",
    role: "question_paper",
    sizeBytes: 100,
    pageCount: 1,
    pages: [{
      pageNumber: 1,
      text,
      textCharCount: text.length,
      likelyScanned: false,
    }],
    blob: new Blob(),
  };
}

describe("question instruction inference", () => {
  it("detects a question-number range for multiple-correct questions", () => {
    const analysis = detectQuestionRules([
      paper("Questions 16 to 20 are multiple correct type questions.\nQ.16 A prompt"),
    ]);
    expect(analysis.rules).toHaveLength(1);
    expect(analysis.rules[0]).toMatchObject({
      questionStart: 16,
      questionEnd: 20,
      questionType: "multiple_choice",
    });
    const result = applyQuestionRules(analysis.rules, {
      sourceDocumentId: "paper-doc",
      questionNumber: 18,
      statementText: "Find the value.",
      hasOptions: true,
    });
    expect(result.questionType).toBe("multiple_choice");
    expect(result.inference.source).toBe("section_rule");
  });

  it("applies section instructions to following questions", () => {
    const analysis = detectQuestionRules([
      paper("SECTION B\nEach question has only one correct option.\nQ.4 Select the answer."),
    ]);
    expect(analysis.rules[0].sectionLabel).toBe("SECTION B");
    const result = applyQuestionRules(analysis.rules, {
      sourceDocumentId: "paper-doc",
      questionNumber: 4,
      sectionLabel: "SECTION B",
      statementText: "Choose from the options.",
      hasOptions: true,
    });
    expect(result.questionType).toBe("single_choice");
  });

  it("does not infer single-vs-multiple merely from option labels", () => {
    const result = applyQuestionRules([], {
      sourceDocumentId: "paper-doc",
      questionNumber: 1,
      statementText: "Calculate the following.",
      hasOptions: true,
    });
    expect(result.questionType).toBe("unknown");
    expect(result.inference.source).toBe("option_detection");
  });

  it("gives a question-level explicit instruction precedence over a range rule", () => {
    const analysis = detectQuestionRules([
      paper("Questions 1 to 5 are multiple correct.\nQ.3 This question has only one correct option."),
    ]);
    const result = applyQuestionRules(analysis.rules, {
      sourceDocumentId: "paper-doc",
      questionNumber: 3,
      statementText: "This question has only one correct option.",
      hasOptions: true,
    });
    expect(result.questionType).toBe("single_choice");
    expect(result.inference.source).toBe("question_instruction");
  });

  it("flags conflicting applicable rules instead of guessing", () => {
    const analysis = detectQuestionRules([
      paper("Questions 1 to 5 are multiple correct.\nQuestions 3 to 4 are numerical answer type."),
    ]);
    const result = applyQuestionRules(analysis.rules, {
      sourceDocumentId: "paper-doc",
      questionNumber: 3,
      statementText: "Work out the result.",
      hasOptions: false,
    });
    expect(result.questionType).toBe("unknown");
    expect(result.inference.source).toBe("conflict");
    expect(result.inference.confidence).toBe(0);
  });

  it("extracts explicit positive and negative mark values", () => {
    const analysis = detectQuestionRules([
      paper("SECTION A\n+4 marks for correct answer and -1 mark for incorrect answer.\nQ.1 A question."),
    ]);
    expect(analysis.rules[0].correctMarks).toBe(4);
    expect(analysis.rules[0].incorrectMarks).toBe(-1);
  });

  it("infers question type from a descriptive section heading", () => {
    const analysis = detectQuestionRules([
      paper("SECTION B (Multiple correct options)\\nQ.16 Choose the correct statements."),
    ]);
    expect(analysis.rules[0]).toMatchObject({
      sectionLabel: "SECTION B",
      questionType: "multiple_choice",
    });
    const result = applyQuestionRules(analysis.rules, {
      sourceDocumentId: "paper-doc",
      questionNumber: 16,
      sectionLabel: "SECTION B",
      statementText: "Choose the correct statements.",
      hasOptions: true,
    });
    expect(result.questionType).toBe("multiple_choice");
    expect(result.inference.source).toBe("section_rule");
  });

});
