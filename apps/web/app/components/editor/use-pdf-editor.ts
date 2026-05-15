"use client";

import { useCallback, useMemo, useReducer } from "react";
import type { EditPageRotationInput } from "../../lib/pdf-api";
import { DEFAULT_EDITOR_PAGE } from "./constants";
import type {
  EditorAction,
  EditorAssetState,
  EditorDocumentState,
  EditorDraftDefaults,
  EditorLayer,
  EditorMode,
  EditorPage,
  EditorTool
} from "./types";
import {
  buildDefaultOutputName,
  buildDefaultSignatureRequestOutputName,
  buildEditedName,
  buildSignedName,
  nextLayerId,
  toolStatusMessage
} from "./utils";
import { getPageNumbersConfig, getWatermarkConfig, hasAnyEdits } from "./adapter";

function createInitialDraftDefaults(): EditorDraftDefaults {
  return {
    text: {
      text: "Approved",
      fontFamily: "sans",
      fontSize: 20,
      color: "#19334d",
      bold: true,
      italic: false,
      underline: false
    },
    rectangle: {
      width: 220,
      height: 54,
      color: "#ffd166",
      opacity: 0.22
    },
    image: {
      width: 180,
      height: 88
    },
    signature: {
      width: 190,
      height: 72
    }
  };
}

function createInitialState(mode: EditorMode): EditorDocumentState {
  return {
    mode,
    pdfFile: null,
    sourceFileId: null,
    sourceRetentionHours: null,
    pages: [DEFAULT_EDITOR_PAGE],
    isLoadingPreview: false,
    tool: "select",
    layers: [],
    selection: { layerId: null },
    status: "Upload a PDF to begin a controlled studio editing session.",
    busy: false,
    downloadUrl: "",
    outputName: buildDefaultOutputName(mode),
    retentionHours: 24,
    draftDefaults: createInitialDraftDefaults(),
    assets: {
      image: null,
      sign: null
    },
    pageRotations: [],
    rotationPage: 1,
    rotationDegrees: 90,
    pageNumbers: {
      enabled: false,
      startAt: 1,
      fontSize: 12,
      color: "#19334d",
      position: "bottom-center",
      margin: 24,
      prefix: ""
    },
    watermark: {
      enabled: false,
      text: "Confidential",
      fontSize: 64,
      color: "#19334d",
      opacity: 0.14,
      rotation: -32
    },
    signatureRequest: {
      requesterEmail: "",
      signerName: "",
      signerEmail: "",
      signerRole: "Signer",
      message: "",
      outputName: buildDefaultSignatureRequestOutputName(),
      status: "",
      link: ""
    },
    signatureFlowStep: "closed",
    viewport: {
      zoom: 1,
      fitMode: "fit-width",
      activePage: 1,
      scrollAnchor: null
    }
  };
}

