import type {
  ExtractedDocument,
  QuestionRule,
  QuestionType,
} from "../types";

export interface QuestionRuleAnalysis {
  rules: QuestionRule[];
  warnings: string[];
}

const SECTION_HEADING = /^\s*(SECTION\s*[-:]?\s*[A-Z0-9IVX]+)(?:\s*(?:[-:–—]|\()\s*(.*?)\)?)?\s*$/i;
const QUESTION_MARKER = /^\s*(?:Q\s*\.?\s*|QUESTION\s+(?:NO\.?\s*)?)(\d{1,3})\b/i;
const RANGE = /(?:questions?|q\s*\.?\s*)\s*(\d{1,3})\s*(?:to|[-–—])\s*(?:q\s*\.?\s*)?(\d{1,3})/i;

function inferType(text: string): Exclude<QuestionType, "unknown"> | undefined {
  if (/\b(numerical\s+(?:value|answer)|integer\s+answer|decimal\s+answer|enter\s+the\s+value)\b/i.test(text)) {
    return "numerical";
  }
  if (/\b(one\s+or\s+more|more\s+than\s+one|multiple\s+correct|multiple\s+answers|select\s+all\s+that\s+apply)\b/i.test(text)) {
    return "multiple_choice";
  }
  if (/\b(only\s+one\s+correct|single\s+correct|exactly\s+one\s+correct|one\s+correct\s+option)\b/i.test(text)) {
    return "single_choice";
  }
  return undefined;
}

function inferMarks(text: string): { correctMarks?: number; incorrectMarks?: number } {
  const correct = text.match(
    /(?:\+\s*(\d+(?:\.\d+)?)\s*marks?\s*(?:for|per)\s*correct(?:\s+answer)?|(\d+(?:\.\d+)?)\s*marks?\s*(?:will\s+be\s+)?awarded\s+for\s+(?:each\s+)?correct)/i,
  );
  const incorrect = text.match(
    /(?:-\s*(\d+(?:\.\d+)?)\s*marks?\s*(?:for|per)\s*incorrect(?:\s+answer)?|(\d+(?:\.\d+)?)\s*marks?\s*(?:will\s+be\s+)?deducted\s+for\s+(?:each\s+)?incorrect)/i,
  );
  const correctValue = correct ? Number(correct[1] ?? correct[2] ?? NaN) : undefined;
  const incorrectValue = incorrect ? Number(incorrect[1] ?? incorrect[2] ?? NaN) : undefined;
  return {
    correctMarks: correctValue !== undefined && Number.isFinite(correctValue) ? correctValue : undefined,
    incorrectMarks: incorrectValue !== undefined && Number.isFinite(incorrectValue) ? -Math.abs(incorrectValue) : undefined,
  };
}

function makeRule(
  document: ExtractedDocument,
  pageNumber: number,
  evidence: string,
  questionType: Exclude<QuestionType, "unknown"> | undefined,
  sectionLabel?: string,
  questionStart?: number,
  questionEnd?: number,
): QuestionRule {
  const marks = inferMarks(evidence);
  return {
    id: crypto.randomUUID(),
    sourceDocumentId: document.id,
    questionStart,
    questionEnd,
    sectionLabel,
    questionType,
    ...marks,
    evidence: evidence.trim().slice(0, 500),
    sourcePage: pageNumber,
    confidence: questionType ? 0.96 : 0.88,
  };
}

/**
 * Extract explicit question-type and marking instructions. The parser deliberately
 * does not infer single-vs-multiple choice merely because option labels exist.
 */
