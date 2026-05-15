"use client";

import type { EditPageNumbersInput } from "../../lib/pdf-api";
import type { EditorPage, EditorTool } from "./types";

export const DEFAULT_EDITOR_PAGE: EditorPage = {
  pageNumber: 1,
  width: 612,
  height: 792
};

export const TOOL_ITEMS: Array<{ id: EditorTool; label: string; hint: string }> = [
  { id: "select", label: "Select", hint: "Inspect and refine layers" },
  { id: "text", label: "Text", hint: "Place styled type onto the page" },
  { id: "highlight", label: "Highlight", hint: "Lay down translucent emphasis bars" },
  { id: "shape", label: "Shapes", hint: "Add clean blocks to the page" },
  { id: "erase", label: "Erase", hint: "Cover PDF content with white blocks" },
  { id: "sign", label: "Sign", hint: "Stamp a handwritten signature image" },
  { id: "image", label: "Image", hint: "Insert logos, seals, or graphics" }
];

export const RETENTION_OPTIONS = [
  { value: 1, label: "1 hour" },
  { value: 24, label: "24 hours" },
  { value: 72, label: "3 days" },
  { value: 168, label: "7 days" },
  { value: 720, label: "30 days" }
] as const;

export const PAGE_NUMBER_POSITIONS: Array<{
  value: EditPageNumbersInput["position"];
  label: string;
}> = [
  { value: "top-left", label: "Top left" },
  { value: "top-center", label: "Top center" },
  { value: "top-right", label: "Top right" },
  { value: "bottom-left", label: "Bottom left" },
  { value: "bottom-center", label: "Bottom center" },
  { value: "bottom-right", label: "Bottom right" }
];
