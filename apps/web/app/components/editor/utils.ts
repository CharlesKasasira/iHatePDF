"use client";

import type { EditPageNumbersInput } from "../../lib/pdf-api";
import { RETENTION_OPTIONS } from "./constants";
import type { EditorLayer, EditorTool, EditorMode } from "./types";

export function nextLayerId(): string {
  return `layer-${crypto.randomUUID()}`;
}

export function buildEditedName(fileName: string): string {
  const stripped = fileName.toLowerCase().endsWith(".pdf") ? fileName.slice(0, -4) : fileName;
  return `${stripped || "document"}-studio.pdf`;
}

export function buildSignedName(fileName: string): string {
  const stripped = fileName.toLowerCase().endsWith(".pdf") ? fileName.slice(0, -4) : fileName;
  return `${stripped || "document"}-signed.pdf`;
}

export function buildDefaultOutputName(_mode: EditorMode): string {
  return "studio-export.pdf";
}

export function buildDefaultSignatureRequestOutputName(): string {
  return "signed-request.pdf";
}

export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Failed to read asset."));
    reader.onload = () => resolve(String(reader.result));
    reader.readAsDataURL(file);
  });
}

export function fontFamilyLabel(fontFamily: "sans" | "serif" | "mono"): string {
  if (fontFamily === "serif") {
    return "Editorial Serif";
  }
  if (fontFamily === "mono") {
    return "Mono";
  }
  return "Studio Sans";
}

export function cssFontFamily(fontFamily: "sans" | "serif" | "mono"): string {
  if (fontFamily === "serif") {
    return "\"Iowan Old Style\", \"Palatino Linotype\", serif";
  }
  if (fontFamily === "mono") {
    return "\"IBM Plex Mono\", \"SFMono-Regular\", monospace";
  }
  return "\"Avenir Next\", \"Nunito Sans\", sans-serif";
}

export function layerSummary(layer: EditorLayer): string {
  if (layer.kind === "text") {
    return layer.text;
  }
  if (layer.kind === "rectangle") {
    if (layer.variant === "highlight") {
      return "Highlight band";
    }
    if (layer.variant === "erase") {
      return "Erase block";
    }
    return "Shape block";
  }
  return layer.variant === "sign" ? "Signature" : layer.fileName;
}

export function retentionLabel(retentionHours: number): string {
  return RETENTION_OPTIONS.find((option) => option.value === retentionHours)?.label ?? `${retentionHours}h`;
}

export function normalizeNumber(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function previewPageNumber(pageNumber: number, config: EditPageNumbersInput): string {
  return `${config.prefix ?? ""}${config.startAt + pageNumber - 1}`;
}

export function toolStatusMessage(tool: EditorTool): string {
  if (tool === "text") {
    return "Edit the text draft in the sidebar, then click the PDF page to place it.";
  }
  if (tool === "select") {
    return "Select a layer to edit it, drag it to reposition it, or pull its handles to resize it.";
  }
  if (tool === "erase") {
    return "Click the PDF page to place a white block over content, then resize it with Select.";
  }
  return "";
}
