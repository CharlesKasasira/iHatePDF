"use client";

import { useEffect, useRef, useState } from "react";
import {
  createFileShare,
  getSharedFile,
  getPdfMetadata,
  pollTask,
  queueEditPdf,
  uploadPdfWithRetention,
  type FileShareResponse
} from "../lib/pdf-api";
import { buildEditPayload, getWatermarkConfig } from "./editor/adapter";
import { EditorShell } from "./editor/editor-shell";
import { usePdfEditor } from "./editor/use-pdf-editor";
import type { EditorMode } from "./editor/types";
import { fileToDataUrl, retentionLabel } from "./editor/utils";

const INVITE_EXPIRY_OPTIONS = [
  { value: 24, label: "24 hours" },
  { value: 72, label: "3 days" },
  { value: 168, label: "7 days" },
  { value: 720, label: "30 days" }
];

function isEditableShortcutTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  if (target.isContentEditable) {
    return true;
  }

  return Boolean(target.closest("input, textarea, select, [contenteditable='true']"));
}

export function PdfEditorStudio({
  mode = "edit"
}: {
  mode?: EditorMode;
} = {}): React.JSX.Element {
  const previewLoadIdRef = useRef(0);
  const sharedLoadTokenRef = useRef<string | null>(null);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteMessage, setInviteMessage] = useState("");
  const [inviteExpiresInHours, setInviteExpiresInHours] = useState(72);
  const [inviteBusy, setInviteBusy] = useState(false);
  const [inviteStatus, setInviteStatus] = useState("");
  const [inviteShare, setInviteShare] = useState<FileShareResponse | null>(null);
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
  const { redo, removeSelectedLayer, undo } = actions;

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.isComposing || isEditableShortcutTarget(event.target)) {
        return;
      }

      if (
        state.selection.layerId &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.altKey &&
        (event.key === "Delete" || event.key === "Backspace")
      ) {
        event.preventDefault();
        removeSelectedLayer();
        return;
      }

      const hasShortcutModifier = event.ctrlKey || event.metaKey;
      if (!hasShortcutModifier || event.altKey) {
        return;
      }

      const key = event.key.toLowerCase();
      if (key === "z") {
        event.preventDefault();
        if (event.shiftKey) {
          redo();
        } else {
          undo();
        }
        return;
      }

      if (key === "y") {
        event.preventDefault();
        redo();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [redo, removeSelectedLayer, state.selection.layerId, undo]);

  useEffect(() => {
    const token = new URLSearchParams(window.location.search).get("shared");
    if (!token || sharedLoadTokenRef.current === token) {
      return;
    }

    sharedLoadTokenRef.current = token;
    actions.setStatus("Loading shared PDF into the editor...");

    void (async () => {
      try {
        const sharedFile = await getSharedFile(token);
        const response = await fetch(sharedFile.downloadUrl, { credentials: "include" });
        if (!response.ok) {
          throw new Error(`Shared PDF download failed (${response.status}).`);
        }

        const blob = await response.blob();
        const file = new File([blob], sharedFile.fileName, {
          type: sharedFile.mimeType || "application/pdf"
        });

        actions.selectPdfFile(file);
        actions.setStatus("Shared PDF loaded. Edits you make here are saved as your own export.");
      } catch (error) {
        actions.setStatus(`Shared PDF failed to load: ${(error as Error).message}`);
      }
    })();
  }, [actions]);

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

  const createEditorInvite = async (): Promise<void> => {
    if (!state.pdfFile) {
      setInviteStatus("Open a PDF before inviting collaborators.");
      return;
    }

    try {
      setInviteBusy(true);
      setInviteStatus("Preparing editor invite...");
      setInviteShare(null);

      let fileId = state.sourceFileId;
      if (!fileId || state.sourceRetentionHours !== state.retentionHours) {
        const uploaded = await uploadPdfWithRetention(state.pdfFile, state.retentionHours);
        fileId = uploaded.fileId;
        actions.setSourceFile(fileId, state.retentionHours);
      }

      const share = await createFileShare({
        fileId,
        email: inviteEmail.trim() || undefined,
        message: inviteMessage.trim() || undefined,
        expiresInHours: inviteExpiresInHours,
        mode: "editor"
      });

      setInviteShare(share);
      setInviteStatus(share.emailSent ? "Editor invite created and email sent." : "Editor invite link created.");
    } catch (error) {
      setInviteStatus(`Editor invite failed: ${(error as Error).message}`);
    } finally {
      setInviteBusy(false);
    }
  };

  const copyEditorInvite = async (): Promise<void> => {
    if (!inviteShare) {
      return;
    }

    await navigator.clipboard.writeText(inviteShare.shareUrl);
    setInviteStatus("Editor invite link copied.");
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
      onCreateUndoCheckpoint={actions.createUndoCheckpoint}
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
      onReorderLayers={actions.reorderLayers}
      onPlaceLayer={(pageNumber, x, y) => actions.createLayerAt(pageNumber, x, y)}
      invite={{
        email: inviteEmail,
        message: inviteMessage,
        expiresInHours: inviteExpiresInHours,
        expiryOptions: INVITE_EXPIRY_OPTIONS,
        busy: inviteBusy,
        status: inviteStatus,
        share: inviteShare
      }}
      onInviteEmailChange={setInviteEmail}
      onInviteMessageChange={setInviteMessage}
      onInviteExpiresInHoursChange={setInviteExpiresInHours}
      onCreateEditorInvite={() => void createEditorInvite()}
      onCopyEditorInvite={() => void copyEditorInvite()}
    />
  );
}
