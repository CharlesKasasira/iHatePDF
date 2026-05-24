"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { getPdfPagePreviewUrl } from "../../lib/pdf-api";
import type { EditPageNumbersInput, EditWatermarkInput } from "../../lib/pdf-api";
import type { EditorLayer, EditorPage, EditorTool, EditorViewport } from "./types";
import { EditorPageSurface } from "./editor-page-surface";

type PdfJsModule = typeof import("pdfjs-dist");

type SearchResult = {
  pageNumber: number;
  matchCount: number;
};

let pdfJsModulePromise: Promise<PdfJsModule> | null = null;

function loadPdfJs(): Promise<PdfJsModule> {
  pdfJsModulePromise ??= import("pdfjs-dist").then((pdfjs) => {
    pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
    return pdfjs;
  });

  return pdfJsModulePromise;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function countMatches(text: string, query: string): number {
  if (!query.trim()) {
    return 0;
  }

  return text.match(new RegExp(escapeRegExp(query.trim()), "gi"))?.length ?? 0;
}

async function pageText(pdfDocument: PDFDocumentProxy, pageNumber: number): Promise<string> {
  const page = await pdfDocument.getPage(pageNumber);
  const textContent = await page.getTextContent();
  return textContent.items
    .map((item) => ("str" in item && typeof item.str === "string" ? item.str : ""))
    .join(" ");
}

export function EditorCanvas({
  pdfFile,
  sourceFileId,
  pages,
  layers,
  pageRotationMap,
  pageNumbers,
  watermark,
  activeTool,
  selectedLayerId,
  selectedLayerIds,
  activePage,
  scrollTarget,
  zoom,
  fitMode,
  snapToGrid,
  showGuides,
  onSelectLayer,
  onActivePageChange,
  onCreateUndoCheckpoint,
  onUpdateLayer,
  onMoveLayer,
  onPlaceLayer,
  onCreateInkLayer
}: {
  pdfFile: File | null;
  sourceFileId: string | null;
  pages: EditorPage[];
  layers: EditorLayer[];
  pageRotationMap: Map<number, number>;
  pageNumbers: EditPageNumbersInput | null;
  watermark: EditWatermarkInput | null;
  activeTool: EditorTool;
  selectedLayerId: string | null;
  selectedLayerIds: string[];
  activePage: number;
  scrollTarget: EditorViewport["scrollTarget"];
  zoom: number;
  fitMode: "fit-width" | "fit-page" | "manual";
  snapToGrid: boolean;
  showGuides: boolean;
  onSelectLayer: (layerId: string, additive?: boolean) => void;
  onActivePageChange: (page: number) => void;
  onCreateUndoCheckpoint: () => void;
  onUpdateLayer: (
    layerId: string,
    updater: (layer: EditorLayer) => EditorLayer,
    trackHistory?: boolean
  ) => void;
  onMoveLayer: (layerId: string, x: number, y: number, trackHistory?: boolean) => void;
  onPlaceLayer: (pageNumber: number, x: number, y: number) => void;
  onCreateInkLayer: (pageNumber: number, points: Array<{ x: number; y: number }>) => void;
}): React.JSX.Element {
  const pageStackRef = useRef<HTMLDivElement>(null);
  const activePageRef = useRef(activePage);
  const visiblePagesRef = useRef(new Map<number, number>());
  const [pdfDocument, setPdfDocument] = useState<PDFDocumentProxy | null>(null);
  const [pdfRenderStatus, setPdfRenderStatus] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [activeSearchIndex, setActiveSearchIndex] = useState(0);
  const normalizedSearchQuery = searchQuery.trim();

  useEffect(() => {
    let cancelled = false;
    let loadedDocument: PDFDocumentProxy | null = null;
    const loadingTaskRef: { current: ReturnType<PdfJsModule["getDocument"]> | null } = { current: null };

    setPdfDocument(null);
    setPdfRenderStatus("");
    setSearchQuery("");
    setSearchResults([]);
    setActiveSearchIndex(0);

    if (!pdfFile) {
      return;
    }

    setPdfRenderStatus("Loading selectable text layer...");

    void (async () => {
      try {
        const pdfjs = await loadPdfJs();
        const data = new Uint8Array(await pdfFile.arrayBuffer());
        const loadingTask = pdfjs.getDocument({ data });
        loadingTaskRef.current = loadingTask;
        loadedDocument = await loadingTask.promise;

        if (cancelled) {
          await loadedDocument.destroy();
          return;
        }

        setPdfDocument(loadedDocument);
        setPdfRenderStatus("");
      } catch (error) {
        if (!cancelled) {
          setPdfRenderStatus(`Selectable text layer unavailable: ${(error as Error).message}`);
        }
      }
    })();

    return () => {
      cancelled = true;
      void loadingTaskRef.current?.destroy();
      void loadedDocument?.destroy();
    };
  }, [pdfFile]);

  useEffect(() => {
    let cancelled = false;

    if (!pdfDocument || !normalizedSearchQuery) {
      setSearchResults([]);
      setActiveSearchIndex(0);
      return;
    }

    const timeout = window.setTimeout(() => {
      void (async () => {
        const results: SearchResult[] = [];

        for (let pageNumber = 1; pageNumber <= pdfDocument.numPages; pageNumber += 1) {
          if (cancelled) {
            return;
          }

          const matchCount = countMatches(await pageText(pdfDocument, pageNumber), normalizedSearchQuery);
          if (matchCount > 0) {
            results.push({ pageNumber, matchCount });
          }
        }

        if (!cancelled) {
          setSearchResults(results);
          setActiveSearchIndex(0);
          if (results[0]) {
            document
              .getElementById(`page-surface-${results[0].pageNumber}`)
              ?.scrollIntoView({ behavior: "smooth", block: "start", inline: "nearest" });
          }
        }
      })();
    }, 220);

    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [normalizedSearchQuery, pdfDocument]);

  const totalSearchMatches = useMemo(
    () => searchResults.reduce((total, result) => total + result.matchCount, 0),
    [searchResults]
  );

  const jumpToSearchResult = (direction: -1 | 1): void => {
    if (searchResults.length === 0) {
      return;
    }

    const nextIndex = (activeSearchIndex + direction + searchResults.length) % searchResults.length;
    setActiveSearchIndex(nextIndex);
    document
      .getElementById(`page-surface-${searchResults[nextIndex].pageNumber}`)
      ?.scrollIntoView({ behavior: "smooth", block: "start", inline: "nearest" });
  };

  useEffect(() => {
    activePageRef.current = activePage;
  }, [activePage]);

  useEffect(() => {
    if (!scrollTarget) {
      return;
    }

    document
      .getElementById(`page-surface-${scrollTarget.page}`)
      ?.scrollIntoView({ behavior: scrollTarget.behavior, block: "start", inline: "nearest" });
  }, [scrollTarget]);

  useEffect(() => {
    const pageStack = pageStackRef.current;
    if (!pageStack || pages.length === 0) {
      return;
    }

    visiblePagesRef.current.clear();
    const pageElements = Array.from(
      pageStack.querySelectorAll<HTMLElement>("[data-editor-page-number]")
    );

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const pageNumber = Number((entry.target as HTMLElement).dataset.editorPageNumber);
          if (!Number.isFinite(pageNumber)) {
            continue;
          }

          if (entry.isIntersecting) {
            visiblePagesRef.current.set(pageNumber, entry.intersectionRatio);
          } else {
            visiblePagesRef.current.delete(pageNumber);
          }
        }

        let nextPage = activePageRef.current;
        let strongestIntersection = 0;
        visiblePagesRef.current.forEach((intersectionRatio, pageNumber) => {
          if (intersectionRatio > strongestIntersection) {
            strongestIntersection = intersectionRatio;
            nextPage = pageNumber;
          }
        });

        if (nextPage && nextPage !== activePageRef.current) {
          activePageRef.current = nextPage;
          onActivePageChange(nextPage);
        }
      },
      {
        threshold: [0, 0.12, 0.25, 0.5, 0.75, 1]
      }
    );

    pageElements.forEach((pageElement) => observer.observe(pageElement));

    return () => observer.disconnect();
  }, [onActivePageChange, pages.length]);

  return (
    <section className="studio-canvas-area">
      {pdfFile ? (
        <div className="studio-document-search" role="search">
          <input
            type="search"
            value={searchQuery}
            placeholder="Search document"
            onChange={(event) => setSearchQuery(event.target.value)}
          />
          <span>
            {normalizedSearchQuery
              ? `${totalSearchMatches} match${totalSearchMatches === 1 ? "" : "es"}`
              : pdfRenderStatus || "Text layer ready"}
          </span>
          <button type="button" onClick={() => jumpToSearchResult(-1)} disabled={searchResults.length === 0}>
            Prev
          </button>
          <button type="button" onClick={() => jumpToSearchResult(1)} disabled={searchResults.length === 0}>
            Next
          </button>
        </div>
      ) : null}

      {!pdfFile ? (
        <div className="studio-placeholder">
          <strong>Drop in a PDF to open the studio.</strong>
          <span>
            Once loaded, every stage becomes a clean placement surface for text, highlights, images,
            signatures, and document-level finishing passes.
          </span>
        </div>
      ) : null}

      {pdfFile && pages.length > 0 ? (
        <div ref={pageStackRef} className="studio-page-stack">
          {pages.map((page) => (
            <div
              key={page.pageNumber}
              className="studio-page-stack__item"
              id={`page-surface-${page.pageNumber}`}
              data-editor-page-number={page.pageNumber}
            >
              <EditorPageSurface
                fileName={pdfFile.name}
                page={page}
                pdfDocument={pdfDocument}
                previewUrl={sourceFileId ? getPdfPagePreviewUrl(sourceFileId, page.pageNumber) : null}
                layers={layers.filter((layer) => layer.page === page.pageNumber)}
                rotationDegrees={pageRotationMap.get(page.pageNumber) ?? 0}
                pageNumbers={pageNumbers}
                watermark={watermark}
                activeTool={activeTool}
                selectedLayerId={selectedLayerId}
                selectedLayerIds={selectedLayerIds}
                zoom={zoom}
                fitMode={fitMode}
                snapToGrid={snapToGrid}
                showGuides={showGuides}
                onSelectLayer={onSelectLayer}
                onCreateUndoCheckpoint={onCreateUndoCheckpoint}
                onUpdateLayer={onUpdateLayer}
                onMoveLayer={onMoveLayer}
                onPlaceLayer={(x, y) => onPlaceLayer(page.pageNumber, x, y)}
                onCreateInkLayer={(points) => onCreateInkLayer(page.pageNumber, points)}
              />
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}
