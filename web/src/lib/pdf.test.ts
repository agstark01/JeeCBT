import { describe, expect, it } from "vitest";
import { reconstructTextLines } from "./pdf";

function item(x: number, y: number, str: string) {
  return {
    str,
    transform: [1, 0, 0, 1, x, y],
    dir: "ltr",
    width: str.length * 5,
    height: 10,
    fontName: "F1",
    hasEOL: false,
  };
}

describe("PDF text reading order", () => {
  it("reads a two-column page top-to-bottom in the left column, then the right column", () => {
    const items = [
      item(40, 600, "Left Q1"),
      item(330, 600, "Right Q4"),
      item(40, 580, "Left continuation"),
      item(330, 580, "Right continuation"),
      item(40, 560, "Left Q2"),
      item(330, 560, "Right Q5"),
      item(40, 540, "Left option A"),
      item(330, 540, "Right option A"),
      item(40, 520, "Left Q3"),
      item(330, 520, "Right Q6"),
      item(40, 500, "Left final line"),
      item(330, 500, "Right final line"),
    ];

    const text = reconstructTextLines(items, 612);
    expect(text.split("\n")).toEqual([
      "Left Q1",
      "Left continuation",
      "Left Q2",
      "Left option A",
      "Left Q3",
      "Left final line",
      "Right Q4",
      "Right continuation",
      "Right Q5",
      "Right option A",
      "Right Q6",
      "Right final line",
    ]);
  });

  it("does not split a normal single-column page with occasional indentation", () => {
    const items = [
      item(40, 600, "Question start"),
      item(40, 580, "Continuation"),
      item(95, 560, "Indented formula"),
      item(40, 540, "Further text"),
      item(40, 520, "Options"),
      item(40, 500, "Last line"),
    ];

    const text = reconstructTextLines(items, 612);
    expect(text.split("\n")).toEqual([
      "Question start",
      "Continuation",
      "Indented formula",
      "Further text",
      "Options",
      "Last line",
    ]);
  });
});
