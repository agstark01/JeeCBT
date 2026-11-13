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
}
