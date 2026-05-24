"use client";

import { useEffect, useRef, useState } from "react";
import {
  createFileShare,
  getPdfIntelligence,
  getSharedFile,
  getPdfMetadata,
  pollTask,
  queueEditPdf,
  uploadPdfWithRetention,
  type FileShareResponse,
  type PdfIntelligenceResponse
} from "../lib/pdf-api";
import { buildEditPayload, getWatermarkConfig } from "./editor/adapter";
import { EditorShell } from "./editor/editor-shell";
import { usePdfEditor } from "./editor/use-pdf-editor";
import type { EditorHistorySnapshot, EditorLayer, EditorMode } from "./editor/types";
import { fileToDataUrl, retentionLabel } from "./editor/utils";

const INVITE_EXPIRY_OPTIONS = [
  { value: 24, label: "24 hours" },
  { value: 72, label: "3 days" },
  { value: 168, label: "7 days" },
  { value: 720, label: "30 days" }
];

const DRAFT_STORAGE_PREFIX = "ihatepdf:editor-draft:";

type StoredEditorDraft = {
  version: 1;
  savedAt: string;
  outputName: string;
  retentionHours: number;
  snapshot: EditorHistorySnapshot;
};

function isEditableShortcutTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  if (target.isContentEditable) {
    return true;
  }

  return Boolean(target.closest("input, textarea, select, [contenteditable='true']"));
}

function draftStorageKey(file: File): string {
  return `${DRAFT_STORAGE_PREFIX}${file.name}:${file.size}:${file.lastModified}`;
}

function isStoredEditorDraft(value: unknown): value is StoredEditorDraft {
  if (!value || typeof value !== "object") {
    return false;
  }

  const draft = value as Partial<StoredEditorDraft>;
  return (
    draft.version === 1 &&
    typeof draft.savedAt === "string" &&
    typeof draft.outputName === "string" &&
    typeof draft.retentionHours === "number" &&
    Boolean(draft.snapshot) &&
    Array.isArray(draft.snapshot?.layers) &&
    Array.isArray(draft.snapshot?.pageRotations)
  );
}

