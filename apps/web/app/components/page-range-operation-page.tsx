"use client";

import { useRef, useState } from "react";
import { SiteHeader } from "./site-header";
import { pollTask, uploadPdf } from "../lib/pdf-api";

type PageRangeOperationPageProps = {
  active: React.ComponentProps<typeof SiteHeader>["active"];
  title: string;
  description: string;
  rangeLabel: string;
  rangePlaceholder: string;
  outputPlaceholder: string;
  helperText: string;
  startLabel: string;
  runningLabel: string;
  completionLabel: string;
  downloadLabel: string;
  deriveOutputName: (file: File) => string;
  queueTask: (fileId: string, pageRanges: string[], outputName: string) => Promise<{ taskId: string }>;
};

export function PageRangeOperationPage({
  active,
  title,
  description,
  rangeLabel,
  rangePlaceholder,
  outputPlaceholder,
  helperText,
  startLabel,
  runningLabel,
  completionLabel,
  downloadLabel,
  deriveOutputName,
  queueTask
}: PageRangeOperationPageProps): React.JSX.Element {
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [pageRanges, setPageRanges] = useState("1");
  const [outputName, setOutputName] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [progressPercent, setProgressPercent] = useState(0);
  const [downloadUrl, setDownloadUrl] = useState("");

  const onFileChange = (nextFile: File | null): void => {
    setFile(nextFile);
    if (nextFile) {
      setOutputName(deriveOutputName(nextFile));
      setStatus("");
      setDownloadUrl("");
      setProgressPercent(0);
    }
  };

  const onStart = async (): Promise<void> => {
    if (!file) {
      setStatus("Select a PDF file first.");
      return;
    }

    const ranges = pageRanges
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);

    if (ranges.length === 0) {
      setStatus("Enter at least one page range.");
      return;
    }

    if (!outputName.trim()) {
      setStatus("Set an output file name.");
      return;
    }

    try {
      setBusy(true);
      setDownloadUrl("");
      setProgressPercent(4);
      setStatus("Uploading file...");
      const uploaded = await uploadPdf(file);

      setProgressPercent(10);
      setStatus("Queueing task...");
      const { taskId } = await queueTask(uploaded.fileId, ranges, outputName.trim());

      setStatus("Waiting for the worker...");
      const done = await pollTask(taskId, {
        onUpdate: (task) => {
          setProgressPercent(task.progressPercent);
          setStatus(task.progressMessage ?? "Processing...");
        }
      });

      if (done.status === "completed" && done.outputDownloadUrl) {
        setProgressPercent(100);
        setStatus(completionLabel);
        setDownloadUrl(done.outputDownloadUrl);
      } else {
        setStatus(`Task failed: ${done.errorMessage ?? "unknown error"}`);
      }
    } catch (error) {
      setStatus(`Task failed: ${(error as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="site-shell">
      <SiteHeader active={active} />

      <main className="feature-page">
        <section className="feature-hero">
          <h1>{title}</h1>
          <p>{description}</p>

          <div className="upload-center compact">
            <button
              type="button"
              className="select-files-btn"
              onClick={() => inputRef.current?.click()}
              disabled={busy}
            >
              Select PDF file
            </button>
            <input
              ref={inputRef}
              type="file"
              hidden
              accept="application/pdf"
              onChange={(event) => onFileChange(event.target.files?.[0] ?? null)}
            />
          </div>
          <p className="drop-hint">{file ? `Selected: ${file.name}` : "Choose one PDF file"}</p>
        </section>

        <section className="merge-workbench">
          <h2>{helperText}</h2>

          <label htmlFor="page-range-input">{rangeLabel}</label>
          <input
            id="page-range-input"
            value={pageRanges}
            onChange={(event) => setPageRanges(event.target.value)}
            placeholder={rangePlaceholder}
          />

          <label htmlFor="page-range-output">Output filename</label>
          <input
            id="page-range-output"
            value={outputName}
            onChange={(event) => setOutputName(event.target.value)}
            placeholder={outputPlaceholder}
          />

          <button type="button" className="start-process-btn" disabled={busy} onClick={onStart}>
            {busy ? runningLabel : startLabel}
          </button>

          {busy || progressPercent > 0 ? (
            <div className="batch-task-progress">
              <div className="batch-task-progress-row">
                <span>{status}</span>
                <strong>{progressPercent}%</strong>
              </div>
              <div className="task-progress-rail">
                <span style={{ width: `${progressPercent}%` }} />
              </div>
            </div>
          ) : null}

          <p className={status.toLowerCase().includes("failed") ? "error" : "small"}>{status}</p>
          {downloadUrl ? (
            <a className="download" href={downloadUrl} target="_blank" rel="noreferrer">
              {downloadLabel}
            </a>
          ) : null}
        </section>
      </main>
    </div>
  );
}
