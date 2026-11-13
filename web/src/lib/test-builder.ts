import { isMappingScoringEligible } from "./answer-review";
import type { PaperPackage, QuestionDraft, ExtractedDocument } from "../types";

export interface EligibleTestQuestion {
  packageId: string;
  packageTitle: string;
  question: QuestionDraft;
  correctAnswerRaw: string;
  answerSourceFilename: string;
  answerSourcePage: number;
  sourceDocument: ExtractedDocument;
}

export interface TestSelectionResult {
  questions: EligibleTestQuestion[];
  shortages: Partial<Record<TestSubject, { requested: number; available: number }>>;
}

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


/**
 * Return only complete question records whose matching answer mapping and
 * question text have both been verified inside the same paper package.
 * Multiple verified keys pointing at one question are treated as ambiguous.
 */
export function collectEligibleQuestions(
  packages: PaperPackage[],
  sourcePackageIds: string[],
): EligibleTestQuestion[] {
  const selectedIds = new Set(sourcePackageIds);
  const eligible: EligibleTestQuestion[] = [];

  for (const paperPackage of packages) {
    if (!selectedIds.has(paperPackage.id)) continue;
    for (const question of paperPackage.questions ?? []) {
      if (
        question.status !== "verified" ||
        question.subject === "UNASSIGNED" ||
        question.questionType === "unknown" ||
        !question.statementText.trim()
      ) continue;

      const sourceDocument = paperPackage.documents.find(
        (document) => document.id === question.sourceDocumentId,
      );
      if (!sourceDocument) continue;

      const matches = paperPackage.candidates.flatMap((candidate) =>
        candidate.mappings
          .filter((mapping) =>
            isMappingScoringEligible(paperPackage, candidate, mapping) &&
            mapping.linkedQuestionId === question.id ||
            (
              isMappingScoringEligible(paperPackage, candidate, mapping) &&
              !mapping.linkedQuestionId &&
              candidate.targetDocumentId === question.sourceDocumentId &&
              mapping.questionNumber === question.questionNumber &&
              (!mapping.subject || mapping.subject === question.subject ||
                (mapping.subject === "MATHEMATICS" && question.subject === "MATHS"))
            ),
          )
          .map((mapping) => ({ candidate, mapping })),
      );

      if (matches.length !== 1) continue;
      const { candidate, mapping } = matches[0];
      eligible.push({
        packageId: paperPackage.id,
        packageTitle: paperPackage.title,
        question,
        correctAnswerRaw: mapping.answerRaw,
        answerSourceFilename: mapping.sourceFilename || candidate.sourceFilename,
        answerSourcePage: mapping.sourcePage || candidate.sourcePage,
        sourceDocument,
      });
    }
  }
  return eligible;
}

export function selectTestQuestions(
  eligible: EligibleTestQuestion[],
  questionCounts: SubjectQuestionCounts,
  shuffleQuestions: boolean,
  random: () => number = Math.random,
): TestSelectionResult {
  const selected: EligibleTestQuestion[] = [];
  const shortages: Partial<Record<TestSubject, { requested: number; available: number }>> = {};

  for (const subject of TEST_SUBJECTS) {
    const requested = questionCounts[subject];
    if (requested === 0) continue;
    const pool = eligible.filter((item) => item.question.subject === subject);
    if (pool.length < requested) {
      shortages[subject] = { requested, available: pool.length };
      continue;
    }
    const chosen = shuffleQuestions
      ? sampleWithoutReplacement(pool, requested, random)
      : pool.slice(0, requested);
    selected.push(...chosen);
  }

  if (Object.keys(shortages).length > 0) return { questions: [], shortages };
  if (shuffleQuestions) {
    return { questions: sampleWithoutReplacement(selected, selected.length, random), shortages };
  }
  return { questions: selected, shortages };
}
