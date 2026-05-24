"use client";

import { useEffect, useRef } from "react";
import { getPdfPagePreviewUrl } from "../../lib/pdf-api";
import type { EditPageNumbersInput, EditWatermarkInput } from "../../lib/pdf-api";
import type { EditorLayer, EditorPage, EditorTool, EditorViewport } from "./types";
import { EditorPageSurface } from "./editor-page-surface";

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
  onPlaceLayer
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
}): React.JSX.Element {
  const pageStackRef = useRef<HTMLDivElement>(null);
  const activePageRef = useRef(activePage);
  const visiblePagesRef = useRef(new Map<number, number>());

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
              />
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}
