export type DocumentRole =
  | "question_paper"
  | "answer_key"
  | "solutions"
  | "unknown";

export type Subject = "PHYSICS" | "CHEMISTRY" | "MATHS" | "MATHEMATICS";

export type AnswerKeyStatus =
  | "detected_needs_review"
  | "not_detected"
  | "needs_ocr";

export interface ExtractedPage {
  pageNumber: number;
  text: string;
  textCharCount: number;
  likelyScanned: boolean;
}

export interface ExtractedDocument {
  id: string;
  filename: string;
  role: DocumentRole;
  sizeBytes: number;
  pageCount: number;
  pages: ExtractedPage[];
  blob: Blob;
}

export interface AnswerMapping {
  questionNumber: number;
  answerRaw: string;
  sourceFilename: string;
  sourcePage: number;
  subject?: Subject;
  paperLabel?: string;
  reviewStatus: "proposed" | "verified" | "rejected";
}

export interface AnswerKeyCandidate {
  id: string;
  sourceFilename: string;
  sourcePage: number;
  subject?: Subject;
  paperLabel?: string;
  detectionReasons: string[];
  extractionMethod: string;
  confidence: number;
  rawExcerpt: string;
  mappings: AnswerMapping[];
  reviewRequired: boolean;
}


export type QuestionSubject = Subject | "UNASSIGNED";

export type QuestionType =
  | "unknown"
  | "single_choice"
  | "multiple_choice"
  | "numerical";

export type QuestionReviewStatus = "needs_review" | "verified" | "rejected";

export interface QuestionAnswerReference {
  candidateId: string;
  mappingIndex: number;
}

export interface QuestionDraft {
  id: string;
  questionNumber: number;
  blockNumber: number;
  subject: QuestionSubject;
  sectionLabel?: string;
  paperLabel?: string;
  questionType: QuestionType;
  statementText: string;
  sourceDocumentId: string;
  sourceFilename: string;
  sourcePageStart: number;
  sourcePageEnd: number;
  status: QuestionReviewStatus;
  answerKeyReference?: QuestionAnswerReference;
  detectionMethod: "question_number_marker";
}

export interface PaperPackage {
  id: string;
  ownerId: string;
  title: string;
  examProfile: "jee_main" | "jee_advanced" | "generic";
  createdAt: number;
  documents: ExtractedDocument[];
  answerKeyStatus: AnswerKeyStatus;
  candidates: AnswerKeyCandidate[];
  warnings: string[];
  questions?: QuestionDraft[];
  questionSegmentationWarnings?: string[];
  questionSegmentationAt?: number;
}
