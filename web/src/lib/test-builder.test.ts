import { describe, expect, it } from "vitest";
import {
  getQuestionTotal,
  sampleWithoutReplacement,
  validateTestDraft,
  type TestDraftConfig,
} from "./test-builder";

const validConfig: TestDraftConfig = {
  sourcePackageIds: ["paper-a", "paper-b"],
  questionCounts: { PHYSICS: 10, CHEMISTRY: 10, MATHS: 10 },
  durationMinutes: 90,
  shuffleQuestions: true,
};

describe("mixed-paper test configuration", () => {
  it("totals the selected per-subject quotas", () => {
    expect(getQuestionTotal(validConfig.questionCounts)).toBe(30);
  });

  it("accepts multiple distinct paper sources and valid subject quotas", () => {
    expect(validateTestDraft(validConfig)).toEqual([]);
  });

  it("requires a source paper, at least one question, and a valid duration", () => {
    const errors = validateTestDraft({
      ...validConfig,
      sourcePackageIds: [],
      questionCounts: { PHYSICS: 0, CHEMISTRY: 0, MATHS: 0 },
      durationMinutes: 0,
    });

    expect(errors).toContain("Select at least one source paper.");
    expect(errors).toContain("Choose at least one question from a subject.");
    expect(errors).toContain("Duration must be an integer from 1 to 360 minutes.");
  });

  it("samples the requested number of unique questions", () => {
    const sequence = [0, 0, 0];
    const selected = sampleWithoutReplacement(
      ["A", "B", "C", "D"],
      3,
      () => sequence.shift() ?? 0,
    );

    expect(selected).toHaveLength(3);
    expect(new Set(selected).size).toBe(3);
    expect(["A", "B", "C", "D"]).toEqual(expect.arrayContaining(selected));
  });

  it("rejects a sample larger than the available pool", () => {
    expect(() => sampleWithoutReplacement([1, 2], 3)).toThrow(RangeError);
  });
});
