"use client";

import { useState } from "react";
import { SiteHeader } from "./site-header";
import { pollTask, uploadPdf } from "../lib/pdf-api";
import { TaskProgressState } from "./task-progress-state";
import { UploadDropzone } from "./upload-dropzone";

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

          <UploadDropzone
            label="Select PDF file"
            hint={file ? `Selected: ${file.name}` : "Choose one PDF file or drop it here"}
            accept="application/pdf"
            compact
            disabled={busy}
            onFiles={(files) => onFileChange(files?.[0] ?? null)}
          />
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

          {!file ? (
            <div className="tool-empty-state">
              <strong>No PDF selected</strong>
              <span>Upload one PDF to unlock range controls and export progress.</span>
            </div>
          ) : null}

          <TaskProgressState
            status={status}
            progressPercent={progressPercent}
            downloadUrl={downloadUrl}
            downloadLabel={downloadLabel}
          />
        </section>
      </main>
    </div>
  );
}
