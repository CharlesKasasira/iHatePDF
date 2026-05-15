"use client";

import type {
  EditImageInput,
  EditPageNumbersInput,
  EditPageRotationInput,
  EditRectangleInput,
  EditTextInput,
  EditWatermarkInput
} from "../../lib/pdf-api";

export type EditorMode = "edit" | "sign";
export type EditorTool = "select" | "text" | "highlight" | "shape" | "erase" | "sign" | "image";
export type SignatureFlowStep = "closed" | "choose" | "request";

export type EditorPage = {
  pageNumber: number;
  width: number;
  height: number;
};

export type EditorTextLayer = EditTextInput & {
  id: string;
  kind: "text";
};

export type EditorRectangleLayer = EditRectangleInput & {
  id: string;
  kind: "rectangle";
  variant: "highlight" | "shape" | "erase";
};

export type EditorImageLayer = EditImageInput & {
  id: string;
  kind: "image";
  variant: "sign" | "image";
  fileName: string;
};

export type EditorLayer = EditorTextLayer | EditorRectangleLayer | EditorImageLayer;

export type EditorAssetState = {
  dataUrl: string;
  fileName: string;
} | null;

export type EditorDraftDefaults = {
  text: {
    text: string;
    fontFamily: EditTextInput["fontFamily"];
    fontSize: number;
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
};

export type EditorViewport = {
  zoom: number;
  fitMode: "fit-width";
  activePage: number | null;
  scrollAnchor: number | null;
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

export type EditorDocumentState = {
  mode: EditorMode;
  pdfFile: File | null;
  sourceFileId: string | null;
  sourceRetentionHours: number | null;
  pages: EditorPage[];
  isLoadingPreview: boolean;
  tool: EditorTool;
  layers: EditorLayer[];
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
      pageCount: number;
      fileName: string;
    }
  | { type: "load-preview-failed"; message: string }
  | { type: "set-tool"; tool: EditorTool }
  | { type: "set-selection"; layerId: string | null }
  | { type: "add-layer"; layer: EditorLayer; status: string }
  | { type: "update-layer"; layerId: string; updater: (layer: EditorLayer) => EditorLayer }
  | { type: "set-layers"; layers: EditorLayer[]; status?: string }
  | { type: "remove-layer"; layerId: string }
  | { type: "set-status"; status: string }
  | { type: "set-busy"; busy: boolean }
  | { type: "set-download-url"; downloadUrl: string }
  | { type: "set-output-name"; outputName: string }
  | { type: "set-retention-hours"; retentionHours: number }
  | { type: "set-text-defaults"; patch: Partial<EditorDraftDefaults["text"]> }
  | { type: "set-rectangle-defaults"; patch: Partial<EditorDraftDefaults["rectangle"]> }
  | { type: "set-image-defaults"; patch: Partial<EditorDraftDefaults["image"]> }
  | { type: "set-signature-defaults"; patch: Partial<EditorDraftDefaults["signature"]> }
  | { type: "set-asset"; kind: "image" | "sign"; asset: EditorAssetState }
  | { type: "set-page-rotations"; pageRotations: EditPageRotationInput[] }
  | { type: "set-rotation-page"; rotationPage: number }
  | { type: "set-rotation-degrees"; rotationDegrees: EditPageRotationInput["degrees"] }
  | { type: "set-page-numbers-enabled"; enabled: boolean }
  | { type: "set-page-numbers"; patch: Partial<EditorPageNumbersState> }
  | { type: "set-watermark-enabled"; enabled: boolean }
  | { type: "set-watermark"; patch: Partial<EditorWatermarkState> }
  | { type: "set-signature-request"; patch: Partial<EditorSignatureRequestState> }
  | { type: "set-signature-request-feedback"; status: string; link?: string }
  | { type: "set-signature-flow-step"; step: SignatureFlowStep }
  | { type: "set-source-file"; fileId: string | null; retentionHours: number | null };
