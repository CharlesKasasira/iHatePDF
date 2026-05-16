import type { Route } from "next";

export type ActiveKey =
  | "merge"
  | "split"
  | "remove-pages"
  | "extract-pages"
  | "organize-pdf"
  | "compress"
  | "sign-pdf"
  | "protect"
  | "unlock"
  | "share-pdf"
  | "jpg-to-pdf"
  | "pdf-to-word"
  | "pdf-to-jpg"
  | "pdf-to-powerpoint"
  | "pdf-to-excel"
  | "word-to-pdf"
  | "excel-to-pdf"
  | "powerpoint-to-pdf"
  | "edit";

export type ToolGroupId = "organize" | "optimize" | "convert" | "edit" | "security" | "share" | "sign";

export type ToolIconKey =
  | "merge"
  | "split"
  | "trash"
  | "extract"
  | "organize"
  | "compress"
  | "lock"
  | "unlock"
  | "share"
  | "image"
  | "word"
  | "file-image"
  | "presentation"
  | "spreadsheet"
  | "file-text"
  | "pen"
  | "edit";

export type ToolItem = {
  key: ActiveKey;
  title: string;
  shortTitle: string;
  description: string;
  href: Route;
  icon: ToolIconKey;
  group: ToolGroupId;
  featured?: boolean;
  badge?: string;
};

export const TOOL_GROUPS: Array<{
  id: ToolGroupId;
  label: string;
  description: string;
}> = [
  { id: "organize", label: "Organize", description: "Reorder, merge, split, extract, or remove pages." },
  { id: "optimize", label: "Optimize", description: "Reduce document size without losing the workflow." },
  { id: "convert", label: "Convert", description: "Move between PDFs, Office files, and images." },
  { id: "edit", label: "Edit", description: "Layer content and make document-wide edits." },
  { id: "security", label: "Security", description: "Protect or unlock PDFs with known passwords." },
  { id: "share", label: "Share", description: "Create expiring PDF links and email them to recipients." },
  { id: "sign", label: "Sign", description: "Prepare signer routing and complete documents." }
];

export const TOOLS: ToolItem[] = [
  {
    key: "merge",
    title: "Merge PDF",
    shortTitle: "Merge",
    description: "Combine PDFs in the order you choose.",
    href: "/merge-pdf",
    icon: "merge",
    group: "organize",
    featured: true
  },
  {
    key: "split",
    title: "Split PDF",
    shortTitle: "Split",
    description: "Separate pages or ranges into downloadable output.",
    href: "/split-pdf",
    icon: "split",
    group: "organize"
  },
  {
    key: "remove-pages",
    title: "Remove pages",
    shortTitle: "Remove",
    description: "Delete pages visually from a preview grid.",
    href: "/remove-pages",
    icon: "trash",
    group: "organize"
  },
  {
    key: "extract-pages",
    title: "Extract pages",
    shortTitle: "Extract",
    description: "Keep selected pages and export a focused PDF.",
    href: "/extract-pages",
    icon: "extract",
    group: "organize"
  },
  {
    key: "organize-pdf",
    title: "Organize PDF",
    shortTitle: "Organize",
    description: "Reorder, duplicate, and remove page slots.",
    href: "/organize-pdf",
    icon: "organize",
    group: "organize",
    featured: true
  },
  {
    key: "compress",
    title: "Compress PDF",
    shortTitle: "Compress",
    description: "Shrink PDFs while preserving useful quality.",
    href: "/compress-pdf",
    icon: "compress",
    group: "optimize"
  },
  {
    key: "jpg-to-pdf",
    title: "JPG to PDF",
    shortTitle: "JPG to PDF",
    description: "Combine ordered JPG images into one PDF.",
    href: "/jpg-to-pdf",
    icon: "image",
    group: "convert",
    featured: true
  },
  {
    key: "pdf-to-word",
    title: "PDF to Word",
    shortTitle: "PDF to Word",
    description: "Convert PDFs into editable Word documents.",
    href: "/pdf-to-word",
    icon: "word",
    group: "convert"
  },
  {
    key: "pdf-to-jpg",
    title: "PDF to JPG",
    shortTitle: "PDF to JPG",
    description: "Export PDF pages as JPG images.",
    href: "/pdf-to-jpg",
    icon: "file-image",
    group: "convert"
  },
  {
    key: "pdf-to-powerpoint",
    title: "PDF to PowerPoint",
    shortTitle: "PDF to PPT",
    description: "Turn PDFs into editable presentations.",
    href: "/pdf-to-powerpoint",
    icon: "presentation",
    group: "convert"
  },
  {
    key: "pdf-to-excel",
    title: "PDF to Excel",
    shortTitle: "PDF to Excel",
    description: "Extract PDF content into spreadsheets.",
    href: "/pdf-to-excel",
    icon: "spreadsheet",
    group: "convert"
  },
  {
    key: "word-to-pdf",
    title: "Word to PDF",
    shortTitle: "Word to PDF",
    description: "Convert DOCX files into portable PDFs.",
    href: "/word-to-pdf",
    icon: "file-text",
    group: "convert"
  },
  {
    key: "powerpoint-to-pdf",
    title: "PowerPoint to PDF",
    shortTitle: "PPT to PDF",
    description: "Convert slide decks into PDFs.",
    href: "/powerpoint-to-pdf",
    icon: "presentation",
    group: "convert"
  },
  {
    key: "excel-to-pdf",
    title: "Excel to PDF",
    shortTitle: "Excel to PDF",
    description: "Convert spreadsheets into PDFs.",
    href: "/excel-to-pdf",
    icon: "spreadsheet",
    group: "convert"
  },
  {
    key: "edit",
    title: "PDF Editor Studio",
    shortTitle: "Editor",
    description: "Add text, signatures, highlights, images, and document edits.",
    href: "/editor-studio",
    icon: "edit",
    group: "edit",
    badge: "Studio"
  },
  {
    key: "protect",
    title: "Protect PDF",
    shortTitle: "Protect",
    description: "Encrypt a PDF with a password.",
    href: "/protect-pdf",
    icon: "lock",
    group: "security"
  },
  {
    key: "unlock",
    title: "Unlock PDF",
    shortTitle: "Unlock",
    description: "Remove a known PDF password.",
    href: "/unlock-pdf",
    icon: "unlock",
    group: "security"
  },
  {
    key: "share-pdf",
    title: "Share PDF",
    shortTitle: "Share",
    description: "Create an expiring link and optionally email it to someone.",
    href: "/share-pdf",
    icon: "share",
    group: "share",
    featured: true
  },
  {
    key: "sign-pdf",
    title: "Sign PDF",
    shortTitle: "Sign",
    description: "Place fields, route signers, and finalize signed PDFs.",
    href: "/sign-pdf",
    icon: "pen",
    group: "sign",
    featured: true
  }
];

export function toolsForGroup(groupId: ToolGroupId): ToolItem[] {
  return TOOLS.filter((tool) => tool.group === groupId);
}

export function isToolActive(tool: ToolItem, active: ActiveKey | null): boolean {
  if (!active) {
    return false;
  }
  if (tool.key === active) {
    return true;
  }
  return tool.key === "organize-pdf" && ["remove-pages", "extract-pages"].includes(active);
}
