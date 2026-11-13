import * as pdfjs from "pdfjs-dist";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import type { DocumentRole, ExtractedDocument, ExtractedPage } from "../types";

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

const MAX_FILE_BYTES = 25 * 1024 * 1024;
const MAX_PAGES = 400;
const LINE_TOLERANCE = 2.5;

interface PositionedTextItem {
  str: string;
  transform: number[];
  dir: string;
  width: number;
  height: number;
  fontName: string;
  hasEOL: boolean;
}

function reconstructTextLines(items: PositionedTextItem[]): string {
  const sorted = [...items].sort((left, right) => {
    const yDifference = right.transform[5] - left.transform[5];
    if (Math.abs(yDifference) > LINE_TOLERANCE) return yDifference;
    return left.transform[4] - right.transform[4];
  });

  const lines: Array<{ y: number; parts: Array<{ x: number; text: string }> }> = [];
  for (const item of sorted) {
    if (!item.str.trim()) continue;
    const y = item.transform[5];
    let line = lines.find((candidate) => Math.abs(candidate.y - y) <= LINE_TOLERANCE);
    if (!line) {
      line = { y, parts: [] };
      lines.push(line);
    }
    line.parts.push({ x: item.transform[4], text: item.str });
  }

  return lines
    .sort((a, b) => b.y - a.y)
    .map((line) =>
      line.parts
        .sort((a, b) => a.x - b.x)
        .map((part) => part.text.trim())
        .filter(Boolean)
        .join(" ")
        .replace(/[ \t]+/g, " ")
        .trim(),
    )
    .filter(Boolean)
    .join("\n");
}

export async function extractPdfLocally(
  file: File,
  role: DocumentRole,
  onProgress?: (page: number, total: number) => void,
): Promise<ExtractedDocument> {
  if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
    throw new Error(file.name + " is not a PDF file.");
  }
  if (file.size > MAX_FILE_BYTES) {
    throw new Error(file.name + " exceeds the 25 MB per-file limit.");
  }

  const data = new Uint8Array(await file.arrayBuffer());
  if (data.length < 5 || String.fromCharCode(...data.slice(0, 5)) !== "%PDF-") {
    throw new Error(file.name + " does not contain a valid PDF signature.");
  }

  const loadingTask = pdfjs.getDocument({ data });
  const pdf = await loadingTask.promise;

  if (pdf.numPages < 1) {
    await loadingTask.destroy();
    throw new Error(file.name + " contains no pages.");
  }
  if (pdf.numPages > MAX_PAGES) {
    await loadingTask.destroy();
    throw new Error(file.name + " exceeds the 400-page import limit.");
  }

  const pages: ExtractedPage[] = [];
  try {
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      const textItems = content.items.filter(
        (item): item is PositionedTextItem =>
          "str" in item && "transform" in item,
      );
      const text = reconstructTextLines(textItems);

      pages.push({
        pageNumber,
        text,
        textCharCount: text.length,
        likelyScanned: text.length < 40,
      });
      page.cleanup();
      onProgress?.(pageNumber, pdf.numPages);
    }
  } finally {
    await loadingTask.destroy();
  }

  return {
    id: crypto.randomUUID(),
    filename: file.name,
    role,
    sizeBytes: file.size,
    pageCount: pages.length,
    pages,
    blob: file.slice(0, file.size, "application/pdf"),
  };
}
