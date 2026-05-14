"use client";

import { useEffect, useRef } from "react";
import {
  getPdfMetadata,
  pollTask,
  queueEditPdf,
  uploadPdfWithRetention
} from "../lib/pdf-api";
import { buildEditPayload, getWatermarkConfig } from "./editor/adapter";
import { EditorShell } from "./editor/editor-shell";
import { usePdfEditor } from "./editor/use-pdf-editor";
import type { EditorMode } from "./editor/types";
import { fileToDataUrl, retentionLabel } from "./editor/utils";

export function PdfEditorStudio({
  mode = "edit"
}: {
  mode?: EditorMode;
} = {}): React.JSX.Element {
  const previewLoadIdRef = useRef(0);
  const {
    state,
    selectedLayer,
    selectedSignatureBox,
    pageRotationMap,
    pageNumberConfig,
    watermarkConfig,
    hasAnyEdits,
    actions
  } = usePdfEditor(mode);

  useEffect(() => {
    const pdfFile = state.pdfFile;
    if (!pdfFile) {
      previewLoadIdRef.current += 1;
      actions.setSourceFile(null, null);
      return;
    }

    const loadId = previewLoadIdRef.current + 1;
    previewLoadIdRef.current = loadId;
    const retentionHours = state.retentionHours;
    actions.loadPreviewStarted(pdfFile.name);

    void (async () => {
      try {
        const uploaded = await uploadPdfWithRetention(pdfFile, retentionHours);
        const metadata = await getPdfMetadata(uploaded.fileId);

        if (previewLoadIdRef.current !== loadId) {
          return;
        }

        actions.loadPreviewSucceeded({
          fileId: uploaded.fileId,
          retentionHours,
          pages: metadata.pages,
          pageCount: metadata.pageCount,
          fileName: pdfFile.name
        });
      } catch (error) {
        if (previewLoadIdRef.current !== loadId) {
          return;
        }
        actions.loadPreviewFailed(`PDF preview metadata failed: ${(error as Error).message}`);
      }
    })();
  }, [state.pdfFile]);

  const processDocument = async (): Promise<void> => {
    if (!state.pdfFile) {
      actions.setStatus("Upload a PDF document first.");
      return;
    }

    if (!state.outputName.trim()) {
      actions.setStatus("Name the edited PDF before exporting.");
      return;
    }

    if (!hasAnyEdits) {
      actions.setStatus("Add at least one layer or document operation before exporting.");
      return;
    }

    const watermark = getWatermarkConfig(state);
    if (watermark && !watermark.text) {
      actions.setStatus("Enter watermark text before exporting.");
      return;
    }

    try {
      actions.setBusy(true);
      actions.setDownloadUrl("");
      let uploadedFileId = state.sourceFileId;

      if (!uploadedFileId || state.sourceRetentionHours !== state.retentionHours) {
        actions.setStatus("Uploading the source PDF to your self-hosted workspace...");
        uploadedFileId = (await uploadPdfWithRetention(state.pdfFile, state.retentionHours)).fileId;
        actions.setSourceFile(uploadedFileId, state.retentionHours);
      }

      actions.setStatus("Applying studio layers to the document...");
      const { taskId } = await queueEditPdf(uploadedFileId, state.outputName.trim(), buildEditPayload(state));
      const completed = await pollTask(taskId);

      if (completed.status === "completed" && completed.outputDownloadUrl) {
        actions.setDownloadUrl(completed.outputDownloadUrl);
        actions.setStatus(
          `Studio export completed. Download remains active for ${retentionLabel(state.retentionHours)}.`
        );
      } else {
        actions.setStatus(`Studio export failed: ${completed.errorMessage ?? "unknown error"}`);
      }
    } catch (error) {
      actions.setStatus(`Studio export failed: ${(error as Error).message}`);
    } finally {
      actions.setBusy(false);
    }
  };

  const sendSignatureRequest = async (): Promise<void> => {
    actions.setSignatureRequestFeedback(
      "Signing workflows now live in the dedicated Sign PDF workspace. Open /sign-pdf to configure multi-signer routing, field types, reminders, reassignment, and final locked output."
    );
  };

  const handleAssetFileChange = async (file: File, kind: "image" | "sign"): Promise<void> => {
    try {
      const dataUrl = await fileToDataUrl(file);
      actions.setAsset(kind, { dataUrl, fileName: file.name });
    } catch (error) {
      actions.setStatus((error as Error).message);
    }
  };

  const openSignatureChooser = (): void => {
    if (!state.pdfFile || !state.sourceFileId) {
      actions.setSignatureRequestFeedback("Open a PDF first.");
      return;
    }

    if (!selectedSignatureBox) {
      actions.setSignatureRequestFeedback("Select a rectangle layer to define the signer box first.");
      return;
    }

    actions.resetSignatureRequestFeedback();
    actions.setSignatureFlowStep("choose");
  };

  return (
    <EditorShell
      mode={mode}
      state={state}
      selectedLayer={selectedLayer}
      selectedSignatureBox={selectedSignatureBox}
      pageRotationMap={pageRotationMap}
      pageNumberConfig={pageNumberConfig}
      watermarkConfig={watermarkConfig}
      onPdfFileChange={actions.selectPdfFile}
      onAssetFileChange={handleAssetFileChange}
      onToolSelect={actions.setTool}
      onTextDefaultsChange={actions.setTextDefaults}
      onRectangleDefaultsChange={actions.setRectangleDefaults}
      onImageDefaultsChange={actions.setImageDefaults}
      onSignatureDefaultsChange={actions.setSignatureDefaults}
      onSelectLayer={actions.setSelectedLayerId}
      onUpdateLayer={actions.updateLayer}
      onRemoveSelectedLayer={actions.removeSelectedLayer}
      onOutputNameChange={actions.setOutputName}
      onRotationPageChange={actions.setRotationPage}
      onRotationDegreesChange={actions.setRotationDegrees}
      onQueuePageRotation={actions.queuePageRotation}
      onRemovePageRotation={actions.removePageRotation}
      onPageNumbersEnabledChange={actions.setPageNumbersEnabled}
      onPageNumbersChange={actions.setPageNumbers}
      onWatermarkEnabledChange={actions.setWatermarkEnabled}
      onWatermarkChange={actions.setWatermark}
      onOpenSignatureChooser={openSignatureChooser}
      onRetentionHoursChange={actions.setRetentionHours}
      onExport={processDocument}
      onCloseSignatureFlow={() => actions.setSignatureFlowStep("closed")}
      onOnlyMeSignature={() => {
        actions.setSignatureFlowStep("closed");
        actions.setTool("sign");
      }}
      onChooseSeveralPeople={() => actions.setSignatureFlowStep("request")}
      onBackSignatureRequest={() => actions.setSignatureFlowStep("choose")}
      onSignatureRequestChange={actions.setSignatureRequest}
      onSendSignatureRequest={sendSignatureRequest}
      onMoveLayer={actions.moveLayer}
      onPlaceLayer={(pageNumber, x, y) => actions.createLayerAt(pageNumber, x, y)}
    />
  );
}
