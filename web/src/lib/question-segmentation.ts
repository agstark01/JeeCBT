import type {
  ExtractedDocument,
  QuestionDraft,
  QuestionSubject,
  Subject,
} from "../types";

export interface QuestionSegmentationResult {
  questions: QuestionDraft[];
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

export function segmentQuestions(
  documents: ExtractedDocument[],
): QuestionSegmentationResult {
  const designated = documents.filter((document) => document.role === "question_paper");
  const fallback = documents.filter((document) => document.role === "unknown");
  const sourceDocuments = designated.length > 0 ? designated : fallback;
  const warnings: string[] = [];

  if (sourceDocuments.length === 0) {
    return {
      questions: [],
      warnings: [
        "No document is labelled Question paper. Change the document role in the import workflow, then run segmentation again.",
      ],
      sourceDocumentCount: 0,
    };
  }

  const questions: QuestionDraft[] = [];
  let prefaceTextFound = false;

  for (const document of sourceDocuments) {
    let current: QuestionDraft | undefined;
    let currentLines: string[] = [];
    let activeSubject: QuestionSubject = "UNASSIGNED";
    let activeSection: string | undefined;
    let activePaperLabel: string | undefined;
    let blockNumber = 1;
    let previousQuestionNumber: number | undefined;
    let scannedPages = 0;

    const finishCurrent = () => {
      if (!current) return;
      current.statementText = currentLines.join("\n").trim();
      if (current.statementText.length === 0) {
        warnings.push(
          document.filename + ": Q" + current.questionNumber +
          " on page " + current.sourcePageStart +
          " has no extracted text. Check the source page; it may be image-only.",
        );
      }
      questions.push(current);
      current = undefined;
      currentLines = [];
    };

    for (const page of document.pages) {
      if (page.likelyScanned) scannedPages += 1;
      const lines = page.text.split(/\r?\n/);

      for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line || isRepeatedPageFurniture(line)) continue;

        if (END_MARKER.test(line)) {
          // A combined JEE Advanced PDF may contain multiple subject papers,
          // each with its own end marker. End the current question, not the file.
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
          previousQuestionNumber = questionNumber;
          const firstLineBody = questionMatch.groups.body.trim();
          if (firstLineBody) currentLines.push(firstLineBody);
          continue;
        }

        if (current) {
          currentLines.push(line);
          current.sourcePageEnd = page.pageNumber;
        } else if (line.length > 24) {
          // General instructions before Q1 are not silently assigned to a question.
          prefaceTextFound = true;
        }
      }

    }

    finishCurrent();

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
      prefaceTextFound = false;
    }
    if (questions.every((question) => question.sourceDocumentId !== document.id)) {
      warnings.push(
        document.filename + ": no question-number markers were detected. Check the PDF layout or document role.",
      );
    }
  }

  if (questions.length === 0 && warnings.length === 0) {
    warnings.push("No question markers were detected in the selected question-paper documents.");
  }

  return { questions, warnings, sourceDocumentCount: sourceDocuments.length };
}
