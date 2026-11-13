import type {
  ExtractedDocument,
  ExtractedPage,
  ExtractedTextLine,
  QuestionCaptureRegion,
  QuestionDraft,
  QuestionRule,
  QuestionSubject,
  Subject,
} from "../types";
import { applyQuestionRules, detectQuestionRules } from "./question-rules";

export interface QuestionSegmentationResult {
  questions: QuestionDraft[];
  rules: QuestionRule[];
  warnings: string[];
  sourceDocumentCount: number;
}

const QUESTION_MARKER =
  /^\s*(?:Q\s*\.?\s*|QUESTION\s+(?:NO\.?\s*)?)(?<number>\d{1,3})\s*(?:[.):]\s*)?(?<body>.*)$/i;

const SUBJECT_HEADING =
  /^\s*(?:SUBJECT\s*[:\-]\s*)?(PHYSICS|CHEMISTRY|MATHS|MATHEMATICS)\s*$/i;

const PAPER_HEADING = /^\s*(PAPER[\s-]*\d+)\s*$/i;
const SECTION_HEADING = /^\s*(SECTION\s*[-:]?\s*[A-Z0-9IVX]+)\s*$/i;
const END_MARKER = /^\s*END\s+OF\s+THE\s+QUESTION\s+PAPER\s*$/i;
const OPTION_MARKER = /^\s*(?:\(([A-D])\)|([A-D])[.)]|\(([1-4])\)|([1-4])[.)])\s+/gm;

interface QuestionMarkerPosition {
  question: QuestionDraft;
  pageNumber: number;
  line: ExtractedTextLine;
  lineIndex: number;
}

function normalizeSubject(value: string): Subject {
  return value.toUpperCase() === "MATHEMATICS"
    ? "MATHS"
    : value.toUpperCase() as Subject;
}

