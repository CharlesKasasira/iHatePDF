import { CheckCircle2, CircleDashed, CircleDotDashed, Download, TriangleAlert } from "lucide-react";

export type ProgressTone = "idle" | "running" | "success" | "error";

export function getProgressTone(status: string, progressPercent: number, downloadUrl?: string): ProgressTone {
  const lower = status.toLowerCase();
  if (lower.includes("failed") || lower.includes("error")) {
    return "error";
  }
  if (downloadUrl || progressPercent >= 100 || lower.includes("completed")) {
    return "success";
  }
  if (progressPercent > 0 || lower.includes("upload") || lower.includes("queue") || lower.includes("processing")) {
    return "running";
  }
  return "idle";
}

export function TaskProgressState({
  status,
  progressPercent,
  downloadUrl,
  downloadLabel
}: {
  status: string;
  progressPercent: number;
  downloadUrl?: string;
  downloadLabel?: string;
}): React.JSX.Element | null {
  if (!status && progressPercent <= 0 && !downloadUrl) {
    return null;
  }

  const tone = getProgressTone(status, progressPercent, downloadUrl);
  const Icon =
    tone === "success"
      ? CheckCircle2
      : tone === "error"
        ? TriangleAlert
        : tone === "running"
          ? CircleDotDashed
          : CircleDashed;

  return (
    <div className={`progress-state is-${tone}`}>
      <div className="progress-state__topline">
        <span>
          <Icon aria-hidden="true" size={18} />
          {status || "Ready"}
        </span>
        <strong>{Math.max(0, Math.min(100, progressPercent))}%</strong>
      </div>
      <div className="task-progress-rail">
        <span style={{ width: `${Math.max(0, Math.min(100, progressPercent))}%` }} />
      </div>
      {downloadUrl ? (
        <a className="download progress-state__download" href={downloadUrl} target="_blank" rel="noreferrer">
          <Download aria-hidden="true" size={18} />
          {downloadLabel ?? "Download output"}
        </a>
      ) : null}
    </div>
  );
}
