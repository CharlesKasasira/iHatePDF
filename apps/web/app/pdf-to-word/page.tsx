"use client";

import { useRef, useState } from "react";
import { SiteHeader } from "../components/site-header";
import { pollTask, queuePdfToWord, uploadPdf } from "../lib/pdf-api";

export default function PdfToWordPage(): React.JSX.Element {
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [outputName, setOutputName] = useState("converted.docx");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [downloadUrl, setDownloadUrl] = useState("");

  const onConvert = async (): Promise<void> => {
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

      setStatus("Queueing PDF to Word conversion...");
      const { taskId } = await queuePdfToWord(uploaded.fileId, outputName.trim());

      setStatus("Converting your file...");
      const done = await pollTask(taskId);

      if (done.status === "completed" && done.outputDownloadUrl) {
        setStatus("PDF to Word conversion completed.");
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
      <SiteHeader active="pdf-to-word" />

      <main className="feature-page">
        <section className="feature-hero">
          <h1>PDF to Word</h1>
          <p>Convert PDF files into editable DOCX documents.</p>

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
          <h2>Conversion options</h2>

          <label htmlFor="word-output">Output filename</label>
          <input
            id="word-output"
            value={outputName}
            onChange={(event) => setOutputName(event.target.value)}
            placeholder="converted.docx"
          />

          <button type="button" className="start-process-btn" disabled={busy} onClick={onConvert}>
            {busy ? "Converting..." : "Convert to Word"}
          </button>

          <p className={status.toLowerCase().includes("failed") ? "error" : "small"}>{status}</p>
          {downloadUrl ? (
            <a className="download" href={downloadUrl} target="_blank" rel="noreferrer">
              Download Word file
            </a>
          ) : null}
        </section>
      </main>
    </div>
  );
}
