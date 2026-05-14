"use client";

import { useRef, useState } from "react";
import { SiteHeader } from "../components/site-header";
import { pollTask, queueJpgToPdf, uploadJpg } from "../lib/pdf-api";

const JPEG_MIME_TYPES = new Set(["image/jpeg", "image/jpg"]);

function moveItem<T>(items: T[], from: number, to: number): T[] {
  const next = [...items];
  const [removed] = next.splice(from, 1);
  next.splice(to, 0, removed);
  return next;
}

function isJpgFile(file: File): boolean {
  return JPEG_MIME_TYPES.has(file.type) || /\.jpe?g$/i.test(file.name);
}

function filterJpgFiles(list: FileList | null): File[] {
  if (!list) {
    return [];
  }

  return Array.from(list).filter(isJpgFile);
}

export default function JpgToPdfPage(): React.JSX.Element {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [outputName, setOutputName] = useState("images.pdf");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [progressPercent, setProgressPercent] = useState(0);
  const [downloadUrl, setDownloadUrl] = useState("");
  const [isDropActive, setIsDropActive] = useState(false);

  const addFiles = (incoming: File[]): void => {
    if (incoming.length === 0) {
      setStatus("Only JPG and JPEG files are accepted.");
      return;
    }

    setFiles((current) => [...current, ...incoming]);
    setStatus("");
  };

  const onStartConversion = async (): Promise<void> => {
    if (files.length === 0) {
      setStatus("Select at least one JPG image.");
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
      setStatus("Uploading images...");
      const uploaded = await Promise.all(files.map((file) => uploadJpg(file)));

      setProgressPercent(10);
      setStatus("Queueing JPG to PDF conversion...");
      const { taskId } = await queueJpgToPdf(
        uploaded.map((item) => item.fileId),
        outputName
      );

      setStatus("Waiting for the conversion worker...");
      const done = await pollTask(taskId, {
        onUpdate: (task) => {
          setProgressPercent(task.progressPercent);
          setStatus(task.progressMessage ?? "Processing...");
        }
      });

      if (done.status === "completed" && done.outputDownloadUrl) {
        setDownloadUrl(done.outputDownloadUrl);
        setProgressPercent(100);
        setStatus("JPG to PDF conversion completed.");
      } else {
        setStatus(`Conversion failed: ${done.errorMessage ?? "unknown error"}`);
      }
    } catch (error) {
      setStatus(`Conversion failed: ${(error as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="site-shell">
      <SiteHeader active="jpg-to-pdf" />

      <main className="feature-page">
        <section className="feature-hero">
          <h1>JPG to PDF</h1>
          <p>Combine JPG and JPEG images into one PDF in the exact order you choose.</p>

          <div
            className={`upload-center ${isDropActive ? "is-drop-active" : ""}`}
            onDragOver={(event) => {
              event.preventDefault();
              setIsDropActive(true);
            }}
            onDragLeave={() => setIsDropActive(false)}
            onDrop={(event) => {
              event.preventDefault();
              setIsDropActive(false);
              addFiles(filterJpgFiles(event.dataTransfer.files));
            }}
          >
            <button
              type="button"
              className="select-files-btn"
              onClick={() => fileInputRef.current?.click()}
              disabled={busy}
            >
              Select JPG files
            </button>

            <div className="side-cloud-buttons" aria-hidden="true">
              <button type="button">J</button>
              <button type="button">P</button>
            </div>

            <input
              ref={fileInputRef}
              type="file"
              accept=".jpg,.jpeg,image/jpeg"
              multiple
              hidden
              onChange={(event) => addFiles(filterJpgFiles(event.target.files))}
            />
          </div>

          <p className="drop-hint">or drop JPG images here</p>
        </section>

        {files.length > 0 ? (
          <section className="merge-workbench">
            <h2>Selected images</h2>
            <div className="picked-files">
              {files.map((file, index) => (
                <article key={`${file.name}-${index}`} className="picked-file-row">
                  <div>
                    <strong>{index + 1}.</strong> {file.name}
                  </div>
                  <div className="row-actions">
                    <button
                      type="button"
                      onClick={() => setFiles((current) => moveItem(current, index, index - 1))}
                      disabled={index === 0 || busy}
                    >
                      Up
                    </button>
                    <button
                      type="button"
                      onClick={() => setFiles((current) => moveItem(current, index, index + 1))}
                      disabled={index === files.length - 1 || busy}
                    >
                      Down
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setFiles((current) => current.filter((_, itemIndex) => itemIndex !== index))
                      }
                      disabled={busy}
                    >
                      Remove
                    </button>
                  </div>
                </article>
              ))}
            </div>

            <label htmlFor="jpg-to-pdf-output">Output filename</label>
            <input
              id="jpg-to-pdf-output"
              value={outputName}
              onChange={(event) => setOutputName(event.target.value)}
              placeholder="images.pdf"
            />

            <button
              type="button"
              className="start-process-btn"
              disabled={busy || files.length === 0}
              onClick={onStartConversion}
            >
              {busy ? "Converting..." : "Convert JPG to PDF"}
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
                Download PDF
              </a>
            ) : null}
          </section>
        ) : null}
      </main>
    </div>
  );
}
