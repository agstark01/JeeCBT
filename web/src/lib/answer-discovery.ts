import type {
  AnswerKeyCandidate,
  AnswerMapping,
  ExtractedDocument,
  Subject,
} from "../types";

const ANSWER_HEADING =
  /^\s*(?:(?:OFFICIAL|FINAL|PROVISIONAL|REVISED)\s+)?(?:ANSWER\s+KEYS?|CORRECT\s+ANSWERS?|KEY\s+TO\s+(?:THE\s+)?QUESTIONS)(?:\s*[:\-].*)?\s*$/i;

const SUBJECT_HEADING =
  /^\s*(?<paper>PAPER[\s-]*\d+)\s+(?<subject>PHYSICS|CHEMISTRY|MATHS|MATHEMATICS)\s*$/i;

const QUESTION_ROW = /^\s*Ques?\.?\s+(?<values>.+?)\s*$/i;
const ANSWER_ROW = /^\s*Ans?\.?\s+(?<values>.+?)\s*$/i;

const NUMBERED_PARENTHESIZED =
  /(?<![A-Za-z0-9.])(?<number>\d{1,3})\s*[.)]\s*\(\s*(?<answer>[^()\n]{1,32}?)\s*\)/g;

function newId(): string {
  return crypto.randomUUID();
}

function splitCells(value: string): string[] {
  return value.trim().split(/\s+/).filter(Boolean);
}

function makeMappings(
  questionNumbers: number[],
  answers: string[],
  sourceFilename: string,
  sourcePage: number,
  subject?: Subject,
  paperLabel?: string,
): AnswerMapping[] {
  if (questionNumbers.length !== answers.length) return [];
  return questionNumbers.map((questionNumber, index) => ({
    questionNumber,
    answerRaw: answers[index],
    sourceFilename,
    sourcePage,
    subject,
    paperLabel,
    reviewStatus: "proposed",
  }));
}

function parseSubjectTable(
  documents: ExtractedDocument[],
  text: string,
  filename: string,
  pageNumber: number,
): AnswerKeyCandidate[] {
  const candidates: AnswerKeyCandidate[] = [];
  let current:
    | {
        paperLabel: string;
        subject: Subject;
        mappings: AnswerMapping[];
        unmatched: string[];
      }
    | undefined;
  let pendingQuestions: number[] | undefined;

  const finish = () => {
    if (current && (current.mappings.length > 0 || current.unmatched.length > 0)) {
      candidates.push({
        id: newId(),
        sourceFilename: filename,
        sourcePage: pageNumber,
        subject: current.subject,
        paperLabel: current.paperLabel,
        detectionReasons: ["subject_wise_question_answer_table"],
        extractionMethod: "subject_table_ques_ans_row_pairs",
        confidence: 0.96,
        rawExcerpt:
          current.unmatched.join("\n") ||
          current.paperLabel + " " + current.subject + " table detected on page " + pageNumber + ".",
        mappings: current.mappings,
        reviewRequired: true,
      });
    }
    current = undefined;
    pendingQuestions = undefined;
  };

  for (const line of text.split(/\r?\n/)) {
    const heading = line.match(SUBJECT_HEADING);
    if (heading?.groups) {
      finish();
      current = {
        paperLabel: heading.groups.paper.toUpperCase().replace(/\s+/g, "-"),
        subject: heading.groups.subject.toUpperCase() as Subject,
        mappings: [],
        unmatched: [],
      };
      continue;
    }

    if (!current) continue;

    const questionRow = line.match(QUESTION_ROW);
    if (questionRow?.groups) {
      const cells = splitCells(questionRow.groups.values);
      pendingQuestions =
        cells.length > 0 && cells.every((cell) => /^\d+$/.test(cell))
          ? cells.map(Number)
          : undefined;
      continue;
    }

    const answerRow = line.match(ANSWER_ROW);
    if (answerRow?.groups && pendingQuestions) {
      const answers = splitCells(answerRow.groups.values);
      const mappings = makeMappings(
        pendingQuestions,
        answers,
        filename,
        pageNumber,
        current.subject,
        current.paperLabel,
      );
      if (mappings.length === 0) {
        current.unmatched.push(
          "Unmatched Ques./Ans. rows on page " + pageNumber +
          "; expected " + pendingQuestions.length + " answers, found " + answers.length + ".",
        );
      } else {
        current.mappings.push(...mappings);
      }
      pendingQuestions = undefined;
    }
  }

  finish();
  return candidates.map((candidate) => {
    const sourceMatches = documents.filter((document) =>
      document.filename === candidate.sourceFilename &&
      document.pages.some((page) => page.pageNumber === candidate.sourcePage)
    );
    const sourceDocumentId = sourceMatches.length === 1 ? sourceMatches[0].id : undefined;
    const questionDocuments = documents.filter((document) => document.role === "question_paper");
    const sourceIsQuestionPaper = sourceDocumentId !== undefined &&
      questionDocuments.some((document) => document.id === sourceDocumentId);
    const targetDocumentId = sourceIsQuestionPaper
      ? sourceDocumentId
      : questionDocuments.length === 1
        ? questionDocuments[0].id
        : undefined;
    return {
      ...candidate,
      sourceDocumentId,
      targetDocumentId,
      mappings: candidate.mappings.map((mapping) => ({
        ...mapping,
        id: mapping.id ?? newId(),
        sourceDocumentId,
      })),
    };
  });
}

