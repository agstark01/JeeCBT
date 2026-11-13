import type {
  DocumentRole,
  ExtractedDocument,
  ExtractedPage,
  ExtractedTextLine,
} from "../types";

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
  parts: Array<{ x: number; text: string; width: number; height: number }>;
}

export interface PageLayout {
  text: string;
  lines: ExtractedTextLine[];
  columnSplit?: number;
}

function renderTextLine(line: TextLine): string {
  return line.parts
    .sort((a, b) => a.x - b.x)
    .map((part) => part.text.trim())
    .filter(Boolean)
    .join(" ")
    .replace(/[ \t]+/g, " ")
    .trim();
}

function detectColumnSplit(lines: TextLine[], pageWidth: number): number | undefined {
  if (!Number.isFinite(pageWidth) || pageWidth <= 0 || lines.length < 6) {
    return undefined;
  }

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
 * Reconstruct both reading order and normalized line geometry. The geometry is
 * later used to crop each question from a browser-rendered copy of its source
 * PDF page, preserving diagrams, equations, tables, and option typography.
 */
export function reconstructPageLayout(
  items: PositionedTextItem[],
  pageView: [number, number, number, number],
): PageLayout {
  const [xMin, yMin, xMax, yMax] = pageView;
  const pageWidth = xMax - xMin;
  const pageHeight = yMax - yMin;
  if (pageWidth <= 0 || pageHeight <= 0) {
    return { text: "", lines: [] };
  }

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
    line.parts.push({
      x: item.transform[4] - xMin,
      text: item.str,
      width: item.width,
      height: item.height,
    });
  }

  const columnSplitAbsolute = detectColumnSplit(lines, pageWidth);
  let orderedLines = lines.sort((a, b) => b.y - a.y);
  if (columnSplitAbsolute !== undefined) {
    const leftLines: TextLine[] = [];
    const rightLines: TextLine[] = [];
    for (const line of lines) {
      const leftParts = line.parts.filter((part) => part.x < columnSplitAbsolute);
      const rightParts = line.parts.filter((part) => part.x >= columnSplitAbsolute);
      if (leftParts.length > 0) leftLines.push({ y: line.y, parts: leftParts });
      if (rightParts.length > 0) rightLines.push({ y: line.y, parts: rightParts });
    }
    orderedLines = [
      ...leftLines.sort((a, b) => b.y - a.y),
      ...rightLines.sort((a, b) => b.y - a.y),
    ];
  }

  const positioned: ExtractedTextLine[] = orderedLines.map((line) => {
    const minX = Math.min(...line.parts.map((part) => part.x));
    const maxX = Math.max(...line.parts.map((part) => part.x + part.width));
    const maxTop = Math.max(...line.parts.map((part) => line.y + part.height));
    const minBottom = line.y;
    return {
      text: renderTextLine(line),
      x: Math.max(0, minX / pageWidth),
      y: Math.max(0, (yMax - maxTop) / pageHeight),
      width: Math.min(1, Math.max(0, (maxX - minX) / pageWidth)),
      height: Math.min(1, Math.max(0, (maxTop - minBottom) / pageHeight)),
      columnIndex:
        columnSplitAbsolute !== undefined && minX >= columnSplitAbsolute ? 1 : 0,
    };
  }).filter((line) => line.text.length > 0);

  return {
    text: positioned.map((line) => line.text).join("\n"),
    lines: positioned,
    columnSplit:
      columnSplitAbsolute === undefined
        ? undefined
        : columnSplitAbsolute / pageWidth,
  };
}

/** Backwards-compatible text-only helper retained for parser tests. */
export function reconstructTextLines(
  items: PositionedTextItem[],
  pageWidth: number,
): string {
  return reconstructPageLayout(items, [0, 0, pageWidth, 792]).text;
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
      const pageView = page.view as [number, number, number, number];
      const layout = reconstructPageLayout(textItems, pageView);
      const width = pageView[2] - pageView[0];
      const height = pageView[3] - pageView[1];

      pages.push({
        pageNumber,
        text: layout.text,
        textCharCount: layout.text.length,
        likelyScanned: layout.text.length < 40,
        width,
        height,
        columnSplit: layout.columnSplit,
        lines: layout.lines,
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