function isRepeatedPageFurniture(line: string): boolean {
  const value = line.trim();
  if (!value) return true;
  return (
    /^JEE\s*(?:\(|MAIN\b)/i.test(value) ||
    /^QUESTION\s+PAPER\s*$/i.test(value) ||
    /^MATHONGO\b/i.test(value) ||
    /^PAPER\s+\d+\s*$/i.test(value) ||
    /^\d{1,3}\s*\/\s*\d{1,3}\s*$/.test(value)
  );
}

function newQuestionId(): string {
  return crypto.randomUUID();
}

function linesForPage(page: ExtractedPage): ExtractedTextLine[] {
  if (page.lines?.length) return page.lines;
  return page.text.split(/\r?\n/).map((text, index) => ({
    text,
    x: 0.04,
    y: Math.min(0.94, 0.03 + index * 0.02),
    width: 0.92,
    height: 0.015,
    columnIndex: 0,
  }));
}

function columnBounds(
  page: ExtractedPage,
  columnIndex: number,
): { x: number; width: number } {
  if (page.columnSplit !== undefined) {
    const split = Math.max(0.25, Math.min(0.75, page.columnSplit));
    return columnIndex === 0
      ? { x: 0.025, width: Math.max(0.2, split - 0.04) }
      : { x: split + 0.015, width: Math.max(0.2, 0.96 - split) };
  }
  return { x: 0.035, width: 0.93 };
}

/**
 * Crop regions are normalized descriptors, not raster images. Reviewers render
 * the referenced local PDF page and crop it in a canvas, preserving diagrams,
 * tables, options, equations and original typography without storing duplicate
 * full-page bitmaps.
 */
function buildQuestionRegions(
  document: ExtractedDocument,
  markers: QuestionMarkerPosition[],
): void {
  for (let index = 0; index < markers.length; index += 1) {
    const marker = markers[index];
    const next = markers[index + 1];
    const startPage = marker.pageNumber;
    const endPage = Math.max(startPage, marker.question.sourcePageEnd);
    const regions: QuestionCaptureRegion[] = [];

    for (let pageNumber = startPage; pageNumber <= endPage; pageNumber += 1) {
      const page = document.pages.find((item) => item.pageNumber === pageNumber);
      if (!page) continue;
      const bounds = columnBounds(page, marker.line.columnIndex);
      let top = pageNumber === startPage
        ? Math.max(0.015, marker.line.y - 0.012)
        : 0.025;
      let bottom = 0.975;

      if (next?.pageNumber === pageNumber && next.line.columnIndex === marker.line.columnIndex) {
        bottom = Math.max(top + 0.025, next.line.y - 0.012);
      } else if (
        next?.pageNumber === pageNumber &&
        next.line.columnIndex !== marker.line.columnIndex
      ) {
        bottom = 0.975;
      }

      top = Math.min(top, 0.94);
      bottom = Math.min(0.985, Math.max(top + 0.025, bottom));
      regions.push({
        pageNumber,
        x: bounds.x,
        y: top,
        width: bounds.width,
        height: bottom - top,
        columnIndex: marker.line.columnIndex,
        kind: "question",
      });
    }

    marker.question.sourceRegions = regions;
  }
}

function finishQuestion(
  question: QuestionDraft | undefined,
  currentLines: string[],
  rules: QuestionRule[],
): void {
  if (!question) return;
  question.statementText = currentLines.join("\n").trim();
  const optionMatches = [...question.statementText.matchAll(OPTION_MARKER)];
  const labels = optionMatches.map((match) => match[1] ?? match[2] ?? match[3] ?? match[4]);
  question.hasOptions = labels.length > 0;
  question.optionLabels = [...new Set(labels)];

  const classification = applyQuestionRules(rules, {
    sourceDocumentId: question.sourceDocumentId,
    questionNumber: question.questionNumber,
    sectionLabel: question.sectionLabel,
    statementText: question.statementText,
    hasOptions: question.hasOptions,
  });
  question.questionType = classification.questionType;
  question.questionTypeInference = classification.inference;
  question.correctMarks = classification.correctMarks;
  question.incorrectMarks = classification.incorrectMarks;
}

export function segmentQuestions(
  documents: ExtractedDocument[],
): QuestionSegmentationResult {
  const designated = documents.filter((document) => document.role === "question_paper");
  const fallback = documents.filter((document) => document.role === "unknown");
  const sourceDocuments = designated.length > 0 ? designated : fallback;
  const warnings: string[] = [];
  const ruleAnalysis = detectQuestionRules(documents);
  warnings.push(...ruleAnalysis.warnings);
  const questions: QuestionDraft[] = [];

  if (sourceDocuments.length === 0) {
    return {
      questions: [],
      rules: ruleAnalysis.rules,
      warnings: [
        ...warnings,
        "No document is labelled Question paper. Change the document role in the import workflow, then run segmentation again.",
      ],
      sourceDocumentCount: 0,
    };
  }

  for (const document of sourceDocuments) {
    let current: QuestionDraft | undefined;
    let currentLines: string[] = [];
    let activeSubject: QuestionSubject = "UNASSIGNED";
    let activeSection: string | undefined;
    let activePaperLabel: string | undefined;
    let blockNumber = 1;
    let previousQuestionNumber: number | undefined;
    let scannedPages = 0;
    let prefaceTextFound = false;
    const documentQuestions: QuestionDraft[] = [];
    const markerPositions: QuestionMarkerPosition[] = [];

    const finishCurrent = () => {
      if (!current) return;
      finishQuestion(current, currentLines, ruleAnalysis.rules);
      if (current.statementText.length === 0) {
        warnings.push(
          document.filename + ": Q" + current.questionNumber +
          " on page " + current.sourcePageStart +
          " has no extracted text. Check the source page; it may be image-only.",
        );
      }
      documentQuestions.push(current);
      questions.push(current);
      current = undefined;
      currentLines = [];
    };

    for (const page of document.pages) {
      if (page.likelyScanned) scannedPages += 1;
      const pageLines = linesForPage(page);

      for (let lineIndex = 0; lineIndex < pageLines.length; lineIndex += 1) {
        const positioned = pageLines[lineIndex];
        const line = positioned.text.trim();
        if (!line || isRepeatedPageFurniture(line)) continue;

        if (END_MARKER.test(line)) {
          finishCurrent();
          continue;
        }

        const subjectMatch = line.match(SUBJECT_HEADING);
        if (subjectMatch) {
          activeSubject = normalizeSubject(subjectMatch[1]);
          continue;
        }

        const paperMatch = line.match(PAPER_HEADING);
        if (paperMatch) {
          activePaperLabel = paperMatch[1].toUpperCase().replace(/\s+/g, "-");
          continue;
        }

        const sectionMatch = line.match(SECTION_HEADING);
        if (sectionMatch) {
          activeSection = sectionMatch[1].toUpperCase().replace(/\s+/g, " ");
          continue;
        }

        const questionMatch = line.match(QUESTION_MARKER);
        if (questionMatch?.groups) {
          const questionNumber = Number(questionMatch.groups.number);
          if (questionNumber === 1 && previousQuestionNumber !== undefined && previousQuestionNumber > 1) {
            blockNumber += 1;
          } else if (
            previousQuestionNumber !== undefined &&
            questionNumber < previousQuestionNumber - 3 &&
            questionNumber !== 1
          ) {
            warnings.push(
              document.filename + ": question numbering moves backwards from Q" +
              previousQuestionNumber + " to Q" + questionNumber +
              " near page " + page.pageNumber +
              ". The PDF may use columns or a non-linear reading order; verify this block.",
            );
          }

          finishCurrent();
          current = {
            id: newQuestionId(),
            questionNumber,
            blockNumber,
            subject: activeSubject,
            sectionLabel: activeSection,
            paperLabel: activePaperLabel,
            questionType: "unknown",
            statementText: "",
            sourceDocumentId: document.id,
            sourceFilename: document.filename,
            sourcePageStart: page.pageNumber,
            sourcePageEnd: page.pageNumber,
            status: "needs_review",
            detectionMethod: "question_number_marker",
          };
          markerPositions.push({
            question: current,
            pageNumber: page.pageNumber,
            line: positioned,
            lineIndex,
          });
          previousQuestionNumber = questionNumber;
          const firstLineBody = questionMatch.groups.body.trim();
          if (firstLineBody) currentLines.push(firstLineBody);
          continue;
        }

        if (current) {
          currentLines.push(line);
          current.sourcePageEnd = page.pageNumber;
        } else if (line.length > 24) {
          prefaceTextFound = true;
        }
      }

      if (current && page.pageNumber > current.sourcePageStart && page.lines?.length === 0) {
        current.sourcePageEnd = page.pageNumber;
      }
    }

    finishCurrent();
    buildQuestionRegions(document, markerPositions);

    if (scannedPages > 0) {
      warnings.push(
        document.filename + ": " + scannedPages +
        " page(s) have little selectable text. Questions on those pages may be missing until local OCR is available.",
      );
    }
    if (prefaceTextFound) {
      warnings.push(
        document.filename + ": text before the first detected question was not attached to a question. Review general instructions in the source PDF.",
      );
    }
    if (documentQuestions.length === 0) {
      warnings.push(
        document.filename + ": no question-number markers were detected. Check the PDF layout or document role.",
      );
    }
  }

  return {
    questions,
    rules: ruleAnalysis.rules,
    warnings,
    sourceDocumentCount: sourceDocuments.length,
  };
}
