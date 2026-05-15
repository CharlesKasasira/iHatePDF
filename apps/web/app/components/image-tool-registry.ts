import type { ImageToolOperation } from "../lib/pdf-api";

export type ImageToolCategoryId = "optimize" | "create" | "modify" | "convert" | "security";
export type ImageToolStatus = "available" | "gated";

export type ImageToolKey =
  | "compress-image"
  | "resize-image"
  | "crop-image"
  | "convert-to-jpg"
  | "photo-editor"
  | "upscale-image"
  | "remove-background"
  | "meme-generator"
  | "rotate-image"
  | "convert-from-jpg"
  | "html-to-image"
  | "watermark-image"
  | "blur-face";

export type ImageToolItem = {
  key: ImageToolKey;
  title: string;
  shortTitle: string;
  description: string;
  category: ImageToolCategoryId;
  status: ImageToolStatus;
  operation?: ImageToolOperation;
  betaLabel?: string;
};

export const IMAGE_TOOL_CATEGORIES: Array<{
  id: ImageToolCategoryId;
  label: string;
  description: string;
}> = [
  { id: "optimize", label: "Optimize", description: "Reduce or improve image files." },
  { id: "create", label: "Create", description: "Generate new image outputs from sources." },
  { id: "modify", label: "Modify", description: "Crop, rotate, annotate, and adjust images." },
  { id: "convert", label: "Convert", description: "Move images between practical web formats." },
  { id: "security", label: "Security", description: "Privacy-focused image operations." }
];

export const IMAGE_TOOLS: ImageToolItem[] = [
  {
    key: "compress-image",
    title: "Compress Image",
    shortTitle: "Compress",
    description: "Reduce JPG, PNG, WebP, GIF, or SVG file size.",
    category: "optimize",
    status: "available",
    operation: "compress"
  },
  {
    key: "resize-image",
    title: "Resize Image",
    shortTitle: "Resize",
    description: "Resize by exact pixels or percentage.",
    category: "modify",
    status: "available",
    operation: "resize"
  },
  {
    key: "crop-image",
    title: "Crop Image",
    shortTitle: "Crop",
    description: "Crop by pixel bounds for a focused output.",
    category: "modify",
    status: "available",
    operation: "crop"
  },
  {
    key: "convert-to-jpg",
    title: "Convert to JPG",
    shortTitle: "To JPG",
    description: "Convert PNG, WebP, GIF, or SVG into JPG.",
    category: "convert",
    status: "available",
    operation: "convert_to_jpg"
  },
  {
    key: "photo-editor",
    title: "Photo Editor",
    shortTitle: "Editor",
    description: "A richer editor surface for filters and annotations.",
    category: "modify",
    status: "gated",
    betaLabel: "Gated beta"
  },
  {
    key: "upscale-image",
    title: "Upscale Image",
    shortTitle: "Upscale",
    description: "Increase resolution with an AI/provider-backed flow.",
    category: "optimize",
    status: "gated",
    betaLabel: "Provider needed"
  },
  {
    key: "remove-background",
    title: "Remove Background",
    shortTitle: "Background",
    description: "Cut out foreground subjects from photos.",
    category: "modify",
    status: "gated",
    betaLabel: "Provider needed"
  },
  {
    key: "meme-generator",
    title: "Meme Generator",
    shortTitle: "Meme",
    description: "Add classic top and bottom meme text.",
    category: "create",
    status: "available",
    operation: "meme"
  },
  {
    key: "rotate-image",
    title: "Rotate Image",
    shortTitle: "Rotate",
    description: "Rotate images by 90, 180, or 270 degrees.",
    category: "modify",
    status: "available",
    operation: "rotate"
  },
  {
    key: "convert-from-jpg",
    title: "Convert from JPG",
    shortTitle: "From JPG",
    description: "Convert JPG files to PNG, WebP, or GIF.",
    category: "convert",
    status: "available",
    operation: "convert_from_jpg"
  },
  {
    key: "html-to-image",
    title: "HTML to Image",
    shortTitle: "HTML",
    description: "Capture a URL or HTML snippet as an image.",
    category: "create",
    status: "gated",
    betaLabel: "Gated beta"
  },
  {
    key: "watermark-image",
    title: "Watermark Image",
    shortTitle: "Watermark",
    description: "Apply a text watermark to an image.",
    category: "security",
    status: "available",
    operation: "watermark"
  },
  {
    key: "blur-face",
    title: "Blur Face",
    shortTitle: "Blur Face",
    description: "Automatically blur faces for privacy.",
    category: "security",
    status: "gated",
    betaLabel: "Provider needed"
  }
];

export function imageToolsForCategory(category: ImageToolCategoryId): ImageToolItem[] {
  return IMAGE_TOOLS.filter((tool) => tool.category === category);
}
