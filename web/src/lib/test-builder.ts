export const TEST_SUBJECTS = ["PHYSICS", "CHEMISTRY", "MATHS"] as const;

export type TestSubject = (typeof TEST_SUBJECTS)[number];

export type SubjectQuestionCounts = Record<TestSubject, number>;

export interface TestDraftConfig {
  sourcePackageIds: string[];
  questionCounts: SubjectQuestionCounts;
  durationMinutes: number;
  shuffleQuestions: boolean;
}

export function getQuestionTotal(counts: SubjectQuestionCounts): number {
  return TEST_SUBJECTS.reduce((total, subject) => total + counts[subject], 0);
}

export function validateTestDraft(config: TestDraftConfig): string[] {
  const errors: string[] = [];

  if (config.sourcePackageIds.length === 0) {
    errors.push("Select at least one source paper.");
  }
  if (new Set(config.sourcePackageIds).size !== config.sourcePackageIds.length) {
    errors.push("A source paper can only be selected once.");
  }

  for (const subject of TEST_SUBJECTS) {
    const count = config.questionCounts[subject];
    if (!Number.isInteger(count) || count < 0 || count > 180) {
      errors.push(subject + " question count must be an integer from 0 to 180.");
    }
  }

  if (getQuestionTotal(config.questionCounts) < 1) {
    errors.push("Choose at least one question from a subject.");
  }

  if (
    !Number.isInteger(config.durationMinutes) ||
    config.durationMinutes < 1 ||
    config.durationMinutes > 360
  ) {
    errors.push("Duration must be an integer from 1 to 360 minutes.");
  }

  return errors;
}

/**
 * Uniformly samples without replacement. The random source is injectable so
 * the selection behaviour can be tested deterministically.
 */
export function sampleWithoutReplacement<T>(
  items: readonly T[],
  count: number,
  random: () => number = Math.random,
): T[] {
  if (!Number.isInteger(count) || count < 0 || count > items.length) {
    throw new RangeError("Sample size must be an integer within the available item count.");
  }

  const pool = [...items];
  for (let index = pool.length - 1; index > 0; index -= 1) {
    const value = random();
    if (!Number.isFinite(value) || value < 0 || value >= 1) {
      throw new RangeError("Random source must return a value in the range [0, 1).");
    }
    const swapIndex = Math.floor(value * (index + 1));
    [pool[index], pool[swapIndex]] = [pool[swapIndex], pool[index]];
  }

  return pool.slice(0, count);
}
