"use client";

import { useRef } from "react";
import { SiteHeader } from "../site-header";
import type {
  EditorDocumentState,
  EditorDraftDefaults,
  EditorLayer,
  EditorMode,
  EditorRectangleLayer
} from "./types";
import { EditorToolbar } from "./editor-toolbar";
import { EditorSidebar } from "./editor-sidebar";
import { EditorCanvas } from "./editor-canvas";
import { SignatureRequestModal } from "./signature-request-modal";

export function EditorShell({
  mode,
  state,
  selectedLayer,
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
  onPlaceLayer
}: {
  mode: EditorMode;
  state: EditorDocumentState;
  selectedLayer: EditorLayer | null;
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
  onSelectLayer: (layerId: string | null) => void;
  onUpdateLayer: (layerId: string, updater: (layer: EditorLayer) => EditorLayer) => void;
  onRemoveSelectedLayer: () => void;
  onOutputNameChange: (outputName: string) => void;
  onRotationPageChange: (page: number) => void;
  onRotationDegreesChange: (degrees: EditorDocumentState["rotationDegrees"]) => void;
  onQueuePageRotation: () => void;
  onRemovePageRotation: (page: number) => void;
  onPageNumbersEnabledChange: (enabled: boolean) => void;
  onPageNumbersChange: (patch: Partial<EditorDocumentState["pageNumbers"]>) => void;
  onWatermarkEnabledChange: (enabled: boolean) => void;
  onWatermarkChange: (patch: Partial<EditorDocumentState["watermark"]>) => void;
  onOpenSignatureChooser: () => void;
  onRetentionHoursChange: (retentionHours: number) => void;
  onExport: () => Promise<void>;
  onCloseSignatureFlow: () => void;
  onOnlyMeSignature: () => void;
  onChooseSeveralPeople: () => void;
  onBackSignatureRequest: () => void;
  onSignatureRequestChange: (patch: Partial<EditorDocumentState["signatureRequest"]>) => void;
  onSendSignatureRequest: () => Promise<void>;
  onMoveLayer: (layerId: string, x: number, y: number) => void;
  onReorderLayers: (layers: EditorLayer[]) => void;
  onPlaceLayer: (pageNumber: number, x: number, y: number) => void;
}): React.JSX.Element {
  const pdfInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const signatureInputRef = useRef<HTMLInputElement>(null);

  const handleToolSelection = (tool: EditorDocumentState["tool"]): void => {
    onToolSelect(tool);
    if (tool === "image" && !state.assets.image) {
      imageInputRef.current?.click();
    }
    if (tool === "sign" && !state.assets.sign) {
      signatureInputRef.current?.click();
    }
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
                {state.pdfFile ? "Replace PDF" : "Open PDF"}
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
                  {state.pdfFile
                    ? "Click the document surface to place the active tool. Use the inspector on the right for exact values."
                    : "Open a PDF to enable the page surface."}
                </span>
              </div>
            </aside>

            <EditorCanvas
              pdfFile={state.pdfFile}
              sourceFileId={state.sourceFileId}
              pages={state.pages}
              layers={state.layers}
              pageRotationMap={pageRotationMap}
              pageNumbers={pageNumberConfig}
              watermark={watermarkConfig}
              activeTool={state.tool}
              selectedLayerId={state.selection.layerId}
              onSelectLayer={(layerId) => onSelectLayer(layerId)}
              onUpdateLayer={onUpdateLayer}
              onMoveLayer={onMoveLayer}
              onPlaceLayer={onPlaceLayer}
            />

            <EditorSidebar
              state={state}
              selectedLayer={selectedLayer}
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
            />
          </section>

          <SignatureRequestModal
            signatureFlowStep={state.signatureFlowStep}
            signatureRequest={state.signatureRequest}
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