function reducer(state: EditorDocumentState, action: EditorAction): EditorDocumentState {
  switch (action.type) {
    case "reset-for-pdf":
      return {
        ...state,
        pdfFile: action.file,
        sourceFileId: null,
        sourceRetentionHours: null,
        pages: [DEFAULT_EDITOR_PAGE],
        isLoadingPreview: false,
        layers: [],
        pageRotations: [],
        rotationPage: 1,
        selection: { layerId: null },
        downloadUrl: "",
        outputName: action.outputName,
        signatureRequest: {
          ...state.signatureRequest,
          outputName: action.signatureRequestOutputName,
          status: "",
          link: ""
        },
        signatureFlowStep: "closed"
      };
    case "load-preview-started":
      return {
        ...state,
        isLoadingPreview: true,
        sourceFileId: null,
        pages: [DEFAULT_EDITOR_PAGE],
        status: `Loading ${action.fileName} for preview...`
      };
    case "load-preview-succeeded":
      return {
        ...state,
        sourceFileId: action.fileId,
        sourceRetentionHours: action.retentionHours,
        pages: action.pages.length > 0 ? action.pages : [DEFAULT_EDITOR_PAGE],
        rotationPage: Math.min(Math.max(1, state.rotationPage), Math.max(1, action.pageCount)),
        isLoadingPreview: false,
        status: `${action.fileName} loaded. ${action.pageCount} page${action.pageCount === 1 ? "" : "s"} ready for editing.`
      };
    case "load-preview-failed":
      return {
        ...state,
        sourceFileId: null,
        sourceRetentionHours: null,
        pages: [DEFAULT_EDITOR_PAGE],
        isLoadingPreview: false,
        status: action.message
      };
    case "set-tool":
      return { ...state, tool: action.tool, selection: { layerId: null } };
    case "set-selection":
      return { ...state, selection: { layerId: action.layerId } };
    case "add-layer":
      return {
        ...state,
        layers: [...state.layers, action.layer],
        selection: { layerId: action.layer.id },
        status: action.status
      };
    case "update-layer":
      return {
        ...state,
        layers: state.layers.map((layer) =>
          layer.id === action.layerId ? action.updater(layer) : layer
        )
      };
    case "set-layers":
      return {
        ...state,
        layers: action.layers,
        status: action.status ?? state.status
      };
    case "remove-layer":
      return {
        ...state,
        layers: state.layers.filter((layer) => layer.id !== action.layerId),
        selection: {
          layerId: state.selection.layerId === action.layerId ? null : state.selection.layerId
        }
      };
    case "set-status":
      return { ...state, status: action.status };
    case "set-busy":
      return { ...state, busy: action.busy };
    case "set-download-url":
      return { ...state, downloadUrl: action.downloadUrl };
    case "set-output-name":
      return { ...state, outputName: action.outputName };
    case "set-retention-hours":
      return { ...state, retentionHours: action.retentionHours };
    case "set-text-defaults":
      return {
        ...state,
        draftDefaults: {
          ...state.draftDefaults,
          text: { ...state.draftDefaults.text, ...action.patch }
        }
      };
    case "set-rectangle-defaults":
      return {
        ...state,
        draftDefaults: {
          ...state.draftDefaults,
          rectangle: { ...state.draftDefaults.rectangle, ...action.patch }
        }
      };
    case "set-image-defaults":
      return {
        ...state,
        draftDefaults: {
          ...state.draftDefaults,
          image: { ...state.draftDefaults.image, ...action.patch }
        }
      };
    case "set-signature-defaults":
      return {
        ...state,
        draftDefaults: {
          ...state.draftDefaults,
          signature: { ...state.draftDefaults.signature, ...action.patch }
        }
      };
    case "set-asset":
      return {
        ...state,
        assets: {
          ...state.assets,
          [action.kind]: action.asset
        }
      };
    case "set-page-rotations":
      return { ...state, pageRotations: action.pageRotations };
    case "set-rotation-page":
      return { ...state, rotationPage: action.rotationPage };
    case "set-rotation-degrees":
      return { ...state, rotationDegrees: action.rotationDegrees };
    case "set-page-numbers-enabled":
      return {
        ...state,
        pageNumbers: { ...state.pageNumbers, enabled: action.enabled }
      };
    case "set-page-numbers":
      return {
        ...state,
        pageNumbers: { ...state.pageNumbers, ...action.patch }
      };
    case "set-watermark-enabled":
      return {
        ...state,
        watermark: { ...state.watermark, enabled: action.enabled }
      };
    case "set-watermark":
      return {
        ...state,
        watermark: { ...state.watermark, ...action.patch }
      };
    case "set-signature-request":
      return {
        ...state,
        signatureRequest: { ...state.signatureRequest, ...action.patch }
      };
    case "set-signature-request-feedback":
      return {
        ...state,
        signatureRequest: {
          ...state.signatureRequest,
          status: action.status,
          link: action.link ?? state.signatureRequest.link
        }
      };
    case "set-signature-flow-step":
      return { ...state, signatureFlowStep: action.step };
    case "set-source-file":
      return {
        ...state,
        sourceFileId: action.fileId,
        sourceRetentionHours: action.retentionHours
      };
    default:
      return state;
  }
}