export function detectQuestionRules(documents: ExtractedDocument[]): QuestionRuleAnalysis {
  const designated = documents.filter((document) => document.role === "question_paper");
  const fallback = documents.filter((document) => document.role === "unknown");
  const sources = designated.length > 0 ? designated : fallback;
  const rules: QuestionRule[] = [];
  const warnings: string[] = [];

  for (const document of sources) {
    for (const page of document.pages) {
      const lines = page.text.split(/\r?\n/);
      let activeSection: string | undefined;
      let sectionEvidence: string[] = [];

      const flushSection = () => {
        if (!activeSection || sectionEvidence.length === 0) return;
        const evidence = sectionEvidence.join(" ").trim();
        const questionType = inferType(evidence);
        const marks = inferMarks(evidence);
        if (questionType || marks.correctMarks !== undefined || marks.incorrectMarks !== undefined) {
          rules.push(makeRule(document, page.pageNumber, evidence, questionType, activeSection));
        }
        sectionEvidence = [];
      };

      for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index].trim();
        if (!line) continue;
        const section = line.match(SECTION_HEADING);
        if (section) {
          flushSection();
          activeSection = section[1].toUpperCase().replace(/\s+/g, " ");
          const headingEvidence = section[2]?.trim();
          if (headingEvidence) {
            const questionType = inferType(headingEvidence);
            const marks = inferMarks(headingEvidence);
            if (questionType || marks.correctMarks !== undefined || marks.incorrectMarks !== undefined) {
              rules.push(makeRule(document, page.pageNumber, headingEvidence, questionType, activeSection));
            }
          }
          continue;
        }

        const range = line.match(RANGE);
        if (range) {
          const lineMarks = inferMarks(line);
          const lineHasRule = Boolean(
            inferType(line) ||
            lineMarks.correctMarks !== undefined ||
            lineMarks.incorrectMarks !== undefined
          );
          const context = lineHasRule
            ? line
            : [lines[index - 1] ?? "", line, lines[index + 1] ?? ""].join(" ");
          const questionType = inferType(context);
          const marks = inferMarks(context);
          if (questionType || marks.correctMarks !== undefined || marks.incorrectMarks !== undefined) {
            rules.push(
              makeRule(
                document,
                page.pageNumber,
                context,
                questionType,
                activeSection,
                Number(range[1]),
                Number(range[2]),
              ),
            );
          }
          continue;
        }

        if (QUESTION_MARKER.test(line)) {
          flushSection();
          activeSection = undefined;
          continue;
        }

        if (activeSection && sectionEvidence.length < 8) {
          const directType = inferType(line);
          const directMarks = inferMarks(line);
          if (
            directType ||
            directMarks.correctMarks !== undefined ||
            directMarks.incorrectMarks !== undefined
          ) {
            rules.push(makeRule(document, page.pageNumber, line, directType, activeSection));
            continue;
          }
          sectionEvidence.push(line);
        } else if (!activeSection) {
          const type = inferType(line);
          const marks = inferMarks(line);
          if (type || marks.correctMarks !== undefined || marks.incorrectMarks !== undefined) {
            // Document-wide instructions must explicitly say they apply to all/every questions.
            if (/\b(all|every|each)\s+questions?\b/i.test(line)) {
              rules.push(makeRule(document, page.pageNumber, line, type));
            }
          }
        }
      }
      flushSection();
    }
  }

  if (sources.length === 0) {
    warnings.push("No question-paper document was available for instruction analysis.");
  }

  return { rules, warnings };
}

export function applyQuestionRules(
  rules: QuestionRule[],
  input: {
    sourceDocumentId: string;
    questionNumber: number;
    sectionLabel?: string;
    statementText: string;
    hasOptions: boolean;
  },
): {
  questionType: QuestionType;
  inference: {
    source: "question_instruction" | "section_rule" | "document_rule" | "option_detection" | "unknown" | "conflict";
    evidence: string;
    confidence: number;
    ruleId?: string;
  };
  correctMarks?: number;
  incorrectMarks?: number;
} {
  const explicitType = inferType(input.statementText);
  if (explicitType) {
    return {
      questionType: explicitType,
      inference: {
        source: "question_instruction",
        evidence: input.statementText.match(/[^.\n]*(?:numerical\s+(?:value|answer)|integer\s+answer|decimal\s+answer|one\s+or\s+more|more\s+than\s+one|multiple\s+correct|multiple\s+answers|only\s+one\s+correct|single\s+correct|exactly\s+one\s+correct|one\s+correct\s+option)[^.\n]*/i)?.[0] ?? input.statementText.slice(0, 180),
        confidence: 0.98,
      },
    };
  }

  const applicable = rules.filter((rule) =>
    rule.sourceDocumentId === input.sourceDocumentId &&
    (rule.questionStart === undefined || (
      input.questionNumber >= rule.questionStart &&
      input.questionNumber <= (rule.questionEnd ?? rule.questionStart)
    )) &&
    (!rule.sectionLabel || rule.sectionLabel === input.sectionLabel),
  );
  const typedRules = applicable.filter((rule) => rule.questionType);
  const types = new Set(typedRules.map((rule) => rule.questionType));
  if (types.size > 1) {
    return {
      questionType: "unknown",
      inference: {
        source: "conflict",
        evidence: typedRules.map((rule) => rule.evidence).join(" | ").slice(0, 500),
        confidence: 0,
      },
    };
  }

  const selected = typedRules[0];
  if (selected?.questionType) {
    return {
      questionType: selected.questionType,
      inference: {
        source: selected.questionStart !== undefined
          ? "section_rule"
          : selected.sectionLabel
            ? "section_rule"
            : "document_rule",
        evidence: selected.evidence,
        confidence: selected.confidence,
        ruleId: selected.id,
      },
      correctMarks: selected.correctMarks,
      incorrectMarks: selected.incorrectMarks,
    };
  }

  if (input.hasOptions) {
    return {
      questionType: "unknown",
      inference: {
        source: "option_detection",
        evidence: "Option labels were detected, but the paper does not establish whether one or multiple options are correct.",
        confidence: 0.65,
      },
    };
  }

  return {
    questionType: "unknown",
    inference: { source: "unknown", evidence: "No explicit question-type instruction was detected.", confidence: 0 },
  };
}