function parseHeadingKey(
  text: string,
  filename: string,
  pageNumber: number,
): AnswerKeyCandidate | undefined {
  const lines = text.split(/\r?\n/);
  const headingIndex = lines.findIndex((line) => ANSWER_HEADING.test(line));
  if (headingIndex < 0) return undefined;

  const keyText = lines.slice(headingIndex + 1).join("\n");
  const mappings: AnswerMapping[] = [];

  for (const match of keyText.matchAll(NUMBERED_PARENTHESIZED)) {
    if (!match.groups) continue;
    const answer = match.groups.answer.trim();
    if (!answer) continue;
    mappings.push({
      questionNumber: Number(match.groups.number),
      answerRaw: answer,
      sourceFilename: filename,
      sourcePage: pageNumber,
      reviewStatus: "proposed",
    });
  }

  return {
    id: newId(),
    sourceFilename: filename,
    sourcePage: pageNumber,
    detectionReasons: ["answer_key_heading"],
    extractionMethod: "heading_and_parenthesized_numbered_pairs",
    confidence: mappings.length >= 3 ? 0.98 : 0.68,
    rawExcerpt: keyText.slice(0, 5000),
    mappings,
    reviewRequired: true,
  };
}

export function discoverAnswerKeys(
  documents: ExtractedDocument[],
): AnswerKeyCandidate[] {
  const candidates: AnswerKeyCandidate[] = [];

  for (const document of documents) {
    for (const page of document.pages) {
      if (!page.text.trim()) continue;

      const tableCandidates = parseSubjectTable(
        documents,
        page.text,
        document.filename,
        page.pageNumber,
      );
      if (tableCandidates.length > 0) {
        candidates.push(...tableCandidates);
        continue;
      }

      const headingCandidate = parseHeadingKey(
        page.text,
        document.filename,
        page.pageNumber,
      );
      if (headingCandidate) {
        if (document.role === "answer_key") {
          headingCandidate.detectionReasons.push("uploader_role_hint");
        }
        candidates.push(headingCandidate);
        continue;
      }

      // A separately labelled answer-key PDF may not have a heading.
      // Only inspect compact numbered pairs in this case; do not search
      // ordinary question-paper pages for option patterns.
      if (document.role === "answer_key") {
        const mappings: AnswerMapping[] = [];
        for (const match of page.text.matchAll(NUMBERED_PARENTHESIZED)) {
          if (!match.groups) continue;
          mappings.push({
            questionNumber: Number(match.groups.number),
            answerRaw: match.groups.answer.trim(),
            sourceFilename: document.filename,
            sourcePage: page.pageNumber,
            reviewStatus: "proposed",
          });
        }
        if (mappings.length >= 3) {
          candidates.push({
            id: newId(),
            sourceFilename: document.filename,
            sourcePage: page.pageNumber,
            detectionReasons: ["uploader_role_hint"],
            extractionMethod: "role_hint_and_parenthesized_numbered_pairs",
            confidence: 0.82,
            rawExcerpt: page.text.slice(0, 5000),
            mappings,
            reviewRequired: true,
          });
        }
      }
    }
  }

  const questionDocuments = documents.filter((document) => document.role === "question_paper");
  return candidates.map((candidate) => {
    const sourceMatches = documents.filter((document) =>
      document.filename === candidate.sourceFilename &&
      document.pages.some((page) => page.pageNumber === candidate.sourcePage)
    );
    const sourceDocumentId = candidate.sourceDocumentId ??
      (sourceMatches.length === 1 ? sourceMatches[0].id : undefined);
    const sourceIsQuestionPaper = sourceDocumentId !== undefined &&
      questionDocuments.some((document) => document.id === sourceDocumentId);
    const targetDocumentId = candidate.targetDocumentId ??
      (sourceIsQuestionPaper
        ? sourceDocumentId
        : questionDocuments.length === 1
          ? questionDocuments[0].id
          : undefined);
    return {
      ...candidate,
      sourceDocumentId,
      targetDocumentId,
      mappings: candidate.mappings.map((mapping) => ({
        ...mapping,
        id: mapping.id ?? newId(),
        sourceDocumentId: mapping.sourceDocumentId ?? sourceDocumentId,
      })),
    };
  });
}