export function usePdfEditor(mode: EditorMode) {
  const [state, dispatch] = useReducer(reducer, mode, createInitialState);

  const selectPdfFile = useCallback(
    (file: File | null) => {
      dispatch({
        type: "reset-for-pdf",
        file,
        outputName: file ? buildEditedName(file.name) : buildDefaultOutputName(mode),
        signatureRequestOutputName: file
          ? buildSignedName(file.name)
          : buildDefaultSignatureRequestOutputName()
      });
    },
    [mode]
  );

  const setTool = useCallback((tool: EditorTool) => {
    dispatch({ type: "set-tool", tool });
    const nextStatus = toolStatusMessage(tool);
    if (nextStatus) {
      dispatch({ type: "set-status", status: nextStatus });
    }
  }, []);

  const setSelectedLayerId = useCallback((layerId: string | null) => {
    dispatch({ type: "set-selection", layerId });
  }, []);

  const setStatus = useCallback((status: string) => {
    dispatch({ type: "set-status", status });
  }, []);

  const setBusy = useCallback((busy: boolean) => {
    dispatch({ type: "set-busy", busy });
  }, []);

  const setDownloadUrl = useCallback((downloadUrl: string) => {
    dispatch({ type: "set-download-url", downloadUrl });
  }, []);

  const setOutputName = useCallback((outputName: string) => {
    dispatch({ type: "set-output-name", outputName });
  }, []);

  const setRetentionHours = useCallback((retentionHours: number) => {
    dispatch({ type: "set-retention-hours", retentionHours });
  }, []);

  const loadPreviewStarted = useCallback((fileName: string) => {
    dispatch({ type: "load-preview-started", fileName });
  }, []);

  const loadPreviewSucceeded = useCallback(
    (payload: {
      fileId: string;
      retentionHours: number;
      pages: EditorPage[];
      pageCount: number;
      fileName: string;
    }) => {
      dispatch({ type: "load-preview-succeeded", ...payload });
    },
    []
  );

  const loadPreviewFailed = useCallback((message: string) => {
    dispatch({ type: "load-preview-failed", message });
  }, []);

  const setSourceFile = useCallback((fileId: string | null, retentionHours: number | null) => {
    dispatch({ type: "set-source-file", fileId, retentionHours });
  }, []);

  const updateLayer = useCallback(
    (layerId: string, updater: (layer: EditorLayer) => EditorLayer) => {
      dispatch({ type: "update-layer", layerId, updater });
    },
    []
  );

  const moveLayer = useCallback(
    (layerId: string, x: number, y: number) => {
      dispatch({
        type: "update-layer",
        layerId,
        updater: (layer) => ({ ...layer, x, y })
      });
    },
    []
  );

  const reorderLayers = useCallback((layers: EditorLayer[]) => {
    dispatch({ type: "set-layers", layers, status: "Layer stack order updated." });
  }, []);

  const createLayerAt = useCallback(
    (pageNumber: number, x: number, y: number) => {
      if (state.tool === "select") {
        dispatch({ type: "set-selection", layerId: null });
        return;
      }

      if (state.tool === "text") {
        const text = state.draftDefaults.text.text.trim();
        if (!text) {
          dispatch({ type: "set-status", status: "Add some draft text before placing a text layer." });
          return;
        }

        dispatch({
          type: "add-layer",
          layer: {
            id: nextLayerId(),
            kind: "text",
            page: pageNumber,
            x,
            y,
            text,
            fontSize: state.draftDefaults.text.fontSize,
            fontFamily: state.draftDefaults.text.fontFamily,
            bold: state.draftDefaults.text.bold,
            italic: state.draftDefaults.text.italic,
            underline: state.draftDefaults.text.underline,
            color: state.draftDefaults.text.color
          },
          status: `Placed a text layer on page ${pageNumber}.`
        });
        return;
      }

      if (state.tool === "highlight" || state.tool === "shape") {
        dispatch({
          type: "add-layer",
          layer: {
            id: nextLayerId(),
            kind: "rectangle",
            variant: state.tool,
            page: pageNumber,
            x,
            y,
            width: state.draftDefaults.rectangle.width,
            height: state.draftDefaults.rectangle.height,
            color: state.tool === "highlight" ? "#ffe082" : state.draftDefaults.rectangle.color,
            opacity: state.tool === "highlight" ? 0.26 : state.draftDefaults.rectangle.opacity
          },
          status: `Placed a ${state.tool === "highlight" ? "highlight" : "shape"} layer on page ${pageNumber}.`
        });
        return;
      }

      const asset = state.tool === "sign" ? state.assets.sign : state.assets.image;
      if (!asset) {
        dispatch({
          type: "set-status",
          status:
            state.tool === "sign"
              ? "Upload a signature image first, then click the page to place it."
              : "Upload an image asset first, then click the page to place it."
        });
        return;
      }

      dispatch({
        type: "add-layer",
        layer: {
          id: nextLayerId(),
          kind: "image",
          variant: state.tool,
          page: pageNumber,
          x,
          y,
          width: state.tool === "sign" ? state.draftDefaults.signature.width : state.draftDefaults.image.width,
          height: state.tool === "sign" ? state.draftDefaults.signature.height : state.draftDefaults.image.height,
          dataUrl: asset.dataUrl,
          fileName: asset.fileName
        },
        status: `Placed ${state.tool === "sign" ? "a signature" : "an image"} on page ${pageNumber}.`
      });
    },
    [state]
  );

  const setAsset = useCallback((kind: "image" | "sign", asset: EditorAssetState) => {
    dispatch({ type: "set-asset", kind, asset });
    if (!asset) {
      return;
    }

    const tool = kind === "sign" ? "sign" : "image";
    dispatch({ type: "set-tool", tool });
    dispatch({
      type: "set-status",
      status:
        kind === "sign"
          ? `Signature asset ${asset.fileName} is ready. Click a page to stamp it.`
          : `Image asset ${asset.fileName} is ready. Click a page to place it.`
    });
  }, []);

  const queuePageRotation = useCallback(() => {
    const next = state.pageRotations.filter((item) => item.page !== state.rotationPage);
    next.push({ page: state.rotationPage, degrees: state.rotationDegrees });
    next.sort((left, right) => left.page - right.page);
    dispatch({ type: "set-page-rotations", pageRotations: next });
    dispatch({
      type: "set-status",
      status: `Queued a ${state.rotationDegrees}° rotation for page ${state.rotationPage}.`
    });
  }, [state.pageRotations, state.rotationDegrees, state.rotationPage]);

  const removePageRotation = useCallback((page: number) => {
    dispatch({
      type: "set-page-rotations",
      pageRotations: state.pageRotations.filter((item) => item.page !== page)
    });
  }, [state.pageRotations]);

  const setRotationPage = useCallback((rotationPage: number) => {
    dispatch({ type: "set-rotation-page", rotationPage });
  }, []);

  const setRotationDegrees = useCallback((rotationDegrees: EditPageRotationInput["degrees"]) => {
    dispatch({ type: "set-rotation-degrees", rotationDegrees });
  }, []);

  const setTextDefaults = useCallback((patch: Partial<EditorDraftDefaults["text"]>) => {
    dispatch({ type: "set-text-defaults", patch });
  }, []);

  const setRectangleDefaults = useCallback((patch: Partial<EditorDraftDefaults["rectangle"]>) => {
    dispatch({ type: "set-rectangle-defaults", patch });
  }, []);

  const setImageDefaults = useCallback((patch: Partial<EditorDraftDefaults["image"]>) => {
    dispatch({ type: "set-image-defaults", patch });
  }, []);

  const setSignatureDefaults = useCallback((patch: Partial<EditorDraftDefaults["signature"]>) => {
    dispatch({ type: "set-signature-defaults", patch });
  }, []);

  const setPageNumbersEnabled = useCallback((enabled: boolean) => {
    dispatch({ type: "set-page-numbers-enabled", enabled });
  }, []);

  const setPageNumbers = useCallback((patch: Partial<EditorDocumentState["pageNumbers"]>) => {
    dispatch({ type: "set-page-numbers", patch });
  }, []);

  const setWatermarkEnabled = useCallback((enabled: boolean) => {
    dispatch({ type: "set-watermark-enabled", enabled });
  }, []);

  const setWatermark = useCallback((patch: Partial<EditorDocumentState["watermark"]>) => {
    dispatch({ type: "set-watermark", patch });
  }, []);

  const setSignatureRequest = useCallback(
    (patch: Partial<EditorDocumentState["signatureRequest"]>) => {
      dispatch({ type: "set-signature-request", patch });
    },
    []
  );

  const setSignatureRequestFeedback = useCallback((status: string, link?: string) => {
    dispatch({ type: "set-signature-request-feedback", status, link });
  }, []);

  const resetSignatureRequestFeedback = useCallback(() => {
    dispatch({ type: "set-signature-request", patch: { status: "", link: "" } });
  }, []);

  const setSignatureFlowStep = useCallback((step: EditorDocumentState["signatureFlowStep"]) => {
    dispatch({ type: "set-signature-flow-step", step });
  }, []);

  const removeSelectedLayer = useCallback(() => {
    if (!state.selection.layerId) {
      return;
    }
    dispatch({ type: "remove-layer", layerId: state.selection.layerId });
  }, [state.selection.layerId]);

  const selectedLayer = useMemo(
    () => state.layers.find((layer) => layer.id === state.selection.layerId) ?? null,
    [state.layers, state.selection.layerId]
  );

  const selectedSignatureBox = useMemo(
    () => (selectedLayer?.kind === "rectangle" ? selectedLayer : null),
    [selectedLayer]
  );

  const pageRotationMap = useMemo(
    () => new Map(state.pageRotations.map((item) => [item.page, item.degrees])),
    [state.pageRotations]
  );

  const pageNumberConfig = useMemo(() => getPageNumbersConfig(state), [state]);
  const watermarkConfig = useMemo(() => getWatermarkConfig(state), [state]);
  const hasEdits = useMemo(() => hasAnyEdits(state), [state]);

  return {
    state,
    selectedLayer,
    selectedSignatureBox,
    pageRotationMap,
    pageNumberConfig,
    watermarkConfig,
    hasAnyEdits: hasEdits,
    actions: {
      createLayerAt,
      loadPreviewFailed,
      loadPreviewStarted,
      loadPreviewSucceeded,
      moveLayer,
      queuePageRotation,
      removePageRotation,
      removeSelectedLayer,
      reorderLayers,
      resetSignatureRequestFeedback,
      selectPdfFile,
      setAsset,
      setBusy,
      setDownloadUrl,
      setImageDefaults,
      setOutputName,
      setPageNumbers,
      setPageNumbersEnabled,
      setRectangleDefaults,
      setRetentionHours,
      setRotationDegrees,
      setRotationPage,
      setSelectedLayerId,
      setSignatureDefaults,
      setSignatureFlowStep,
      setSignatureRequest,
      setSignatureRequestFeedback,
      setSourceFile,
      setStatus,
      setTextDefaults,
      setTool,
      setWatermark,
      setWatermarkEnabled,
      updateLayer
    }
  };
}
