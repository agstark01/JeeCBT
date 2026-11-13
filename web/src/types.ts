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

export interface ExtractedTextLine {
  text: string;
  /** Normalized page coordinates, origin at the top-left. */
  x: number;
  y: number;
  width: number;
  height: number;
  columnIndex: number;
}

export interface ExtractedPage {
  pageNumber: number;
  text: string;
  textCharCount: number;
  likelyScanned: boolean;
  /** Page geometry and positioned lines enable image-preserving question crops. */
  width?: number;
  height?: number;
  columnSplit?: number;
  lines?: ExtractedTextLine[];
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

export type MappingReviewStatus = "proposed" | "verified" | "rejected";

export interface AnswerMapping {
  /** Stable identity for newly imported mappings; index remains for old packages. */
  id?: string;
  questionNumber: number;
  answerRaw: string;
  sourceDocumentId?: string;
  sourceFilename: string;
  sourcePage: number;
  subject?: Subject;
  paperLabel?: string;
  sectionLabel?: string;
  blockNumber?: number;
  reviewStatus: MappingReviewStatus;
  /** Explicit or unique auto-suggested relation, always within the containing package. */
  linkedQuestionId?: string;
  reviewNote?: string;
}

export interface AnswerKeyCandidate {
  id: string;
  sourceDocumentId?: string;
  /** The question-paper document this candidate is intended to describe. */
  targetDocumentId?: string;
  sourceFilename: string;
  sourcePage: number;
  subject?: Subject;
  paperLabel?: string;
  sectionLabel?: string;
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
  mappingId?: string;
}

export interface QuestionCaptureRegion {
  pageNumber: number;
  /** Normalized page coordinates, origin at top-left. */
  x: number;
  y: number;
  width: number;
  height: number;
  columnIndex: number;
  kind: "question" | "options";
}

export type QuestionTypeInferenceSource =
  | "question_instruction"
  | "section_rule"
  | "document_rule"
  | "option_detection"
  | "manual"
  | "unknown"
  | "conflict";

export interface QuestionTypeInference {
  source: QuestionTypeInferenceSource;
  evidence: string;
  confidence: number;
  ruleId?: string;
}

export interface QuestionRule {
  id: string;
  sourceDocumentId: string;
  questionStart?: number;
  questionEnd?: number;
  sectionLabel?: string;
  questionType?: Exclude<QuestionType, "unknown">;
  correctMarks?: number;
  incorrectMarks?: number;
  evidence: string;
  sourcePage: number;
  confidence: number;
}

export interface QuestionDraft {
  id: string;
  questionNumber: number;
  blockNumber: number;
  subject: QuestionSubject;
  sectionLabel?: string;
  paperLabel?: string;
  questionType: QuestionType;
  questionTypeInference?: QuestionTypeInference;
  correctMarks?: number;
  incorrectMarks?: number;
  hasOptions?: boolean;
  optionLabels?: string[];
  statementText: string;
  sourceDocumentId: string;
  sourceFilename: string;
  sourcePageStart: number;
  sourcePageEnd: number;
  sourceRegions?: QuestionCaptureRegion[];
  optionRegions?: QuestionCaptureRegion[];
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
  questionRules?: QuestionRule[];
  questionSegmentationWarnings?: string[];
  questionSegmentationAt?: number;
}
