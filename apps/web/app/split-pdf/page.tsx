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
      setStatus("Uploading file...");
      const uploaded = await uploadPdf(file);

      setStatus("Queueing split...");
      const { taskId } = await queueSplit(uploaded.fileId, ranges, outputPrefix || "split");

      setStatus("Splitting your file...");
      const done = await pollTask(taskId);

      if (done.status === "completed" && done.outputDownloadUrl) {
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
