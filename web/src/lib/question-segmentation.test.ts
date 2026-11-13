import { describe, expect, it } from "vitest";
import { segmentQuestions } from "./question-segmentation";
import type { ExtractedDocument } from "../types";

function document(
  filename: string,
  role: ExtractedDocument["role"],
  pages: string[],
): ExtractedDocument {
  return {
    id: filename,
    filename,
    role,
    sizeBytes: 100,
    pageCount: pages.length,
    pages: pages.map((text, index) => ({
      pageNumber: index + 1,
      text,
      textCharCount: text.length,
      likelyScanned: text.length < 40,
    })),
    blob: new Blob(),
  };
}

describe("question segmentation", () => {
  it("detects Q.1, Q1 and Question 2 markers while preserving multiline question text", () => {
    const source = document("paper.pdf", "question_paper", [
      [
        "JEE Main 2025",
        "Q1. A particle moves with uniform velocity.",
        "Choose the correct option.",
        "(1) First option",
        "(2) Second option",
        "Q.2",
        "A second question continues on the next page.",
      ].join("\n"),
      [
        "1/2",
        "The continuation of question two.",
        "Question 3: Calculate the numerical value of x.",
        "END OF THE QUESTION PAPER",
        "Ignored trailing content",
      ].join("\n"),
    ]);

    const result = segmentQuestions([source]);

    expect(result.questions).toHaveLength(3);
    expect(result.questions[0].questionNumber).toBe(1);
    expect(result.questions[0].statementText).toContain("(1) First option");
    expect(result.questions[1].statementText).toContain("continuation of question two");
    expect(result.questions[1].sourcePageStart).toBe(1);
    expect(result.questions[1].sourcePageEnd).toBe(2);
    expect(result.questions[2].questionNumber).toBe(3);
    expect(result.questions[2].statementText).toContain("Calculate the numerical value");
    expect(result.questions[2].statementText).not.toContain("Ignored trailing content");
  });

  it("keeps repeated question numbers in separate blocks", () => {
    const source = document("advanced.pdf", "question_paper", [
      "Q.1 First physics question.\nQ.2 Second physics question.\nQ.3 Third physics question.\nEND OF THE QUESTION PAPER",
      "Q.1 First chemistry question.\nQ.2 Second chemistry question.\nEND OF THE QUESTION PAPER",
      "Q.1 First maths question.\nEND OF THE QUESTION PAPER",
    ]);

    const result = segmentQuestions([source]);

    expect(result.questions.map((question) => question.blockNumber)).toEqual([1, 1, 1, 2, 2, 3]);
    expect(result.questions.map((question) => question.questionNumber)).toEqual([1, 2, 3, 1, 2, 1]);
    expect(result.questions.every((question) => question.subject === "UNASSIGNED")).toBe(true);
  });

  it("recognizes explicit subject headings without guessing unlabeled sections", () => {
    const source = document("labelled.pdf", "question_paper", [
      "PHYSICS\nQ.1 A physics question.\nMATHEMATICS\nQ.1 A maths question.",
    ]);

    const result = segmentQuestions([source]);

    expect(result.questions.map((question) => question.subject)).toEqual(["PHYSICS", "MATHS"]);
  });

  it("does not treat Ques. answer-key rows as question starts", () => {
    const source = document("key.pdf", "answer_key", [
      "PAPER-1 PHYSICS\nQues. 1 2 3\nAns. A B C",
    ]);

    const result = segmentQuestions([source]);

    expect(result.questions).toHaveLength(0);
    expect(result.warnings[0]).toContain("No document is labelled Question paper");
  });

  it("falls back to unknown-role documents only when no question-paper role is present", () => {
    const source = document("unclassified.pdf", "unknown", ["Q.1 A question from an unclassified document."]);
    const result = segmentQuestions([source]);

    expect(result.questions).toHaveLength(1);
  });

  it("flags scanned pages and leaves all extracted questions unverified", () => {
    const source = document("scan.pdf", "question_paper", [
      "Q.1 A readable question statement.",
      "",
    ]);
    source.pages[1].likelyScanned = true;

    const result = segmentQuestions([source]);

    expect(result.questions[0].status).toBe("needs_review");
    expect(result.warnings.some((warning) => warning.includes("little selectable text"))).toBe(true);
  });

  it("creates a separate option crop from positioned A-D option markers", () => {
    const source = document("visual.pdf", "question_paper", [
      "Q1. Calculate the result.\n(A) First option\n(B) Second option\nQ2. Next question.",
    ]);
    source.pages[0].lines = [
      { text: "Q1. Calculate the result.", x: 0.05, y: 0.10, width: 0.55, height: 0.02, columnIndex: 0 },
      { text: "(A) First option", x: 0.08, y: 0.32, width: 0.35, height: 0.02, columnIndex: 0 },
      { text: "(B) Second option", x: 0.08, y: 0.42, width: 0.38, height: 0.02, columnIndex: 0 },
      { text: "Q2. Next question.", x: 0.05, y: 0.60, width: 0.45, height: 0.02, columnIndex: 0 },
    ];

    const result = segmentQuestions([source]);
    const first = result.questions[0];

    expect(first.sourceRegions?.[0]).toMatchObject({ kind: "question", pageNumber: 1 });
    expect(first.optionRegions).toHaveLength(1);
    expect(first.optionRegions?.[0]).toMatchObject({
      kind: "options",
      pageNumber: 1,
      x: 0.035,
    });
    expect(first.optionRegions?.[0].y).toBeCloseTo(0.308);
    expect(first.optionRegions?.[0].height).toBeCloseTo(0.28);
    expect(first.hasOptions).toBe(true);
  });


  it("automatically classifies questions from descriptive section headings", () => {
    const source = document("sectioned.pdf", "question_paper", [
      "PHYSICS\nSECTION B (Multiple correct options)\nQ.16 Select all valid statements.",
    ]);
    const result = segmentQuestions([source]);

    expect(result.questions[0]).toMatchObject({
      subject: "PHYSICS",
      sectionLabel: "SECTION B",
      questionType: "multiple_choice",
      questionTypeInference: {
        source: "section_rule",
        confidence: 0.96,
      },
    });
    expect(result.rules[0].evidence).toBe("Multiple correct options");
  });

});
