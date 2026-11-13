import type { DocumentRole, ExtractedDocument, ExtractedPage } from "../types";

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

interface TextLine {
  y: number;
  parts: Array<{ x: number; text: string }>;
}

function renderTextLine(line: TextLine): string {
  return line.parts
    .sort((a, b) => a.x - b.x)
    .map((part) => part.text.trim())
    .filter(Boolean)
    .join(" ")
    .replace(/[ \\t]+/g, " ")
    .trim();
}

function detectColumnSplit(lines: TextLine[], pageWidth: number): number | undefined {
  if (!Number.isFinite(pageWidth) || pageWidth <= 0 || lines.length < 6) {
    return undefined;
  }

  // A y-row may already contain text from both columns. Use every item origin
  // to find the gutter, then require several distinct rows on both sides.
  const starts = lines
    .flatMap((line) => line.parts.map((part) => part.x))
    .sort((left, right) => left - right);

  let bestGap = 0;
  let bestSplit: number | undefined;
  for (let index = 1; index < starts.length; index += 1) {
    const gap = starts[index] - starts[index - 1];
    const split = (starts[index] + starts[index - 1]) / 2;
    const relativeSplit = split / pageWidth;
    if (
      gap <= pageWidth * 0.08 ||
      relativeSplit <= 0.22 ||
      relativeSplit >= 0.68 ||
      gap <= bestGap
    ) {
      continue;
    }

    const leftLines = lines.filter((line) => line.parts.some((part) => part.x < split)).length;
    const rightLines = lines.filter((line) => line.parts.some((part) => part.x >= split)).length;
    if (leftLines >= 3 && rightLines >= 3) {
      bestGap = gap;
      bestSplit = split;
    }
  }
  return bestSplit;
}

/**
 * Reconstruct text in reading order. If line origins indicate two columns,
 * emit the complete left column before the right column instead of merging
 * same-height lines across the page gutter.
 */
export function reconstructTextLines(
  items: PositionedTextItem[],
  pageWidth: number,
): string {
  const sorted = [...items].sort((left, right) => {
    const yDifference = right.transform[5] - left.transform[5];
    if (Math.abs(yDifference) > LINE_TOLERANCE) return yDifference;
    return left.transform[4] - right.transform[4];
  });

  const lines: TextLine[] = [];
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

  const columnSplit = detectColumnSplit(lines, pageWidth);
  let orderedLines = lines.sort((a, b) => b.y - a.y);

  if (columnSplit !== undefined) {
    const leftLines: TextLine[] = [];
    const rightLines: TextLine[] = [];
    for (const line of lines) {
      const leftParts = line.parts.filter((part) => part.x < columnSplit);
      const rightParts = line.parts.filter((part) => part.x >= columnSplit);
      if (leftParts.length > 0) leftLines.push({ y: line.y, parts: leftParts });
      if (rightParts.length > 0) rightLines.push({ y: line.y, parts: rightParts });
    }
    orderedLines = [
      ...leftLines.sort((a, b) => b.y - a.y),
      ...rightLines.sort((a, b) => b.y - a.y),
    ];
  }

  return orderedLines
    .map(renderTextLine)
    .filter(Boolean)
    .join("\\n");
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

  const [pdfjs, pdfWorker] = await Promise.all([
    import("pdfjs-dist"),
    import("pdfjs-dist/build/pdf.worker.min.mjs?url"),
  ]);
  pdfjs.GlobalWorkerOptions.workerSrc = pdfWorker.default;

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
      const pageWidth = page.view[2] - page.view[0];
      const text = reconstructTextLines(textItems, pageWidth);

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
