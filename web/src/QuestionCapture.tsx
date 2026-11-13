import { useEffect, useState } from "react";
import type { ExtractedDocument, QuestionCaptureRegion } from "./types";

interface QuestionCaptureProps {
  document: ExtractedDocument;
  regions: QuestionCaptureRegion[];
  questionNumber: number;
}

interface RenderedCapture {
  key: string;
  pageNumber: number;
  dataUrl: string;
}

export default function QuestionCapture({
  document,
  regions,
  questionNumber,
}: QuestionCaptureProps) {
  const [captures, setCaptures] = useState<RenderedCapture[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setCaptures([]);
    setError("");

    if (regions.length === 0) return;

    const render = async () => {
      const [pdfjs, worker] = await Promise.all([
        import("pdfjs-dist"),
        import("pdfjs-dist/build/pdf.worker.min.mjs?url"),
      ]);
      pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
      const bytes = new Uint8Array(await document.blob.arrayBuffer());
      const task = pdfjs.getDocument({ data: bytes });
      const pdf = await task.promise;

      try {
        const rendered: RenderedCapture[] = [];
        for (const [index, region] of regions.entries()) {
          const page = await pdf.getPage(region.pageNumber);
          const baseViewport = page.getViewport({ scale: 1 });
          const scale = Math.min(2.4, Math.max(1.25, 1500 / baseViewport.width));
          const viewport = page.getViewport({ scale });
          const pageCanvas = window.document.createElement("canvas");
          pageCanvas.width = Math.ceil(viewport.width);
          pageCanvas.height = Math.ceil(viewport.height);
          const pageContext = pageCanvas.getContext("2d");
          if (!pageContext) throw new Error("Canvas rendering is unavailable in this browser.");

          await page.render({ canvas: pageCanvas, canvasContext: pageContext, viewport }).promise;
          const sx = Math.max(0, Math.floor(region.x * pageCanvas.width));
          const sy = Math.max(0, Math.floor(region.y * pageCanvas.height));
          const sw = Math.min(pageCanvas.width - sx, Math.ceil(region.width * pageCanvas.width));
          const sh = Math.min(pageCanvas.height - sy, Math.ceil(region.height * pageCanvas.height));
          if (sw < 2 || sh < 2) continue;

          const crop = window.document.createElement("canvas");
          crop.width = sw;
          crop.height = sh;
          const cropContext = crop.getContext("2d");
          if (!cropContext) throw new Error("Canvas cropping is unavailable in this browser.");
          cropContext.drawImage(pageCanvas, sx, sy, sw, sh, 0, 0, sw, sh);
          rendered.push({
            key: document.id + ":" + region.pageNumber + ":" + index,
            pageNumber: region.pageNumber,
            dataUrl: crop.toDataURL("image/jpeg", 0.94),
          });
          pageCanvas.width = 0;
          pageCanvas.height = 0;
          crop.width = 0;
          crop.height = 0;
          page.cleanup();
        }
        if (!cancelled) setCaptures(rendered);
      } finally {
        await task.destroy();
      }
    };

    void render().catch((caught: unknown) => {
      if (!cancelled) {
        setError(caught instanceof Error ? caught.message : "Unable to render the local question crop.");
      }
    });

    return () => {
      cancelled = true;
    };
  }, [document.id, document.blob, regions]);

  if (regions.length === 0) {
    return (
      <div className="question-capture-empty">
        No crop geometry is available for this import. Re-import the PDF with the current version to enable question crops.
      </div>
    );
  }

  return (
    <div className="question-capture-list">
      {error && <div className="warning-line" role="status">{error}</div>}
      {captures.length === 0 && !error && <div className="source-preview-empty">Rendering question crop locally…</div>}
      {captures.map((capture, index) => (
        <figure className="question-capture" key={capture.key}>
          <img src={capture.dataUrl} alt={"Question " + questionNumber + " visual crop, page " + capture.pageNumber} />
          <figcaption>
            Question {questionNumber} · source page {capture.pageNumber}
            {regions.length > 1 ? " · segment " + (index + 1) + " of " + regions.length : ""}
          </figcaption>
        </figure>
      ))}
    </div>
  );
}
