"use client";

import { useRef, useState } from "react";
import { SiteHeader } from "../components/site-header";
import { pollTask, queueCompress, uploadPdf } from "../lib/pdf-api";

export default function CompressPage(): React.JSX.Element {
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [outputName, setOutputName] = useState("compressed.pdf");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [downloadUrl, setDownloadUrl] = useState("");

  const onCompress = async (): Promise<void> => {
    if (!file) {
      setStatus("Select a PDF file first.");
      return;
    }

    if (!outputName.trim()) {
      setStatus("Set an output filename.");
      return;
    }

    try {
      setBusy(true);
      setDownloadUrl("");
      setStatus("Uploading file...");
      const uploaded = await uploadPdf(file);

      setStatus("Queueing compression...");
      const { taskId } = await queueCompress(uploaded.fileId, outputName.trim());

      setStatus("Compressing your file...");
      const done = await pollTask(taskId);

      if (done.status === "completed" && done.outputDownloadUrl) {
        setStatus("Compression completed.");
        setDownloadUrl(done.outputDownloadUrl);
      } else {
        setStatus(`Compression failed: ${done.errorMessage ?? "unknown error"}`);
      }
    } catch (error) {
      setStatus(`Compression failed: ${(error as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="site-shell">
      <SiteHeader active="compress" />

      <main className="feature-page">
        <section className="feature-hero">
          <h1>Compress PDF files</h1>
          <p>Reduce file size while optimizing for maximal PDF quality.</p>

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

          <p className="drop-hint">{file ? `Selected: ${file.name}` : "Choose one PDF file"}</p>
        </section>

        <section className="merge-workbench">
          <h2>Compression options</h2>

          <label htmlFor="compress-output">Output filename</label>
          <input
            id="compress-output"
            value={outputName}
            onChange={(event) => setOutputName(event.target.value)}
            placeholder="compressed.pdf"
          />

          <button type="button" className="start-process-btn" disabled={busy} onClick={onCompress}>
            {busy ? "Compressing..." : "Compress PDF"}
          </button>

          <p className={status.toLowerCase().includes("failed") ? "error" : "small"}>{status}</p>
          {downloadUrl ? (
            <a className="download" href={downloadUrl} target="_blank" rel="noreferrer">
              Download compressed PDF
            </a>
          ) : null}
        </section>
      </main>
    </div>
  );
}
