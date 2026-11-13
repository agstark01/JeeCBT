import * as pdfjs from "pdfjs-dist";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import type { DocumentRole, ExtractedDocument, ExtractedPage } from "../types";

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

export async function extractPdfLocally(
  file: File,
  role: DocumentRole,
  onProgress?: (page: number, total: number) => void,
): Promise<ExtractedDocument> {
  if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
    throw new Error(file.name + " is not a PDF file.");
  }

  const data = new Uint8Array(await file.arrayBuffer());
  if (data.length < 5 || String.fromCharCode(...data.slice(0, 5)) !== "%PDF-") {
    throw new Error(file.name + " does not contain a valid PDF signature.");
  }

  const loadingTask = pdfjs.getDocument({ data });
  const pdf = await loadingTask.promise;

  if (pdf.numPages < 1) {
    await pdf.destroy();
    throw new Error(file.name + " contains no pages.");
  }
  if (pdf.numPages > 400) {
    await pdf.destroy();
    throw new Error(file.name + " exceeds the 400-page import limit.");
  }

  const pages: ExtractedPage[] = [];
  try {
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      const text = content.items
        .map((item) => ("str" in item ? item.str : ""))
        .filter(Boolean)
        .join(" ")
        .replace(/[ \t]+/g, " ")
        .trim();

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
    await pdf.destroy();
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
