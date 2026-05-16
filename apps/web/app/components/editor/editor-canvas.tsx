"use client";

import { getPdfPagePreviewUrl } from "../../lib/pdf-api";
import type { EditPageNumbersInput, EditWatermarkInput } from "../../lib/pdf-api";
import type { EditorLayer, EditorPage, EditorTool } from "./types";
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
  onSelectLayer,
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
  onSelectLayer: (layerId: string) => void;
  onCreateUndoCheckpoint: () => void;
  onUpdateLayer: (
    layerId: string,
    updater: (layer: EditorLayer) => EditorLayer,
    trackHistory?: boolean
  ) => void;
  onMoveLayer: (layerId: string, x: number, y: number, trackHistory?: boolean) => void;
  onPlaceLayer: (pageNumber: number, x: number, y: number) => void;
}): React.JSX.Element {
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
        <div className="studio-page-stack">
          {pages.map((page) => (
            <EditorPageSurface
              key={page.pageNumber}
              fileName={pdfFile.name}
              page={page}
              previewUrl={sourceFileId ? getPdfPagePreviewUrl(sourceFileId, page.pageNumber) : null}
              layers={layers.filter((layer) => layer.page === page.pageNumber)}
              rotationDegrees={pageRotationMap.get(page.pageNumber) ?? 0}
              pageNumbers={pageNumbers}
              watermark={watermark}
              activeTool={activeTool}
              selectedLayerId={selectedLayerId}
              onSelectLayer={onSelectLayer}
              onCreateUndoCheckpoint={onCreateUndoCheckpoint}
              onUpdateLayer={onUpdateLayer}
              onMoveLayer={onMoveLayer}
              onPlaceLayer={(x, y) => onPlaceLayer(page.pageNumber, x, y)}
            />
          ))}
        </div>
      ) : null}
    </section>
  );
}
