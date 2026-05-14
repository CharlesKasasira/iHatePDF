"use client";

import { useRef, useState } from "react";
import { SiteHeader } from "../components/site-header";
import { pollTask, queueSplit, uploadPdf } from "../lib/pdf-api";

export default function SplitPage(): React.JSX.Element {
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [pageRanges, setPageRanges] = useState("1");
  const [outputPrefix, setOutputPrefix] = useState("split");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [progressPercent, setProgressPercent] = useState(0);
  const [downloadUrl, setDownloadUrl] = useState("");

  const onSplit = async (): Promise<void> => {
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

    try {
      setBusy(true);
      setDownloadUrl("");
      setProgressPercent(4);
      setStatus("Uploading file...");
      const uploaded = await uploadPdf(file);

      setProgressPercent(10);
      setStatus("Queueing split...");
      const { taskId } = await queueSplit(uploaded.fileId, ranges, outputPrefix || "split");

      setStatus("Waiting for the split worker...");
      const done = await pollTask(taskId, {
        onUpdate: (task) => {
          setProgressPercent(task.progressPercent);
          setStatus(task.progressMessage ?? "Processing...");
        }
      });

      if (done.status === "completed" && done.outputDownloadUrl) {
        setProgressPercent(100);
        setStatus("Split completed.");
        setDownloadUrl(done.outputDownloadUrl);
      } else {
        setStatus(`Split failed: ${done.errorMessage ?? "unknown error"}`);
      }
    } catch (error) {
      setStatus(`Split failed: ${(error as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="site-shell">
      <SiteHeader active="split" />

      <main className="feature-page">
        <section className="feature-hero">
          <h1>Split PDF file</h1>
          <p>Separate one page or a whole set for easy conversion into independent PDF files.</p>

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
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            />
          </div>
          <p className="drop-hint">{file ? `Selected: ${file.name}` : "Choose one file to split"}</p>
        </section>

        <section className="merge-workbench">
          <h2>Split options</h2>
          <label htmlFor="split-ranges">Page ranges (comma-separated)</label>
          <input
            id="split-ranges"
            value={pageRanges}
            onChange={(event) => setPageRanges(event.target.value)}
            placeholder="1,2-4"
          />

          <label htmlFor="split-prefix">Output prefix</label>
          <input
            id="split-prefix"
            value={outputPrefix}
            onChange={(event) => setOutputPrefix(event.target.value)}
            placeholder="split"
          />

          <button type="button" className="start-process-btn" disabled={busy} onClick={onSplit}>
            {busy ? "Splitting..." : "Split PDF"}
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
              Download split output
            </a>
          ) : null}
        </section>
      </main>
    </div>
  );
}
