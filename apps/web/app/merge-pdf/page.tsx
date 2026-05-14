"use client";

import { useRef, useState } from "react";
import { SiteHeader } from "../components/site-header";
import { pollTask, queueMerge, uploadPdf } from "../lib/pdf-api";

function moveItem<T>(items: T[], from: number, to: number): T[] {
  const next = [...items];
  const [removed] = next.splice(from, 1);
  next.splice(to, 0, removed);
  return next;
}

function filterPdfFiles(list: FileList | null): File[] {
  if (!list) {
    return [];
  }

  return Array.from(list).filter((file) => file.type === "application/pdf");
}

export default function MergePage(): React.JSX.Element {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [outputName, setOutputName] = useState("merged.pdf");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [progressPercent, setProgressPercent] = useState(0);
  const [downloadUrl, setDownloadUrl] = useState("");
  const [isDropActive, setIsDropActive] = useState(false);

  const addFiles = (incoming: File[]): void => {
    if (incoming.length === 0) {
      setStatus("Only PDF files are accepted.");
      return;
    }

    setFiles((prev) => [...prev, ...incoming]);
    setStatus("");
  };

  const onStartMerge = async (): Promise<void> => {
    if (files.length < 2) {
      setStatus("Select at least two PDF files to merge.");
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
      setStatus("Uploading files...");
      const uploaded = await Promise.all(files.map((file) => uploadPdf(file)));

      setProgressPercent(10);
      setStatus("Queueing merge...");
      const { taskId } = await queueMerge(
        uploaded.map((item) => item.fileId),
        outputName
      );

      setStatus("Waiting for the merge worker...");
      const done = await pollTask(taskId, {
        onUpdate: (task) => {
          setProgressPercent(task.progressPercent);
          setStatus(task.progressMessage ?? "Processing...");
        }
      });

      if (done.status === "completed" && done.outputDownloadUrl) {
        setDownloadUrl(done.outputDownloadUrl);
        setProgressPercent(100);
        setStatus("Merge completed.");
      } else {
        setStatus(`Merge failed: ${done.errorMessage ?? "unknown error"}`);
      }
    } catch (error) {
      setStatus(`Merge failed: ${(error as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="site-shell">
      <SiteHeader active="merge" />

      <main className="feature-page">
        <section className="feature-hero">
          <h1>Merge PDF files</h1>
          <p>Combine PDFs in the order you want with the easiest PDF merger available.</p>

          <div
            className={`upload-center upload-center--single ${isDropActive ? "is-drop-active" : ""}`}
            onDragOver={(event) => {
              event.preventDefault();
              setIsDropActive(true);
            }}
            onDragLeave={() => setIsDropActive(false)}
            onDrop={(event) => {
              event.preventDefault();
              setIsDropActive(false);
              addFiles(filterPdfFiles(event.dataTransfer.files));
            }}
          >
            <button
              type="button"
              className="select-files-btn"
              onClick={() => fileInputRef.current?.click()}
              disabled={busy}
            >
              Select PDF files
            </button>

            <input
              ref={fileInputRef}
              type="file"
              accept="application/pdf"
              multiple
              hidden
              onChange={(event) => addFiles(filterPdfFiles(event.target.files))}
            />
          </div>

          <p className="drop-hint">or drop PDFs here</p>
        </section>

        {files.length > 0 ? (
          <section className="merge-workbench">
            <h2>Selected files</h2>
            <div className="picked-files">
              {files.map((file, index) => (
                <article key={`${file.name}-${index}`} className="picked-file-row">
                  <div>
                    <strong>{index + 1}.</strong> {file.name}
                  </div>
                  <div className="row-actions">
                    <button
                      type="button"
                      onClick={() => setFiles((prev) => moveItem(prev, index, index - 1))}
                      disabled={index === 0 || busy}
                    >
                      Up
                    </button>
                    <button
                      type="button"
                      onClick={() => setFiles((prev) => moveItem(prev, index, index + 1))}
                      disabled={index === files.length - 1 || busy}
                    >
                      Down
                    </button>
                    <button
                      type="button"
                      onClick={() => setFiles((prev) => prev.filter((_, itemIndex) => itemIndex !== index))}
                      disabled={busy}
                    >
                      Remove
                    </button>
                  </div>
                </article>
              ))}
            </div>

            <label htmlFor="merge-output">Output filename</label>
            <input
              id="merge-output"
              value={outputName}
              onChange={(event) => setOutputName(event.target.value)}
              placeholder="merged.pdf"
            />

            <button
              type="button"
              className="start-process-btn"
              disabled={busy || files.length < 2}
              onClick={onStartMerge}
            >
              {busy ? "Merging..." : "Merge PDF"}
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
                Download merged PDF
              </a>
            ) : null}
          </section>
        ) : null}
      </main>
    </div>
  );
}
