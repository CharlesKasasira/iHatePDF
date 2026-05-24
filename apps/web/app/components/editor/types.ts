"use client";

import type {
  EditImageInput,
  EditFormInput,
  EditPageNumbersInput,
  EditPageRotationInput,
  EditRectangleInput,
  EditTextInput,
  EditTextReplacementInput,
  EditWatermarkInput
} from "../../lib/pdf-api";

export type EditorMode = "edit" | "sign";
export type EditorTool =
  | "select"
  | "text"
  | "highlight"
  | "comment"
  | "ink"
  | "strike"
  | "sticky"
  | "redact"
  | "shape"
  | "erase"
  | "sign"
  | "image";
export type SignatureFlowStep = "closed" | "choose" | "request";

export type EditorPage = {
  pageNumber: number;
  width: number;
  height: number;
};

export type EditorTextLayer = EditTextInput & {
  id: string;
  kind: "text";
  locked?: boolean;
};

export type EditorRectangleLayer = EditRectangleInput & {
  id: string;
  kind: "rectangle";
  variant: "highlight" | "shape" | "erase" | "redact";
  locked?: boolean;
};

export type EditorImageLayer = EditImageInput & {
  id: string;
  kind: "image";
  variant: "sign" | "image";
  fileName: string;
  locked?: boolean;
};

export type EditorInkLayer = {
  id: string;
  kind: "ink";
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  color: string;
  thickness: number;
  points: Array<{ x: number; y: number }>;
  locked?: boolean;
};

export type EditorAnnotationLayer = {
  id: string;
  kind: "annotation";
  variant: "comment" | "strike" | "sticky";
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  color: string;
  opacity: number;
  text: string;
  locked?: boolean;
};

export type EditorLayer =
  | EditorTextLayer
  | EditorRectangleLayer
  | EditorImageLayer
  | EditorInkLayer
  | EditorAnnotationLayer;

export type EditorAssetState = {
  dataUrl: string;
  fileName: string;
} | null;

export type EditorDraftDefaults = {
  text: {
    text: string;
    fontFamily: EditTextInput["fontFamily"];
    fontSize: number;
    width: number;
    align: EditTextInput["align"];
    lineHeight: number;
    opacity: number;
    customFont: EditTextInput["customFont"];
    color: string;
    bold: boolean;
    italic: boolean;
    underline: boolean;
  };
  rectangle: {
    width: number;
    height: number;
    color: string;
    opacity: number;
  };
  image: {
    width: number;
    height: number;
  };
  signature: {
    width: number;
    height: number;
  };
};

export type EditorSelection = {
  layerId: string | null;
  layerIds: string[];
};

export type EditorHistorySnapshot = {
  layers: EditorLayer[];
  formFields: EditorFormField[];
  formValues: Record<string, EditFormInput["value"]>;
  selection: EditorSelection;
  pageRotations: EditPageRotationInput[];
  textReplacements: EditTextReplacementInput[];
  pageNumbers: EditorPageNumbersState;
  watermark: EditorWatermarkState;
};

export type EditorHistoryState = {
  past: EditorHistorySnapshot[];
  future: EditorHistorySnapshot[];
};

export type EditorFitMode = "fit-width" | "fit-page" | "manual";
export type EditorScrollBehavior = "auto" | "smooth";

export type EditorScrollTarget = {
  page: number;
  behavior: EditorScrollBehavior;
  requestedAt: number;
} | null;

export type EditorViewport = {
  zoom: number;
  fitMode: EditorFitMode;
  activePage: number | null;
  scrollTarget: EditorScrollTarget;
  snapToGrid: boolean;
  showGuides: boolean;
};

export type EditorPageNumbersState = {
  enabled: boolean;
  startAt: number;
  fontSize: number;
  color: string;
  position: EditPageNumbersInput["position"];
  margin: number;
  prefix: string;
};

export type EditorWatermarkState = {
  enabled: boolean;
  text: string;
  fontSize: number;
  color: string;
  opacity: number;
  rotation: number;
};

export type EditorSignatureRequestState = {
  requesterEmail: string;
  signerName: string;
  signerEmail: string;
  signerRole: string;
  message: string;
  outputName: string;
  status: string;
  link: string;
};

export type EditorDocumentOperations = {
  pageRotations: EditPageRotationInput[];
  pageNumbers: EditorPageNumbersState;
  watermark: EditorWatermarkState;
  textReplacements: EditTextReplacementInput[];
};

export type EditorFormField = {
  name: string;
  type: "text" | "checkbox" | "dropdown" | "option-list" | "radio" | "button" | "signature" | "unknown";
  value: string | boolean | string[] | null;
  options: string[];
  widgets: Array<{
    pageNumber: number | null;
    x: number;
    y: number;
    width: number;
    height: number;
  }>;
};

export type EditorExportHistoryItem = {
  id: string;
  outputName: string;
  downloadUrl: string;
  retentionHours: number;
  createdAt: string;
};

