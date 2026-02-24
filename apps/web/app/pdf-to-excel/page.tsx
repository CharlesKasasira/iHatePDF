"use client";

import { useRef, useState } from "react";
import { SiteHeader } from "../components/site-header";
import { pollTask, queuePdfToExcel, uploadPdf } from "../lib/pdf-api";

export default function PdfToExcelPage(): React.JSX.Element {
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [outputName, setOutputName] = useState("converted.xlsx");
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

      setStatus("Queueing PDF to Excel conversion...");
      const { taskId } = await queuePdfToExcel(uploaded.fileId, outputName.trim());

      setStatus("Converting your file...");
      const done = await pollTask(taskId);

      if (done.status === "completed" && done.outputDownloadUrl) {
        setStatus("PDF to Excel conversion completed.");
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
      <SiteHeader active="pdf-to-excel" />

      <main className="feature-page">
        <section className="feature-hero">
          <h1>PDF to Excel</h1>
          <p>Extract PDF text into an editable XLSX worksheet.</p>

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

          <label htmlFor="excel-output">Output filename</label>
          <input
            id="excel-output"
            value={outputName}
            onChange={(event) => setOutputName(event.target.value)}
            placeholder="converted.xlsx"
          />

          <button type="button" className="start-process-btn" disabled={busy} onClick={onConvert}>
            {busy ? "Converting..." : "Convert to Excel"}
          </button>

          <p className={status.toLowerCase().includes("failed") ? "error" : "small"}>{status}</p>
          {downloadUrl ? (
            <a className="download" href={downloadUrl} target="_blank" rel="noreferrer">
              Download Excel file
            </a>
          ) : null}
        </section>
      </main>
    </div>
  );
}
