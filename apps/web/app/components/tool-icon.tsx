import {
  Archive,
  Combine,
  Edit3,
  FileImage,
  FileOutput,
  FileSpreadsheet,
  FileText,
  FileType2,
  GripVertical,
  Image,
  Lock,
  LucideIcon,
  Minimize2,
  PenLine,
  Scissors,
  Share2,
  ShieldCheck,
  Trash2,
  Unlock,
  UploadCloud
} from "lucide-react";
import type { ToolIconKey } from "./tool-registry";

const ICONS: Record<ToolIconKey, LucideIcon> = {
  merge: Combine,
  split: Scissors,
  trash: Trash2,
  extract: FileOutput,
  organize: Archive,
  compress: Minimize2,
  lock: Lock,
  unlock: Unlock,
  share: Share2,
  image: Image,
  word: FileType2,
  "file-image": FileImage,
  presentation: FileOutput,
  spreadsheet: FileSpreadsheet,
  "file-text": FileText,
  pen: PenLine,
  edit: Edit3
};

export function ToolIcon({
  name,
  className = "",
  "aria-hidden": ariaHidden = true
}: {
  name: ToolIconKey;
  className?: string;
  "aria-hidden"?: boolean;
}): React.JSX.Element {
  const Icon = ICONS[name];
  return <Icon className={className} aria-hidden={ariaHidden} strokeWidth={2.2} />;
}

export const UtilityIcons = {
  GripVertical,
  ShieldCheck,
  UploadCloud
};
