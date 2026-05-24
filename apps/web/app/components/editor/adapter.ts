"use client";

import type {
  EditFormInput,
  EditImageInput,
  EditInkInput,
  EditPageNumbersInput,
  EditRectangleInput,
  EditRedactionInput,
  EditTextInput,
  EditTextReplacementInput,
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
    document.formFields.length > 0 ||
    document.operations.textReplacements.length > 0 ||
    document.operations.pageRotations.length > 0 ||
    getPageNumbersConfig(state) !== null ||
    getWatermarkConfig(state) !== null
  );
}

export function buildEditPayload(state: EditorDocumentState): {
  outputMode: EditorDocumentState["document"]["export"]["outputMode"];
  textEdits: EditTextInput[];
  rectangleEdits: EditRectangleInput[];
  redactionEdits: EditRedactionInput[];
  imageEdits: EditImageInput[];
  inkEdits: EditInkInput[];
  formEdits: EditFormInput[];
  textReplacementEdits: EditTextReplacementInput[];
  pageRotations: EditorDocumentState["document"]["operations"]["pageRotations"];
  pageNumbers?: EditPageNumbersInput;
  watermark?: EditWatermarkInput;
  retentionHours: number;
} {
  const textEdits: EditTextInput[] = [];
  const rectangleEdits: EditRectangleInput[] = [];
  const redactionEdits: EditRedactionInput[] = [];
  const imageEdits: EditImageInput[] = [];
  const inkEdits: EditInkInput[] = [];
  const document = state.document;
  const formEdits: EditFormInput[] = document.formFields.flatMap((field) => {
    if (
      field.type !== "text" &&
      field.type !== "checkbox" &&
      field.type !== "dropdown" &&
      field.type !== "option-list" &&
      field.type !== "radio" &&
      field.type !== "signature"
    ) {
      return [];
    }

    const value = document.formValues[field.name] ?? (field.type === "checkbox" ? false : "");
    if (field.type === "signature" && !value) {
      return [];
    }

    return [{ name: field.name, type: field.type, value }];
  });

  for (const layer of document.layers) {
    if (layer.kind === "text") {
      textEdits.push({
        page: layer.page,
        x: layer.x,
        y: layer.y,
        width: layer.width,
        text: layer.text,
        fontSize: layer.fontSize,
        fontFamily: layer.fontFamily,
        align: layer.align,
        lineHeight: layer.lineHeight,
        opacity: layer.opacity,
        customFont: layer.customFont ?? null,
        bold: layer.bold,
        italic: layer.italic,
        underline: layer.underline,
        color: layer.color
      });
      continue;
    }

    if (layer.kind === "rectangle") {
      const rectangleLayer: EditorRectangleLayer = layer;
      if (rectangleLayer.variant === "redact") {
        redactionEdits.push({
          page: rectangleLayer.page,
          x: rectangleLayer.x,
          y: rectangleLayer.y,
          width: rectangleLayer.width,
          height: rectangleLayer.height,
          color: rectangleLayer.color
        });
        continue;
      }

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

    if (layer.kind === "image") {
      imageEdits.push({
        page: layer.page,
        x: layer.x,
        y: layer.y,
        width: layer.width,
        height: layer.height,
        dataUrl: layer.dataUrl
      });
      continue;
    }

    if (layer.kind === "ink") {
      inkEdits.push({
        page: layer.page,
        color: layer.color,
        thickness: layer.thickness,
        points: layer.points.map((point) => ({
          x: layer.x + point.x,
          y: layer.y + point.y
        }))
      });
      continue;
    }

    if (layer.kind === "annotation") {
      if (layer.variant === "strike") {
        inkEdits.push({
          page: layer.page,
          color: layer.color,
          thickness: 2,
          points: [
            { x: layer.x, y: layer.y + layer.height / 2 },
            { x: layer.x + layer.width, y: layer.y + layer.height / 2 }
          ]
        });
        continue;
      }

      rectangleEdits.push({
        page: layer.page,
        x: layer.x,
        y: layer.y,
        width: layer.width,
        height: layer.height,
        color: layer.color,
        opacity: layer.opacity
      });

      textEdits.push({
        page: layer.page,
        x: layer.x + 10,
        y: layer.y + Math.max(14, layer.height - 22),
        width: Math.max(20, layer.width - 20),
        text: layer.text,
        fontSize: layer.variant === "sticky" ? 10 : 11,
        fontFamily: "sans",
        align: "left",
        lineHeight: 1.2,
        opacity: 1,
        customFont: null,
        bold: true,
        italic: false,
        underline: false,
        color: "#19334d"
      });
      continue;
    }
  }

  const pageNumbers = getPageNumbersConfig(state) ?? undefined;
  const watermark = getWatermarkConfig(state) ?? undefined;

  return {
    outputMode: document.export.outputMode,
    textEdits,
    rectangleEdits,
    redactionEdits,
    imageEdits,
    inkEdits,
    formEdits,
    textReplacementEdits: document.operations.textReplacements,
    pageRotations: document.operations.pageRotations,
    pageNumbers,
    watermark,
    retentionHours: document.export.retentionHours
  };
}