export function PdfEditorStudio({
  mode = "edit"
}: {
  mode?: EditorMode;
} = {}): React.JSX.Element {
  const previewLoadIdRef = useRef(0);
  const sharedLoadTokenRef = useRef<string | null>(null);
  const copiedLayersRef = useRef<EditorLayer[]>([]);
  const restoredDraftKeyRef = useRef<string | null>(null);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteMessage, setInviteMessage] = useState("");
  const [inviteExpiresInHours, setInviteExpiresInHours] = useState(72);
  const [inviteBusy, setInviteBusy] = useState(false);
  const [inviteStatus, setInviteStatus] = useState("");
  const [inviteShare, setInviteShare] = useState<FileShareResponse | null>(null);
  const [intelligence, setIntelligence] = useState<PdfIntelligenceResponse | null>(null);
  const [intelligenceBusy, setIntelligenceBusy] = useState(false);
  const [intelligenceStatus, setIntelligenceStatus] = useState("");
  const {
    state,
    selectedLayer,
    selectedLayers,
    selectedLayerIds,
    selectedSignatureBox,
    pageRotationMap,
    pageNumberConfig,
    watermarkConfig,
    hasAnyEdits,
    actions
  } = usePdfEditor(mode);
  const { duplicateSelectedLayers, nudgeSelectedLayers, pasteLayers, redo, removeSelectedLayer, undo } = actions;

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.isComposing || isEditableShortcutTarget(event.target)) {
        return;
      }

      if (
        selectedLayerIds.length > 0 &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.altKey &&
        (event.key === "Delete" || event.key === "Backspace")
      ) {
        event.preventDefault();
        removeSelectedLayer();
        return;
      }

      if (selectedLayerIds.length > 0 && event.key.startsWith("Arrow")) {
        event.preventDefault();
        const step = event.shiftKey ? 10 : 1;
        const deltaByKey: Record<string, [number, number]> = {
          ArrowLeft: [-step, 0],
          ArrowRight: [step, 0],
          ArrowUp: [0, step],
          ArrowDown: [0, -step]
        };
        const [deltaX, deltaY] = deltaByKey[event.key] ?? [0, 0];
        nudgeSelectedLayers(deltaX, deltaY);
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
        return;
      }

      if (key === "d" && selectedLayerIds.length > 0) {
        event.preventDefault();
        duplicateSelectedLayers();
        return;
      }

      if (key === "c" && selectedLayers.length > 0) {
        event.preventDefault();
        copiedLayersRef.current = selectedLayers;
        actions.setStatus(
          selectedLayers.length === 1
            ? "Copied the selected layer."
            : `Copied ${selectedLayers.length} selected layers.`
        );
        return;
      }

      if (key === "v" && copiedLayersRef.current.length > 0) {
        event.preventDefault();
        pasteLayers(copiedLayersRef.current);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    actions,
    duplicateSelectedLayers,
    nudgeSelectedLayers,
    pasteLayers,
    redo,
    removeSelectedLayer,
    selectedLayerIds,
    selectedLayers,
    undo
  ]);

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
    const pdfFile = state.document.file;
    if (!pdfFile) {
      previewLoadIdRef.current += 1;
      restoredDraftKeyRef.current = null;
      actions.setSourceFile(null, null);
      setIntelligence(null);
      setIntelligenceStatus("");
      setIntelligenceBusy(false);
      return;
    }

    const loadId = previewLoadIdRef.current + 1;
    previewLoadIdRef.current = loadId;
    const retentionHours = state.document.export.retentionHours;
    actions.loadPreviewStarted(pdfFile.name);
    setIntelligence(null);
    setIntelligenceStatus("");
    setIntelligenceBusy(true);

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

        try {
          const analysis = await getPdfIntelligence(uploaded.fileId);
          if (previewLoadIdRef.current === loadId) {
            setIntelligence(analysis);
            setIntelligenceStatus("Document intelligence is ready.");
          }
        } catch (analysisError) {
          if (previewLoadIdRef.current === loadId) {
            setIntelligenceStatus(`Document intelligence failed: ${(analysisError as Error).message}`);
          }
        }
      } catch (error) {
        if (previewLoadIdRef.current !== loadId) {
          return;
        }
        actions.loadPreviewFailed(`PDF preview metadata failed: ${(error as Error).message}`);
        setIntelligenceStatus("");
      } finally {
        if (previewLoadIdRef.current === loadId) {
          setIntelligenceBusy(false);
        }
      }
    })();
  }, [state.document.file, state.document.export.retentionHours]);

  useEffect(() => {
    const pdfFile = state.document.file;
    if (!pdfFile || state.isLoadingPreview) {
      return;
    }

    const key = draftStorageKey(pdfFile);
    if (restoredDraftKeyRef.current === key) {
      return;
    }

    restoredDraftKeyRef.current = key;

    try {
      const rawDraft = window.localStorage.getItem(key);
      if (!rawDraft) {
        return;
      }

      const parsed = JSON.parse(rawDraft) as unknown;
      if (!isStoredEditorDraft(parsed)) {
        return;
      }

      actions.restoreDraft(parsed.snapshot, parsed.outputName, parsed.retentionHours);
    } catch {
      window.localStorage.removeItem(key);
    }
  }, [actions, state.document.file, state.isLoadingPreview]);

  useEffect(() => {
    const pdfFile = state.document.file;
    if (!pdfFile || state.isLoadingPreview) {
      return;
    }

    const key = draftStorageKey(pdfFile);
    const draft: StoredEditorDraft = {
      version: 1,
      savedAt: new Date().toISOString(),
      outputName: state.document.export.outputName,
      retentionHours: state.document.export.retentionHours,
      snapshot: {
        layers: state.document.layers,
        selection: state.document.selection,
        pageRotations: state.document.operations.pageRotations,
        pageNumbers: state.document.operations.pageNumbers,
        watermark: state.document.operations.watermark
      }
    };

    const timeout = window.setTimeout(() => {
      window.localStorage.setItem(key, JSON.stringify(draft));
    }, 450);

    return () => window.clearTimeout(timeout);
  }, [
    state.document.export.outputName,
    state.document.export.retentionHours,
    state.document.file,
    state.document.layers,
    state.document.operations.pageNumbers,
    state.document.operations.pageRotations,
    state.document.operations.watermark,
    state.document.selection,
    state.isLoadingPreview
  ]);

  const processDocument = async (): Promise<void> => {
    const document = state.document;

    if (!document.file) {
      actions.setStatus("Upload a PDF document first.");
      return;
    }

    if (!document.export.outputName.trim()) {
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
      let uploadedFileId = document.sourceFileId;

      if (!uploadedFileId || document.sourceRetentionHours !== document.export.retentionHours) {
        actions.setStatus("Uploading the source PDF to your self-hosted workspace...");
        uploadedFileId = (await uploadPdfWithRetention(document.file, document.export.retentionHours)).fileId;
        actions.setSourceFile(uploadedFileId, document.export.retentionHours);
      }

      actions.setStatus("Applying studio layers to the document...");
      const { taskId } = await queueEditPdf(uploadedFileId, document.export.outputName.trim(), buildEditPayload(state));
      const completed = await pollTask(taskId);

      if (completed.status === "completed" && completed.outputDownloadUrl) {
        actions.setDownloadUrl(completed.outputDownloadUrl);
        actions.setStatus(
          `Studio export completed. Download remains active for ${retentionLabel(document.export.retentionHours)}.`
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
    const document = state.document;

    if (!document.file) {
      setInviteStatus("Open a PDF before inviting collaborators.");
      return;
    }

    try {
      setInviteBusy(true);
      setInviteStatus("Preparing editor invite...");
      setInviteShare(null);

      let fileId = document.sourceFileId;
      if (!fileId || document.sourceRetentionHours !== document.export.retentionHours) {
        const uploaded = await uploadPdfWithRetention(document.file, document.export.retentionHours);
        fileId = uploaded.fileId;
        actions.setSourceFile(fileId, document.export.retentionHours);
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
    const document = state.document;

    if (!document.file || !document.sourceFileId) {
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
      selectedLayerIds={selectedLayerIds}
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
      onActivePageChange={actions.setActivePage}
      onZoomChange={actions.setZoom}
      onFitModeChange={actions.setFitMode}
      onSnapToGridChange={actions.setSnapToGrid}
      onShowGuidesChange={actions.setShowGuides}
      onScrollTargetChange={actions.setScrollTarget}
      onUndo={actions.undo}
      onRedo={actions.redo}
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
      onMoveSelectedLayersInStack={actions.moveSelectedLayersInStack}
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
      intelligence={{
        data: intelligence,
        busy: intelligenceBusy,
        status: intelligenceStatus
      }}
      onInviteEmailChange={setInviteEmail}
      onInviteMessageChange={setInviteMessage}
      onInviteExpiresInHoursChange={setInviteExpiresInHours}
      onCreateEditorInvite={() => void createEditorInvite()}
      onCopyEditorInvite={() => void copyEditorInvite()}
    />
  );
}
