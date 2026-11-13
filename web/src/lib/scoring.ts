import type {
  ExamAnswerResult,
  ExamAttempt,
  QuestionDraft,
} from "../types";
import type { EligibleTestQuestion } from "./test-builder";

export interface ScoringDefaults {
  correctMarks: number;
  incorrectMarks: number;
}

export interface EvaluatedAnswer {
  status: ExamAnswerResult["status"];
  pointsAwarded: number;
  pointsPossible: number;
}

export function getQuestionOptionLabels(question: QuestionDraft): string[] {
  const detected = [...new Set((question.optionLabels ?? []).map((label) => label.trim().toUpperCase()).filter(Boolean))];
  return detected.length > 0 ? detected : ["A", "B", "C", "D"];
}

function parseChoiceSet(raw: string, allowedLabels: string[]): string[] | undefined {
  const value = raw.trim().toUpperCase();
  if (!value) return [];
  const allowed = new Set(allowedLabels.map((label) => label.toUpperCase()));
  let tokens: string[];
  if (allowedLabels.every((label) => label.length === 1) && /^[A-Z0-9]+$/.test(value)) {
    tokens = [...value];
  } else {
    tokens = value.split(/[,;|\/+\s]+/).map((token) => token.replace(/^[([{]+|[)\]}]+$/g, ""));
  }
  const normalized = tokens.filter(Boolean);
  if (normalized.length === 0 || normalized.some((token) => !allowed.has(token))) return undefined;
  if (new Set(normalized).size !== normalized.length) return undefined;
  return normalized.sort();
}

export function isSupportedAnswerFormat(
  question: QuestionDraft,
  correctAnswerRaw: string,
): boolean {
  if (question.questionType === "numerical") {
    return correctAnswerRaw.trim() !== "" && Number.isFinite(Number(correctAnswerRaw));
  }
  if (question.questionType === "single_choice" || question.questionType === "multiple_choice") {
    const parsed = parseChoiceSet(correctAnswerRaw, getQuestionOptionLabels(question));
    if (!parsed) return false;
    return question.questionType === "multiple_choice" || parsed.length === 1;
  }
  return false;
}

export function isAnswerCorrect(
  question: QuestionDraft,
  selectedAnswerRaw: string,
  correctAnswerRaw: string,
): boolean {
  const selected = selectedAnswerRaw.trim();
  if (!selected) return false;

  if (question.questionType === "numerical") {
    const actual = Number(selected);
    const expected = Number(correctAnswerRaw);
    if (!Number.isFinite(actual) || !Number.isFinite(expected)) return false;
    const tolerance = Math.max(1e-10, Math.abs(expected) * 1e-10);
    return Math.abs(actual - expected) <= tolerance;
  }

  if (question.questionType === "single_choice" || question.questionType === "multiple_choice") {
    const labels = getQuestionOptionLabels(question);
    const actual = parseChoiceSet(selected, labels);
    const expected = parseChoiceSet(correctAnswerRaw, labels);
    if (!actual || !expected) return false;
    if (question.questionType === "single_choice" && (actual.length !== 1 || expected.length !== 1)) {
      return false;
    }
    return actual.length === expected.length && actual.every((value, index) => value === expected[index]);
  }

  return false;
}

export function evaluateAnswer(
  item: EligibleTestQuestion,
  selectedAnswerRaw: string,
  defaults: ScoringDefaults,
): EvaluatedAnswer {
  if (!selectedAnswerRaw.trim()) {
    return {
      status: "unanswered",
      pointsAwarded: 0,
      pointsPossible: item.question.correctMarks ?? defaults.correctMarks,
    };
  }
  const correct = isAnswerCorrect(item.question, selectedAnswerRaw, item.correctAnswerRaw);
  return {
    status: correct ? "correct" : "incorrect",
    pointsAwarded: correct
      ? item.question.correctMarks ?? defaults.correctMarks
      : item.question.incorrectMarks ?? defaults.incorrectMarks,
    pointsPossible: item.question.correctMarks ?? defaults.correctMarks,
  };
}

export function createExamAttempt(input: {
  ownerId: string;
  title: string;
  packageIds: string[];
  questions: EligibleTestQuestion[];
  answers: Record<string, string>;
  durationSeconds: number;
  elapsedSeconds: number;
  defaults: ScoringDefaults;
  createdAt?: number;
  id?: string;
}): ExamAttempt {
  const results: ExamAnswerResult[] = input.questions.map((item) => {
    const selectedAnswer = input.answers[item.question.id] ?? "";
    const evaluated = evaluateAnswer(item, selectedAnswer, input.defaults);
    return {
      questionId: item.question.id,
      packageId: item.packageId,
      paperTitle: item.packageTitle,
      questionNumber: item.question.questionNumber,
      subject: item.question.subject as ExamAnswerResult["subject"],
      questionType: item.question.questionType as ExamAnswerResult["questionType"],
      questionText: item.question.statementText,
      selectedAnswer,
      correctAnswer: item.correctAnswerRaw,
      status: evaluated.status,
      pointsAwarded: evaluated.pointsAwarded,
      pointsPossible: evaluated.pointsPossible,
      answerSourceFilename: item.answerSourceFilename,
      answerSourcePage: item.answerSourcePage,
      questionSourceFilename: item.question.sourceFilename,
      questionSourcePage: item.question.sourcePageStart,
    };
  });

  const score = results.reduce((total, answer) => total + answer.pointsAwarded, 0);
  const maxScore = results.reduce((total, answer) => total + answer.pointsPossible, 0);
  const answeredCount = results.filter((answer) => answer.status !== "unanswered").length;
  return {
    id: input.id ?? crypto.randomUUID(),
    ownerId: input.ownerId,
    createdAt: input.createdAt ?? Date.now(),
    title: input.title,
    packageIds: [...new Set(input.packageIds)],
    durationSeconds: input.durationSeconds,
    elapsedSeconds: Math.max(0, Math.min(input.durationSeconds, input.elapsedSeconds)),
    questionCount: results.length,
    answeredCount,
    correctCount: results.filter((answer) => answer.status === "correct").length,
    incorrectCount: results.filter((answer) => answer.status === "incorrect").length,
    unansweredCount: results.filter((answer) => answer.status === "unanswered").length,
    score,
    maxScore,
    percentage: maxScore > 0 ? (score / maxScore) * 100 : 0,
    answers: results,
  };
}
