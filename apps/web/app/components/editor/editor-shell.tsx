"use client";

import { useRef } from "react";
import { SiteHeader } from "../site-header";
import type { FileShareResponse, PdfIntelligenceResponse } from "../../lib/pdf-api";
import type {
  EditorDocumentState,
  EditorDocumentModel,
  EditorDraftDefaults,
  EditorLayer,
  EditorMode,
  EditorRectangleLayer
} from "./types";
import { EditorToolbar } from "./editor-toolbar";
import { EditorSidebar } from "./editor-sidebar";
import { EditorCanvas } from "./editor-canvas";
import { SignatureRequestModal } from "./signature-request-modal";
import { getPdfPagePreviewUrl } from "../../lib/pdf-api";

export function EditorShell({
  mode,
  state,
  selectedLayer,
  selectedLayerIds,
  selectedSignatureBox,
  pageRotationMap,
  pageNumberConfig,
  watermarkConfig,
  onPdfFileChange,
  onAssetFileChange,
  onToolSelect,
  onTextDefaultsChange,
  onRectangleDefaultsChange,
  onImageDefaultsChange,
  onSignatureDefaultsChange,
  onSelectLayer,
  onCreateUndoCheckpoint,
  onUpdateLayer,
  onRemoveSelectedLayer,
  onOutputNameChange,
  onRotationPageChange,
  onRotationDegreesChange,
  onQueuePageRotation,
  onRemovePageRotation,
  onPageNumbersEnabledChange,
  onPageNumbersChange,
  onWatermarkEnabledChange,
  onWatermarkChange,
  onActivePageChange,
  onZoomChange,
  onFitModeChange,
  onSnapToGridChange,
  onShowGuidesChange,
  onScrollTargetChange,
  onUndo,
  onRedo,
  onOpenSignatureChooser,
  onRetentionHoursChange,
  onExport,
  onCloseSignatureFlow,
  onOnlyMeSignature,
  onChooseSeveralPeople,
  onBackSignatureRequest,
  onSignatureRequestChange,
  onSendSignatureRequest,
  onMoveLayer,
  onReorderLayers,
  onMoveSelectedLayersInStack,
  onPlaceLayer,
  invite,
  intelligence,
  onInviteEmailChange,
  onInviteMessageChange,
  onInviteExpiresInHoursChange,
  onCreateEditorInvite,
  onCopyEditorInvite
}: {
  mode: EditorMode;
  state: EditorDocumentState;
  selectedLayer: EditorLayer | null;
  selectedLayerIds: string[];
  selectedSignatureBox: EditorRectangleLayer | null;
  pageRotationMap: Map<number, number>;
  pageNumberConfig: ReturnType<typeof import("./adapter").getPageNumbersConfig>;
  watermarkConfig: ReturnType<typeof import("./adapter").getWatermarkConfig>;
  onPdfFileChange: (file: File | null) => void;
  onAssetFileChange: (file: File, kind: "image" | "sign") => Promise<void>;
  onToolSelect: (tool: EditorDocumentState["tool"]) => void;
  onTextDefaultsChange: (patch: Partial<EditorDraftDefaults["text"]>) => void;
  onRectangleDefaultsChange: (patch: Partial<EditorDraftDefaults["rectangle"]>) => void;
  onImageDefaultsChange: (patch: Partial<EditorDraftDefaults["image"]>) => void;
  onSignatureDefaultsChange: (patch: Partial<EditorDraftDefaults["signature"]>) => void;
  onSelectLayer: (layerId: string | null, additive?: boolean) => void;
  onCreateUndoCheckpoint: () => void;
  onUpdateLayer: (
    layerId: string,
    updater: (layer: EditorLayer) => EditorLayer,
    trackHistory?: boolean
  ) => void;
  onRemoveSelectedLayer: () => void;
  onOutputNameChange: (outputName: string) => void;
  onRotationPageChange: (page: number) => void;
  onRotationDegreesChange: (degrees: EditorDocumentState["rotationDegrees"]) => void;
  onQueuePageRotation: () => void;
  onRemovePageRotation: (page: number) => void;
  onPageNumbersEnabledChange: (enabled: boolean) => void;
  onPageNumbersChange: (patch: Partial<EditorDocumentModel["operations"]["pageNumbers"]>) => void;
  onWatermarkEnabledChange: (enabled: boolean) => void;
  onWatermarkChange: (patch: Partial<EditorDocumentModel["operations"]["watermark"]>) => void;
  onActivePageChange: (page: number) => void;
  onZoomChange: (zoom: number) => void;
  onFitModeChange: (fitMode: EditorDocumentModel["viewport"]["fitMode"]) => void;
  onSnapToGridChange: (enabled: boolean) => void;
  onShowGuidesChange: (enabled: boolean) => void;
  onScrollTargetChange: (
    page: number,
    behavior?: NonNullable<EditorDocumentModel["viewport"]["scrollTarget"]>["behavior"]
  ) => void;
  onUndo: () => void;
  onRedo: () => void;
  onOpenSignatureChooser: () => void;
  onRetentionHoursChange: (retentionHours: number) => void;
  onExport: () => Promise<void>;
  onCloseSignatureFlow: () => void;
  onOnlyMeSignature: () => void;
  onChooseSeveralPeople: () => void;
  onBackSignatureRequest: () => void;
  onSignatureRequestChange: (patch: Partial<EditorDocumentModel["signatures"]["request"]>) => void;
  onSendSignatureRequest: () => Promise<void>;
  onMoveLayer: (layerId: string, x: number, y: number, trackHistory?: boolean) => void;
  onReorderLayers: (layers: EditorLayer[]) => void;
  onMoveSelectedLayersInStack: (direction: "front" | "forward" | "backward" | "back") => void;
  onPlaceLayer: (pageNumber: number, x: number, y: number) => void;
  invite: {
    email: string;
    message: string;
    expiresInHours: number;
    expiryOptions: Array<{ value: number; label: string }>;
    busy: boolean;
    status: string;
    share: FileShareResponse | null;
  };
  intelligence: {
    data: PdfIntelligenceResponse | null;
    busy: boolean;
    status: string;
  };
  onInviteEmailChange: (email: string) => void;
  onInviteMessageChange: (message: string) => void;
  onInviteExpiresInHoursChange: (expiresInHours: number) => void;
  onCreateEditorInvite: () => void;
  onCopyEditorInvite: () => void;
}): React.JSX.Element {
  const pdfInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const signatureInputRef = useRef<HTMLInputElement>(null);
  const document = state.document;

  const handleToolSelection = (tool: EditorDocumentState["tool"]): void => {
    onToolSelect(tool);
    if (tool === "image" && !state.assets.image) {
      imageInputRef.current?.click();
    }
    if (tool === "sign" && !state.assets.sign) {
      signatureInputRef.current?.click();
    }
  };

  const jumpToPage = (page: number): void => {
    const targetPage = Math.min(Math.max(1, page), Math.max(1, state.document.pages.length));
    onScrollTargetChange(targetPage, "smooth");
  };

  return (
    <div className="site-shell">
      <SiteHeader active={mode === "sign" ? "sign-pdf" : "edit"} />

      <main className="studio-page">
        <section className="studio-shell">
          <div className="studio-topbar">
            <div className="studio-topbar__identity">
              <span className="studio-pill studio-pill--brand">
                {mode === "sign" ? "SIGN PDF" : "PDF Editor Studio"}
              </span>
              <h1>
                {mode === "sign"
                  ? "Sign PDFs yourself or send them for signature"
                  : "Precision PDF editing"}
              </h1>
              <p>
                {mode === "sign"
                  ? "Mark signature areas on the PDF, sign it yourself with an uploaded signature image, or create a secure signer request for someone else."
                  : "Layer text, highlights, signatures, and images directly on each PDF page, then rotate pages, add page numbers, and stamp watermarks without leaving the same export pipeline."}
              </p>
            </div>

            <div className="studio-topbar__actions">
              <button
                type="button"
                className="studio-primary-button"
                onClick={() => pdfInputRef.current?.click()}
                disabled={state.busy}
              >
                {document.file ? "Replace PDF" : "Open PDF"}
              </button>
              <input
                ref={pdfInputRef}
                type="file"
                hidden
                accept="application/pdf"
                onChange={(event) => {
                  onPdfFileChange(event.target.files?.[0] ?? null);
                  event.target.value = "";
                }}
              />

              <button
                type="button"
                className="studio-secondary-button"
                onClick={() => imageInputRef.current?.click()}
                disabled={state.busy}
              >
                Load image
              </button>
              <input
                ref={imageInputRef}
                type="file"
                hidden
                accept="image/png,image/jpeg"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) {
                    void onAssetFileChange(file, "image");
                  }
                  event.target.value = "";
                }}
              />

              <button
                type="button"
                className="studio-secondary-button"
                onClick={() => signatureInputRef.current?.click()}
                disabled={state.busy}
              >
                Load signature
              </button>
              <input
                ref={signatureInputRef}
                type="file"
                hidden
                accept="image/png,image/jpeg"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) {
                    void onAssetFileChange(file, "sign");
                  }
                  event.target.value = "";
                }}
              />
            </div>
          </div>

          <section className="studio-workspace">
            <aside className="studio-left-rail">
              <EditorToolbar
                tool={state.tool}
                textDefaults={state.draftDefaults.text}
                onToolSelect={handleToolSelection}
                onTextDefaultsChange={onTextDefaultsChange}
              />

              <div className="studio-rail-card">
                <div className="studio-panel__eyebrow">Placement</div>
                <strong>{state.tool === "select" ? "Select and drag" : `Drop ${state.tool} on the page`}</strong>
                <span>
                  {document.file
                    ? "Click the document surface to place the active tool. Use the inspector on the right for exact values."
                    : "Open a PDF to enable the page surface."}
                  </span>
              </div>

              <ThumbnailRail
                fileName={document.file?.name ?? "PDF"}
                sourceFileId={document.sourceFileId}
                pages={document.pages}
                activePage={document.viewport.activePage ?? 1}
                isLoading={state.isLoadingPreview}
                onJumpToPage={jumpToPage}
              />
            </aside>

            <EditorCanvas
              pdfFile={document.file}
              sourceFileId={document.sourceFileId}
              pages={document.pages}
              layers={document.layers}
              pageRotationMap={pageRotationMap}
              pageNumbers={pageNumberConfig}
              watermark={watermarkConfig}
              activeTool={state.tool}
              selectedLayerId={document.selection.layerId}
              selectedLayerIds={document.selection.layerIds}
              activePage={document.viewport.activePage ?? 1}
              scrollTarget={document.viewport.scrollTarget}
              zoom={document.viewport.zoom}
              fitMode={document.viewport.fitMode}
              snapToGrid={document.viewport.snapToGrid}
              showGuides={document.viewport.showGuides}
              onSelectLayer={(layerId, additive) => onSelectLayer(layerId, additive)}
              onActivePageChange={onActivePageChange}
              onCreateUndoCheckpoint={onCreateUndoCheckpoint}
              onUpdateLayer={onUpdateLayer}
              onMoveLayer={onMoveLayer}
              onPlaceLayer={onPlaceLayer}
            />

            <EditorSidebar
              state={state}
              selectedLayer={selectedLayer}
              selectedLayerIds={selectedLayerIds}
              selectedSignatureBox={selectedSignatureBox}
              onSelectLayer={onSelectLayer}
              onUpdateLayer={onUpdateLayer}
              onRemoveSelectedLayer={onRemoveSelectedLayer}
              onOutputNameChange={onOutputNameChange}
              onRotationPageChange={onRotationPageChange}
              onRotationDegreesChange={onRotationDegreesChange}
              onQueuePageRotation={onQueuePageRotation}
              onRemovePageRotation={onRemovePageRotation}
              onPageNumbersEnabledChange={onPageNumbersEnabledChange}
              onPageNumbersChange={onPageNumbersChange}
              onWatermarkEnabledChange={onWatermarkEnabledChange}
              onWatermarkChange={onWatermarkChange}
              onActivePageChange={onActivePageChange}
              onZoomChange={onZoomChange}
              onFitModeChange={onFitModeChange}
              onSnapToGridChange={onSnapToGridChange}
              onShowGuidesChange={onShowGuidesChange}
              onJumpToPage={jumpToPage}
              onUndo={onUndo}
              onRedo={onRedo}
              onTextDefaultsChange={onTextDefaultsChange}
              onRectangleDefaultsChange={onRectangleDefaultsChange}
              onImageDefaultsChange={onImageDefaultsChange}
              onSignatureDefaultsChange={onSignatureDefaultsChange}
              onOpenImagePicker={() => imageInputRef.current?.click()}
              onOpenSignaturePicker={() => signatureInputRef.current?.click()}
              onOpenSignatureChooser={onOpenSignatureChooser}
              onRetentionHoursChange={onRetentionHoursChange}
              onExport={onExport}
              onReorderLayers={onReorderLayers}
              onMoveSelectedLayersInStack={onMoveSelectedLayersInStack}
              invite={invite}
              intelligence={intelligence}
              onInviteEmailChange={onInviteEmailChange}
              onInviteMessageChange={onInviteMessageChange}
              onInviteExpiresInHoursChange={onInviteExpiresInHoursChange}
              onCreateEditorInvite={onCreateEditorInvite}
              onCopyEditorInvite={onCopyEditorInvite}
            />
          </section>

          <SignatureRequestModal
            signatureFlowStep={document.signatures.flowStep}
            signatureRequest={document.signatures.request}
            selectedSignatureBox={selectedSignatureBox}
            busy={state.busy}
            onClose={onCloseSignatureFlow}
            onOnlyMe={() => {
              onOnlyMeSignature();
              if (!state.assets.sign) {
                signatureInputRef.current?.click();
              }
            }}
            onChooseSeveralPeople={onChooseSeveralPeople}
            onBack={onBackSignatureRequest}
            onSignatureRequestChange={onSignatureRequestChange}
            onSendSignatureRequest={onSendSignatureRequest}
          />
        </section>
      </main>
    </div>
  );
}

function ThumbnailRail({
  fileName,
  sourceFileId,
  pages,
  activePage,
  isLoading,
  onJumpToPage
}: {
  fileName: string;
  sourceFileId: string | null;
  pages: EditorDocumentModel["pages"];
  activePage: number;
  isLoading: boolean;
  onJumpToPage: (page: number) => void;
}): React.JSX.Element {
  return (
    <section className="studio-thumbnail-rail" aria-label="Page thumbnails">
      <div className="studio-panel__eyebrow">Pages</div>
      <div className="studio-thumbnail-list">
        {pages.map((page) => (
          <button
            key={page.pageNumber}
            type="button"
            className={`studio-thumbnail ${activePage === page.pageNumber ? "is-active" : ""}`}
            onClick={() => onJumpToPage(page.pageNumber)}
            disabled={isLoading}
          >
            <span className="studio-thumbnail__preview">
              {sourceFileId ? (
                <img
                  src={getPdfPagePreviewUrl(sourceFileId, page.pageNumber)}
                  alt={`${fileName} page ${page.pageNumber}`}
                  draggable={false}
                />
              ) : (
                <span />
              )}
            </span>
            <strong>{page.pageNumber}</strong>
          </button>
        ))}
      </div>
    </section>
  );
}
