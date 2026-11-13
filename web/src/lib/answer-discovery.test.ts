import { describe, expect, it } from "vitest";
import { discoverAnswerKeys } from "./answer-discovery";
import type { ExtractedDocument } from "../types";

function document(
  filename: string,
  role: ExtractedDocument["role"],
  text: string,
): ExtractedDocument {
  return {
    id: filename,
    filename,
    role,
    sizeBytes: 100,
    pageCount: 1,
    pages: [{
      pageNumber: 1,
      text,
      textCharCount: text.length,
      likelyScanned: false,
    }],
    blob: new Blob(),
  };
}

describe("local answer-key discovery", () => {
  it("detects a key embedded after an answer-key heading", () => {
    const found = discoverAnswerKeys([
      document("main-paper.pdf", "question_paper", "Q.1 prompt\nANSWER KEYS\n1. (2) 2. (4) 3. (-2.7)"),
    ]);
    expect(found).toHaveLength(1);
    expect(found[0].mappings.map((item) => item.answerRaw)).toEqual(["2", "4", "-2.7"]);
    expect(found[0].sourcePage).toBe(1);
  });

  it("parses three subject tables and keeps multiple answers and numbers as strings", () => {
    const table = [
      "PAPER-1 PHYSICS",
      "Ques. 1 2 3 4",
      "Ans. A BC 25.6 -0.4",
      "PAPER-1 CHEMISTRY",
      "Ques. 1 2 3 4",
      "Ans. B B A C",
      "PAPER-1 MATHS",
      "Ques. 1 2 3 4",
      "Ans. D C AC 108",
    ].join("\n");
    const found = discoverAnswerKeys([document("Paper-1.pdf", "answer_key", table)]);
    expect(found.map((item) => item.subject)).toEqual(["PHYSICS", "CHEMISTRY", "MATHS"]);
    expect(found[0].mappings[1].answerRaw).toBe("BC");
    expect(found[0].mappings[2].answerRaw).toBe("25.6");
    expect(found[2].mappings[2].answerRaw).toBe("AC");
    expect(found[2].mappings[3].answerRaw).toBe("108");
    expect(found[0].mappings[0].questionNumber).toBe(1);
    expect(found[1].mappings[0].questionNumber).toBe(1);
  });

  it("does not mistake ordinary MCQ options for an answer key", () => {
    const found = discoverAnswerKeys([
      document("advanced-paper.pdf", "question_paper", "Q.1 Which is correct?\n(A) one\n(B) two\n(C) three\n(D) four"),
    ]);
    expect(found).toHaveLength(0);
  });

  it("uses a separate answer-key role as a hint when no heading is present", () => {
    const found = discoverAnswerKeys([
      document("key.pdf", "answer_key", "1. (A) 2. (C) 3. (B) 4. (D)"),
    ]);
    expect(found).toHaveLength(1);
    expect(found[0].mappings).toHaveLength(4);
  });
});