export type EditorDocumentModel = {
  file: File | null;
  sourceFileId: string | null;
  sourceRetentionHours: number | null;
  pages: EditorPage[];
  layers: EditorLayer[];
  formFields: EditorFormField[];
  formValues: Record<string, EditFormInput["value"]>;
  selection: EditorSelection;
  operations: EditorDocumentOperations;
  signatures: {
    request: EditorSignatureRequestState;
    flowStep: SignatureFlowStep;
  };
  export: {
    outputName: string;
    retentionHours: number;
    outputMode: "flattened" | "editable-annotations";
    downloadUrl: string;
    history: EditorExportHistoryItem[];
  };
  viewport: EditorViewport;
};

export type EditorDocumentState = {
  mode: EditorMode;
  document: EditorDocumentModel;
  pdfFile: File | null;
  sourceFileId: string | null;
  sourceRetentionHours: number | null;
  pages: EditorPage[];
  isLoadingPreview: boolean;
  tool: EditorTool;
  layers: EditorLayer[];
  formFields: EditorFormField[];
  formValues: Record<string, EditFormInput["value"]>;
  selection: EditorSelection;
  status: string;
  busy: boolean;
  downloadUrl: string;
  outputName: string;
  retentionHours: number;
  draftDefaults: EditorDraftDefaults;
  assets: {
    image: EditorAssetState;
    sign: EditorAssetState;
  };
  pageRotations: EditPageRotationInput[];
  rotationPage: number;
  rotationDegrees: EditPageRotationInput["degrees"];
  pageNumbers: EditorPageNumbersState;
  watermark: EditorWatermarkState;
  history: EditorHistoryState;
  signatureRequest: EditorSignatureRequestState;
  signatureFlowStep: SignatureFlowStep;
  viewport: EditorViewport;
};

export type EditorAction =
  | { type: "reset-for-pdf"; file: File | null; outputName: string; signatureRequestOutputName: string }
  | { type: "load-preview-started"; fileName: string }
  | {
      type: "load-preview-succeeded";
      fileId: string;
      retentionHours: number;
      pages: EditorPage[];
      formFields: EditorFormField[];
      pageCount: number;
      fileName: string;
    }
  | { type: "load-preview-failed"; message: string }
  | { type: "set-tool"; tool: EditorTool }
  | { type: "set-selection"; layerId: string | null; additive?: boolean }
  | { type: "set-selection-many"; layerIds: string[] }
  | { type: "commit-history"; status?: string }
  | { type: "add-layer"; layer: EditorLayer; status: string }
  | {
      type: "update-layer";
      layerId: string;
      updater: (layer: EditorLayer) => EditorLayer;
      trackHistory?: boolean;
    }
  | { type: "set-layers"; layers: EditorLayer[]; status?: string }
  | { type: "remove-layer"; layerId: string }
  | { type: "set-layer-lock"; layerIds: string[]; locked: boolean }
  | { type: "set-form-value"; name: string; value: EditFormInput["value"] }
  | { type: "set-status"; status: string }
  | { type: "set-busy"; busy: boolean }
  | { type: "set-download-url"; downloadUrl: string }
  | { type: "set-output-name"; outputName: string }
  | { type: "set-retention-hours"; retentionHours: number }
  | { type: "set-output-mode"; outputMode: EditorDocumentModel["export"]["outputMode"] }
  | { type: "set-active-page"; activePage: number }
  | { type: "set-zoom"; zoom: number }
  | { type: "set-fit-mode"; fitMode: EditorViewport["fitMode"] }
  | { type: "set-snap-to-grid"; enabled: boolean }
  | { type: "set-show-guides"; enabled: boolean }
  | { type: "set-scroll-target"; page: number; behavior?: EditorScrollBehavior }
  | { type: "restore-draft"; snapshot: EditorHistorySnapshot; outputName: string; retentionHours: number }
  | { type: "set-text-defaults"; patch: Partial<EditorDraftDefaults["text"]> }
  | { type: "set-rectangle-defaults"; patch: Partial<EditorDraftDefaults["rectangle"]> }
  | { type: "set-image-defaults"; patch: Partial<EditorDraftDefaults["image"]> }
  | { type: "set-signature-defaults"; patch: Partial<EditorDraftDefaults["signature"]> }
  | { type: "set-asset"; kind: "image" | "sign"; asset: EditorAssetState }
  | { type: "set-page-rotations"; pageRotations: EditPageRotationInput[] }
  | { type: "add-text-replacement"; replacement: EditTextReplacementInput }
  | { type: "remove-text-replacement"; index: number }
  | { type: "set-rotation-page"; rotationPage: number }
  | { type: "set-rotation-degrees"; rotationDegrees: EditPageRotationInput["degrees"] }
  | { type: "set-page-numbers-enabled"; enabled: boolean }
  | { type: "set-page-numbers"; patch: Partial<EditorPageNumbersState> }
  | { type: "set-watermark-enabled"; enabled: boolean }
  | { type: "set-watermark"; patch: Partial<EditorWatermarkState> }
  | { type: "undo" }
  | { type: "redo" }
  | { type: "set-signature-request"; patch: Partial<EditorSignatureRequestState> }
  | { type: "set-signature-request-feedback"; status: string; link?: string }
  | { type: "set-signature-flow-step"; step: SignatureFlowStep }
  | { type: "set-source-file"; fileId: string | null; retentionHours: number | null };
