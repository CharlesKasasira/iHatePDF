"use client";

import { useCallback, useMemo, useReducer } from "react";
import type { EditPageRotationInput } from "../../lib/pdf-api";
import { DEFAULT_EDITOR_PAGE } from "./constants";
import type {
  EditorAction,
  EditorAssetState,
  EditorDocumentModel,
  EditorDocumentState,
  EditorDraftDefaults,
  EditorHistorySnapshot,
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
import {
  cloneLayer,
  createEmptySelection,
  DUPLICATE_LAYER_OFFSET,
  getSelectionLayerIds
} from "./selection";
import { redoHistory, undoHistory, withUndoCheckpoint } from "./history";
import { reduceDocumentState } from "./document-reducer";
import { reduceLayerState } from "./layer-reducer";
import { reduceSignatureState } from "./signature-reducer";
import { reduceViewportState } from "./viewport-reducer";

const SNAP_GRID_SIZE = 12;

function createInitialDraftDefaults(): EditorDraftDefaults {
  return {
    text: {
      text: "Approved",
      fontFamily: "sans",
      fontSize: 20,
      width: 220,
      align: "left",
      lineHeight: 1.2,
      opacity: 1,
      customFont: null,
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

function createInitialDocumentModel(mode: EditorMode): EditorDocumentModel {
  return {
    file: null,
    sourceFileId: null,
    sourceRetentionHours: null,
    pages: [DEFAULT_EDITOR_PAGE],
    layers: [],
    formFields: [],
    formValues: {},
    selection: createEmptySelection(),
    operations: {
      pageRotations: [],
      textReplacements: [],
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
      }
    },
    signatures: {
      request: {
        requesterEmail: "",
        signerName: "",
        signerEmail: "",
        signerRole: "Signer",
        message: "",
        outputName: buildDefaultSignatureRequestOutputName(),
        status: "",
        link: ""
      },
      flowStep: "closed"
    },
    export: {
      outputName: buildDefaultOutputName(mode),
      retentionHours: 24,
      outputMode: "flattened",
      downloadUrl: "",
      history: []
    },
    viewport: {
      zoom: 1,
      fitMode: "fit-width",
      activePage: 1,
      scrollTarget: null,
      snapToGrid: true,
      showGuides: true
    }
  };
}

function createInitialState(mode: EditorMode): EditorDocumentState {
  const document = createInitialDocumentModel(mode);
  return {
    mode,
    document,
    pdfFile: document.file,
    sourceFileId: document.sourceFileId,
    sourceRetentionHours: document.sourceRetentionHours,
    pages: document.pages,
    isLoadingPreview: false,
    tool: "select",
    layers: document.layers,
    formFields: document.formFields,
    formValues: document.formValues,
    selection: document.selection,
    status: "Upload a PDF to begin a controlled studio editing session.",
    busy: false,
    downloadUrl: document.export.downloadUrl,
    outputName: document.export.outputName,
    retentionHours: document.export.retentionHours,
    draftDefaults: createInitialDraftDefaults(),
    assets: {
      image: null,
      sign: null
    },
    pageRotations: document.operations.pageRotations,
    rotationPage: 1,
    rotationDegrees: 90,
    pageNumbers: document.operations.pageNumbers,
    watermark: document.operations.watermark,
    history: {
      past: [],
      future: []
    },
    signatureRequest: document.signatures.request,
    signatureFlowStep: document.signatures.flowStep,
    viewport: document.viewport
  };
}

function snapCoordinate(value: number, enabled: boolean): number {
  return enabled ? Math.round(value / SNAP_GRID_SIZE) * SNAP_GRID_SIZE : value;
}

function reduceEditorState(state: EditorDocumentState, action: EditorAction): EditorDocumentState {
  const domainState =
    reduceDocumentState(state, action) ??
    reduceLayerState(state, action) ??
    reduceViewportState(state, action) ??
    reduceSignatureState(state, action);

  if (domainState) {
    return domainState;
  }

  switch (action.type) {
    case "commit-history":
      return withUndoCheckpoint(state, {
        ...state,
        status: action.status ?? state.status
      });
    case "set-status":
      return { ...state, status: action.status };
    case "set-busy":
      return { ...state, busy: action.busy };
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
    case "undo":
      return undoHistory(state);
    case "redo":
      return redoHistory(state);
    default:
      return state;
  }
}

function reducer(state: EditorDocumentState, action: EditorAction): EditorDocumentState {
  return reduceEditorState(state, action);
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

  const setSelectedLayerId = useCallback((layerId: string | null, additive = false) => {
    dispatch({ type: "set-selection", layerId, additive });
  }, []);

  const setSelectedLayerIds = useCallback((layerIds: string[]) => {
    dispatch({ type: "set-selection-many", layerIds });
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

  const setOutputMode = useCallback((outputMode: EditorDocumentModel["export"]["outputMode"]) => {
    dispatch({ type: "set-output-mode", outputMode });
  }, []);

  const setActivePage = useCallback((activePage: number) => {
    dispatch({ type: "set-active-page", activePage });
  }, []);

  const setZoom = useCallback((zoom: number) => {
    dispatch({ type: "set-zoom", zoom });
  }, []);

  const setFitMode = useCallback((fitMode: EditorDocumentModel["viewport"]["fitMode"]) => {
    dispatch({ type: "set-fit-mode", fitMode });
  }, []);

  const setSnapToGrid = useCallback((enabled: boolean) => {
    dispatch({ type: "set-snap-to-grid", enabled });
  }, []);

  const setShowGuides = useCallback((enabled: boolean) => {
    dispatch({ type: "set-show-guides", enabled });
  }, []);

  const setFormValue = useCallback((name: string, value: EditorDocumentModel["formValues"][string]) => {
    dispatch({ type: "set-form-value", name, value });
  }, []);

  const setScrollTarget = useCallback(
    (page: number, behavior: NonNullable<EditorDocumentModel["viewport"]["scrollTarget"]>["behavior"] = "smooth") => {
      dispatch({ type: "set-scroll-target", page, behavior });
    },
    []
  );

  const loadPreviewStarted = useCallback((fileName: string) => {
    dispatch({ type: "load-preview-started", fileName });
  }, []);

  const loadPreviewSucceeded = useCallback(
    (payload: {
      fileId: string;
      retentionHours: number;
      pages: EditorPage[];
      formFields: EditorDocumentModel["formFields"];
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
    (layerId: string, updater: (layer: EditorLayer) => EditorLayer, trackHistory = true) => {
      dispatch({ type: "update-layer", layerId, updater, trackHistory });
    },
    []
  );

  const moveLayer = useCallback(
    (layerId: string, x: number, y: number, trackHistory = true) => {
      dispatch({
        type: "update-layer",
        layerId,
        updater: (layer) => ({ ...layer, x, y }),
        trackHistory
      });
    },
    []
  );

  const createUndoCheckpoint = useCallback((status?: string) => {
    dispatch({ type: "commit-history", status });
  }, []);

  const restoreDraft = useCallback(
    (snapshot: EditorHistorySnapshot, outputName: string, retentionHours: number) => {
      dispatch({ type: "restore-draft", snapshot, outputName, retentionHours });
    },
    []
  );

  const reorderLayers = useCallback((layers: EditorLayer[]) => {
    dispatch({ type: "set-layers", layers, status: "Layer stack order updated." });
  }, []);

  const createLayerAt = useCallback(
    (pageNumber: number, x: number, y: number) => {
      const placeX = snapCoordinate(x, state.document.viewport.snapToGrid);
      const placeY = snapCoordinate(y, state.document.viewport.snapToGrid);

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
            x: placeX,
            y: placeY,
            width: state.draftDefaults.text.width,
            text,
            fontSize: state.draftDefaults.text.fontSize,
            fontFamily: state.draftDefaults.text.fontFamily,
            align: state.draftDefaults.text.align,
            lineHeight: state.draftDefaults.text.lineHeight,
            opacity: state.draftDefaults.text.opacity,
            customFont: state.draftDefaults.text.customFont,
            bold: state.draftDefaults.text.bold,
            italic: state.draftDefaults.text.italic,
            underline: state.draftDefaults.text.underline,
            color: state.draftDefaults.text.color
          },
          status: `Placed a text layer on page ${pageNumber}.`
        });
        return;
      }

      if (state.tool === "highlight" || state.tool === "shape" || state.tool === "erase" || state.tool === "redact") {
        const isHighlight = state.tool === "highlight";
        const isErase = state.tool === "erase";
        const isRedact = state.tool === "redact";
        dispatch({
          type: "add-layer",
          layer: {
            id: nextLayerId(),
            kind: "rectangle",
            variant: state.tool,
            page: pageNumber,
            x: placeX,
            y: placeY,
            width: state.draftDefaults.rectangle.width,
            height: state.draftDefaults.rectangle.height,
            color: isHighlight ? "#ffe082" : isErase ? "#ffffff" : isRedact ? "#111827" : state.draftDefaults.rectangle.color,
            opacity: isHighlight ? 0.26 : isErase || isRedact ? 1 : state.draftDefaults.rectangle.opacity
          },
          status: `Placed a ${
            isHighlight ? "highlight" : isErase ? "white erase block" : isRedact ? "true redaction block" : "shape"
          } layer on page ${pageNumber}.`
        });
        return;
      }

      if (state.tool === "comment" || state.tool === "strike" || state.tool === "sticky") {
        const isStrike = state.tool === "strike";
        const isSticky = state.tool === "sticky";
        dispatch({
          type: "add-layer",
          layer: {
            id: nextLayerId(),
            kind: "annotation",
            variant: state.tool,
            page: pageNumber,
            x: placeX,
            y: placeY,
            width: isStrike ? 220 : isSticky ? 150 : 240,
            height: isStrike ? 18 : isSticky ? 86 : 64,
            color: isStrike ? "#d62828" : isSticky ? "#ffe082" : "#b8dcff",
            opacity: isStrike ? 1 : isSticky ? 0.9 : 0.78,
            text: isStrike ? "Strikethrough" : isSticky ? "Note" : "Comment"
          },
          status: `Placed a ${isStrike ? "strikethrough" : isSticky ? "sticky note" : "comment"} annotation on page ${pageNumber}.`
        });
        return;
      }

      if (state.tool === "ink") {
        dispatch({ type: "set-status", status: "Drag on the PDF page to draw a freehand ink annotation." });
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
          x: placeX,
          y: placeY,
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

  const createInkLayer = useCallback((pageNumber: number, points: Array<{ x: number; y: number }>) => {
    if (points.length < 2) {
      return;
    }

    const minX = Math.min(...points.map((point) => point.x));
    const maxX = Math.max(...points.map((point) => point.x));
    const minY = Math.min(...points.map((point) => point.y));
    const maxY = Math.max(...points.map((point) => point.y));

    dispatch({
      type: "add-layer",
      layer: {
        id: nextLayerId(),
        kind: "ink",
        page: pageNumber,
        x: minX,
        y: minY,
        width: Math.max(1, maxX - minX),
        height: Math.max(1, maxY - minY),
        color: "#19334d",
        thickness: 2.5,
        points: points.map((point) => ({ x: point.x - minX, y: point.y - minY }))
      },
      status: `Drew a freehand ink annotation on page ${pageNumber}.`
    });
  }, []);

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
    const next = state.document.operations.pageRotations.filter((item) => item.page !== state.rotationPage);
    next.push({ page: state.rotationPage, degrees: state.rotationDegrees });
    next.sort((left, right) => left.page - right.page);
    dispatch({ type: "set-page-rotations", pageRotations: next });
    dispatch({
      type: "set-status",
      status: `Queued a ${state.rotationDegrees}° rotation for page ${state.rotationPage}.`
    });
  }, [state.document.operations.pageRotations, state.rotationDegrees, state.rotationPage]);

  const removePageRotation = useCallback((page: number) => {
    dispatch({
      type: "set-page-rotations",
      pageRotations: state.document.operations.pageRotations.filter((item) => item.page !== page)
    });
  }, [state.document.operations.pageRotations]);

  const addTextReplacement = useCallback((replacement: EditorDocumentModel["operations"]["textReplacements"][number]) => {
    dispatch({ type: "add-text-replacement", replacement });
  }, []);

  const removeTextReplacement = useCallback((index: number) => {
    dispatch({ type: "remove-text-replacement", index });
  }, []);

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

  const setPageNumbers = useCallback((patch: Partial<EditorDocumentModel["operations"]["pageNumbers"]>) => {
    dispatch({ type: "set-page-numbers", patch });
  }, []);

  const setWatermarkEnabled = useCallback((enabled: boolean) => {
    dispatch({ type: "set-watermark-enabled", enabled });
  }, []);

  const setWatermark = useCallback((patch: Partial<EditorDocumentModel["operations"]["watermark"]>) => {
    dispatch({ type: "set-watermark", patch });
  }, []);

  const setSignatureRequest = useCallback(
    (patch: Partial<EditorDocumentModel["signatures"]["request"]>) => {
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

  const selectedLayerIds = useMemo(
    () => getSelectionLayerIds(state.document.selection),
    [state.document.selection]
  );

  const moveSelectedLayersInStack = useCallback(
    (direction: "front" | "forward" | "backward" | "back") => {
      if (selectedLayerIds.length === 0) {
        return;
      }
      if (state.document.layers.some((layer) => selectedLayerIds.includes(layer.id) && layer.locked)) {
        dispatch({ type: "set-status", status: "Unlock selected layers before changing their stack order." });
        return;
      }

      const selected = new Set(selectedLayerIds);
      let nextLayers = [...state.document.layers];

      if (direction === "front") {
        nextLayers = [
          ...state.document.layers.filter((layer) => !selected.has(layer.id)),
          ...state.document.layers.filter((layer) => selected.has(layer.id))
        ];
      } else if (direction === "back") {
        nextLayers = [
          ...state.document.layers.filter((layer) => selected.has(layer.id)),
          ...state.document.layers.filter((layer) => !selected.has(layer.id))
        ];
      } else if (direction === "forward") {
        for (let index = nextLayers.length - 2; index >= 0; index -= 1) {
          if (selected.has(nextLayers[index].id) && !selected.has(nextLayers[index + 1].id)) {
            [nextLayers[index], nextLayers[index + 1]] = [nextLayers[index + 1], nextLayers[index]];
          }
        }
      } else {
        for (let index = 1; index < nextLayers.length; index += 1) {
          if (selected.has(nextLayers[index].id) && !selected.has(nextLayers[index - 1].id)) {
            [nextLayers[index - 1], nextLayers[index]] = [nextLayers[index], nextLayers[index - 1]];
          }
        }
      }

      dispatch({
        type: "set-layers",
        layers: nextLayers,
        status:
          selectedLayerIds.length === 1
            ? "Moved the selected layer in the stack."
            : "Moved selected layers in the stack."
      });
    },
    [selectedLayerIds, state.document.layers]
  );

  const removeSelectedLayer = useCallback(() => {
    if (selectedLayerIds.length === 0) {
      return;
    }
    const removableIds = selectedLayerIds.filter(
      (layerId) => !state.document.layers.some((layer) => layer.id === layerId && layer.locked)
    );
    if (removableIds.length === 0) {
      dispatch({ type: "set-status", status: "Unlock selected layers before removing them." });
      return;
    }

    dispatch({
      type: "set-layers",
      layers: state.document.layers.filter((layer) => !removableIds.includes(layer.id)),
      status:
        removableIds.length === 1
          ? "Removed the selected layer."
          : `Removed ${removableIds.length} selected layers.`
    });
    dispatch({ type: "set-selection-many", layerIds: [] });
  }, [selectedLayerIds, state.document.layers]);

  const nudgeSelectedLayers = useCallback(
    (deltaX: number, deltaY: number) => {
      if (selectedLayerIds.length === 0) {
        return;
      }

      dispatch({
        type: "set-layers",
        layers: state.document.layers.map((layer) =>
          selectedLayerIds.includes(layer.id) && !layer.locked
            ? {
                ...layer,
                x: Math.max(0, layer.x + deltaX),
                y: Math.max(0, layer.y + deltaY)
              }
            : layer
        ),
        status: "Nudged selected layers."
      });
    },
    [selectedLayerIds, state.document.layers]
  );

  const duplicateSelectedLayers = useCallback(() => {
    const selectedLayers = state.document.layers.filter((layer) => selectedLayerIds.includes(layer.id) && !layer.locked);
    if (selectedLayers.length === 0) {
      dispatch({ type: "set-status", status: "Unlock selected layers before duplicating them." });
      return;
    }

    const duplicatedLayers = selectedLayers.map((layer) => cloneLayer(layer));
    dispatch({
      type: "set-layers",
      layers: [...state.document.layers, ...duplicatedLayers],
      status:
        duplicatedLayers.length === 1
          ? "Duplicated the selected layer."
          : `Duplicated ${duplicatedLayers.length} selected layers.`
    });
    dispatch({ type: "set-selection-many", layerIds: duplicatedLayers.map((layer) => layer.id) });
  }, [selectedLayerIds, state.document.layers]);

  const pasteLayers = useCallback(
    (layers: EditorLayer[]) => {
      if (layers.length === 0) {
        return;
      }

      const pastedLayers = layers.map((layer) => cloneLayer(layer, DUPLICATE_LAYER_OFFSET * 1.5));
      dispatch({
        type: "set-layers",
        layers: [...state.document.layers, ...pastedLayers],
        status:
          pastedLayers.length === 1
            ? "Pasted a copied layer."
            : `Pasted ${pastedLayers.length} copied layers.`
      });
      dispatch({ type: "set-selection-many", layerIds: pastedLayers.map((layer) => layer.id) });
    },
    [state.document.layers]
  );

  const undo = useCallback(() => {
    dispatch({ type: "undo" });
  }, []);

  const setSelectedLayersLocked = useCallback(
    (locked: boolean) => {
      if (selectedLayerIds.length === 0) {
        return;
      }
      dispatch({ type: "set-layer-lock", layerIds: selectedLayerIds, locked });
    },
    [selectedLayerIds]
  );

  const redo = useCallback(() => {
    dispatch({ type: "redo" });
  }, []);

  const selectedLayer = useMemo(
    () => state.document.layers.find((layer) => layer.id === state.document.selection.layerId) ?? null,
    [state.document.layers, state.document.selection.layerId]
  );

  const selectedLayers = useMemo(
    () => state.document.layers.filter((layer) => selectedLayerIds.includes(layer.id)),
    [selectedLayerIds, state.document.layers]
  );

  const selectedSignatureBox = useMemo(
    () => (selectedLayer?.kind === "rectangle" ? selectedLayer : null),
    [selectedLayer]
  );

  const pageRotationMap = useMemo(
    () => new Map(state.document.operations.pageRotations.map((item) => [item.page, item.degrees])),
    [state.document.operations.pageRotations]
  );

  const pageNumberConfig = useMemo(() => getPageNumbersConfig(state), [state]);
  const watermarkConfig = useMemo(() => getWatermarkConfig(state), [state]);
  const hasEdits = useMemo(() => hasAnyEdits(state), [state]);

  return {
    state,
    selectedLayer,
    selectedLayers,
    selectedLayerIds,
    selectedSignatureBox,
    pageRotationMap,
    pageNumberConfig,
    watermarkConfig,
    hasAnyEdits: hasEdits,
    activePage: state.document.viewport.activePage,
    zoom: state.document.viewport.zoom,
    actions: {
      createLayerAt,
      createInkLayer,
      addTextReplacement,
      createUndoCheckpoint,
      duplicateSelectedLayers,
      loadPreviewFailed,
      loadPreviewStarted,
      loadPreviewSucceeded,
      moveLayer,
      pasteLayers,
      queuePageRotation,
      redo,
      removePageRotation,
      removeTextReplacement,
      removeSelectedLayer,
      reorderLayers,
      restoreDraft,
      resetSignatureRequestFeedback,
      selectPdfFile,
      setAsset,
      setActivePage,
      setBusy,
      setDownloadUrl,
      setImageDefaults,
      setOutputName,
      setOutputMode,
      setPageNumbers,
      setPageNumbersEnabled,
      setRectangleDefaults,
      setRetentionHours,
      setRotationDegrees,
      setRotationPage,
      setSelectedLayerId,
      setSelectedLayerIds,
      setSelectedLayersLocked,
      setScrollTarget,
      setShowGuides,
      setSignatureDefaults,
      setSignatureFlowStep,
      setSignatureRequest,
      setSignatureRequestFeedback,
      setSnapToGrid,
      setSourceFile,
      setStatus,
      setTextDefaults,
      setFitMode,
      setFormValue,
      setTool,
      setWatermark,
      setWatermarkEnabled,
      setZoom,
      undo,
      updateLayer,
      moveSelectedLayersInStack,
      nudgeSelectedLayers
    }
  };
}
