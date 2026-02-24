"use client";

import { useRef, useState } from "react";
import { SiteHeader } from "../components/site-header";
import { pollTask, queueProtect, uploadPdf } from "../lib/pdf-api";

export default function ProtectPage(): React.JSX.Element {
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [password, setPassword] = useState("");
  const [outputName, setOutputName] = useState("protected.pdf");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [downloadUrl, setDownloadUrl] = useState("");

  const onProtect = async (): Promise<void> => {
    if (!file) {
      setStatus("Select a PDF file first.");
      return;
    }

    const trimmedPassword = password.trim();
    if (trimmedPassword.length < 4) {
      setStatus("Set a password with at least 4 characters.");
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

      setStatus("Queueing protection...");
      const { taskId } = await queueProtect(uploaded.fileId, trimmedPassword, outputName.trim());

      setStatus("Encrypting your file...");
      const done = await pollTask(taskId);

      if (done.status === "completed" && done.outputDownloadUrl) {
        setStatus("PDF protected successfully.");
        setDownloadUrl(done.outputDownloadUrl);
      } else {
        setStatus(`Protection failed: ${done.errorMessage ?? "unknown error"}`);
      }
    } catch (error) {
      setStatus(`Protection failed: ${(error as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="site-shell">
      <SiteHeader active="protect" />

      <main className="feature-page">
        <section className="feature-hero">
          <h1>Protect PDF file</h1>
          <p>Encrypt your PDF with a password to keep sensitive data confidential.</p>

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
          <h2>Protection options</h2>

          <label htmlFor="protect-password">Password</label>
          <input
            id="protect-password"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="Enter password"
          />

          <label htmlFor="protect-output">Output filename</label>
          <input
            id="protect-output"
            value={outputName}
            onChange={(event) => setOutputName(event.target.value)}
            placeholder="protected.pdf"
          />

          <button type="button" className="start-process-btn" disabled={busy} onClick={onProtect}>
            {busy ? "Protecting..." : "Protect PDF"}
          </button>

          <p className={status.toLowerCase().includes("failed") ? "error" : "small"}>{status}</p>
          {downloadUrl ? (
            <a className="download" href={downloadUrl} target="_blank" rel="noreferrer">
              Download protected PDF
            </a>
          ) : null}
        </section>
      </main>
    </div>
  );
}
