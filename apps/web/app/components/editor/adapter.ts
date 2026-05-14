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
  if (!state.pageNumbers.enabled) {
    return null;
  }

  return {
    startAt: state.pageNumbers.startAt,
    fontSize: state.pageNumbers.fontSize,
    color: state.pageNumbers.color,
    position: state.pageNumbers.position,
    margin: state.pageNumbers.margin,
    prefix: state.pageNumbers.prefix.trim() || undefined
  };
}

export function getWatermarkConfig(state: EditorDocumentState): EditWatermarkInput | null {
  if (!state.watermark.enabled) {
    return null;
  }

  return {
    text: state.watermark.text.trim(),
    fontSize: state.watermark.fontSize,
    color: state.watermark.color,
    opacity: state.watermark.opacity,
    rotation: state.watermark.rotation
  };
}

export function hasAnyEdits(state: EditorDocumentState): boolean {
  return (
    state.layers.length > 0 ||
    state.pageRotations.length > 0 ||
    getPageNumbersConfig(state) !== null ||
    getWatermarkConfig(state) !== null
  );
}

export function buildEditPayload(state: EditorDocumentState): {
  textEdits: EditTextInput[];
  rectangleEdits: EditRectangleInput[];
  imageEdits: EditImageInput[];
  pageRotations: EditorDocumentState["pageRotations"];
  pageNumbers?: EditPageNumbersInput;
  watermark?: EditWatermarkInput;
  retentionHours: number;
} {
  const textEdits: EditTextInput[] = [];
  const rectangleEdits: EditRectangleInput[] = [];
  const imageEdits: EditImageInput[] = [];

  for (const layer of state.layers) {
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
    pageRotations: state.pageRotations,
    pageNumbers,
    watermark,
    retentionHours: state.retentionHours
  };
}
