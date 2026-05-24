"use client";

import type {
  EditImageInput,
  EditPageNumbersInput,
  EditRectangleInput,
  EditTextInput,
  EditWatermarkInput
} from "../../lib/pdf-api";
import type { EditorDocumentState, EditorRectangleLayer } from "./types";

export function getPageNumbersConfig(state: EditorDocumentState): EditPageNumbersInput | null {
  const pageNumbers = state.document.operations.pageNumbers;
  if (!pageNumbers.enabled) {
    return null;
  }

  return {
    startAt: pageNumbers.startAt,
    fontSize: pageNumbers.fontSize,
    color: pageNumbers.color,
    position: pageNumbers.position,
    margin: pageNumbers.margin,
    prefix: pageNumbers.prefix.trim() || undefined
  };
}

export function getWatermarkConfig(state: EditorDocumentState): EditWatermarkInput | null {
  const watermark = state.document.operations.watermark;
  if (!watermark.enabled) {
    return null;
  }

  return {
    text: watermark.text.trim(),
    fontSize: watermark.fontSize,
    color: watermark.color,
    opacity: watermark.opacity,
    rotation: watermark.rotation
  };
}

export function hasAnyEdits(state: EditorDocumentState): boolean {
  const document = state.document;
  return (
    document.layers.length > 0 ||
    document.operations.pageRotations.length > 0 ||
    getPageNumbersConfig(state) !== null ||
    getWatermarkConfig(state) !== null
  );
}

export function buildEditPayload(state: EditorDocumentState): {
  textEdits: EditTextInput[];
  rectangleEdits: EditRectangleInput[];
  imageEdits: EditImageInput[];
  pageRotations: EditorDocumentState["document"]["operations"]["pageRotations"];
  pageNumbers?: EditPageNumbersInput;
  watermark?: EditWatermarkInput;
  retentionHours: number;
} {
  const textEdits: EditTextInput[] = [];
  const rectangleEdits: EditRectangleInput[] = [];
  const imageEdits: EditImageInput[] = [];
  const document = state.document;

  for (const layer of document.layers) {
    if (layer.kind === "text") {
      textEdits.push({
        page: layer.page,
        x: layer.x,
        y: layer.y,
        text: layer.text,
        fontSize: layer.fontSize,
        fontFamily: layer.fontFamily,
        bold: layer.bold,
        italic: layer.italic,
        underline: layer.underline,
        color: layer.color
      });
      continue;
    }

    if (layer.kind === "rectangle") {
      const rectangleLayer: EditorRectangleLayer = layer;
      rectangleEdits.push({
        page: rectangleLayer.page,
        x: rectangleLayer.x,
        y: rectangleLayer.y,
        width: rectangleLayer.width,
        height: rectangleLayer.height,
        color: rectangleLayer.color,
        opacity: rectangleLayer.opacity
      });
      continue;
    }

    imageEdits.push({
      page: layer.page,
      x: layer.x,
      y: layer.y,
      width: layer.width,
      height: layer.height,
      dataUrl: layer.dataUrl
    });
  }

  const pageNumbers = getPageNumbersConfig(state) ?? undefined;
  const watermark = getWatermarkConfig(state) ?? undefined;

  return {
    textEdits,
    rectangleEdits,
    imageEdits,
    pageRotations: document.operations.pageRotations,
    pageNumbers,
    watermark,
    retentionHours: document.export.retentionHours
  };
}
