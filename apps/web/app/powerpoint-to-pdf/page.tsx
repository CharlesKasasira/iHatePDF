"use client";

import { useRef, useState } from "react";
import { SiteHeader } from "../components/site-header";
import { pollTask, queuePowerpointToPdf, uploadFile } from "../lib/pdf-api";

const POWERPOINT_MIME_TYPES = [
  "application/vnd.openxmlformats-officedocument.presentationml.presentation"
] as const;

export default function PowerpointToPdfPage(): React.JSX.Element {
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [outputName, setOutputName] = useState("converted.pdf");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [downloadUrl, setDownloadUrl] = useState("");

  const onConvert = async (): Promise<void> => {
    if (!file) {
      setStatus("Select a PowerPoint file first.");
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
      const uploaded = await uploadFile(file, POWERPOINT_MIME_TYPES);

      setStatus("Queueing PowerPoint to PDF conversion...");
      const { taskId } = await queuePowerpointToPdf(uploaded.fileId, outputName.trim());

      setStatus("Converting your file...");
      const done = await pollTask(taskId);

      if (done.status === "completed" && done.outputDownloadUrl) {
        setStatus("PowerPoint to PDF conversion completed.");
        setDownloadUrl(done.outputDownloadUrl);
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
      <SiteHeader active="powerpoint-to-pdf" />

      <main className="feature-page">
        <section className="feature-hero">
          <h1>PowerPoint to PDF</h1>
          <p>Convert PowerPoint presentations into easy-to-share PDF files.</p>

          <div className="upload-center compact">
            <button
              type="button"
              className="select-files-btn"
              onClick={() => inputRef.current?.click()}
              disabled={busy}
            >
              Select PowerPoint file
            </button>
            <input
              ref={inputRef}
              type="file"
              hidden
              accept=".pptx,application/vnd.openxmlformats-officedocument.presentationml.presentation"
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            />
          </div>

          <p className="drop-hint">{file ? `Selected: ${file.name}` : "Choose one .pptx file"}</p>
        </section>

        <section className="merge-workbench">
          <h2>Conversion options</h2>

          <label htmlFor="powerpoint-to-pdf-output">Output filename</label>
          <input
            id="powerpoint-to-pdf-output"
            value={outputName}
            onChange={(event) => setOutputName(event.target.value)}
            placeholder="converted.pdf"
          />

          <button type="button" className="start-process-btn" disabled={busy} onClick={onConvert}>
            {busy ? "Converting..." : "Convert to PDF"}
          </button>

          <p className={status.toLowerCase().includes("failed") ? "error" : "small"}>{status}</p>
          {downloadUrl ? (
            <a className="download" href={downloadUrl} target="_blank" rel="noreferrer">
              Download PDF file
            </a>
          ) : null}
        </section>
      </main>
    </div>
  );
}
