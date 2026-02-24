"use client";

import { useRef, useState } from "react";
import { SiteHeader } from "../components/site-header";
import { pollTask, queueUnlock, uploadPdf } from "../lib/pdf-api";

export default function UnlockPage(): React.JSX.Element {
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [password, setPassword] = useState("");
  const [outputName, setOutputName] = useState("unlocked.pdf");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [downloadUrl, setDownloadUrl] = useState("");

  const onUnlock = async (): Promise<void> => {
    if (!file) {
      setStatus("Select a PDF file first.");
      return;
    }

    const trimmedPassword = password.trim();
    if (!trimmedPassword) {
      setStatus("Enter the current PDF password.");
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

      setStatus("Queueing unlock...");
      const { taskId } = await queueUnlock(uploaded.fileId, trimmedPassword, outputName.trim());

      setStatus("Unlocking your file...");
      const done = await pollTask(taskId);

      if (done.status === "completed" && done.outputDownloadUrl) {
        setStatus("PDF unlocked successfully.");
        setDownloadUrl(done.outputDownloadUrl);
      } else {
        setStatus(`Unlock failed: ${done.errorMessage ?? "unknown error"}`);
      }
    } catch (error) {
      setStatus(`Unlock failed: ${(error as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="site-shell">
      <SiteHeader active="unlock" />

      <main className="feature-page">
        <section className="feature-hero">
          <h1>Unlock PDF file</h1>
          <p>Remove password protection from your PDF when you know the current password.</p>

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
          <h2>Unlock options</h2>

          <label htmlFor="unlock-password">Current password</label>
          <input
            id="unlock-password"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="Enter current password"
          />

          <label htmlFor="unlock-output">Output filename</label>
          <input
            id="unlock-output"
            value={outputName}
            onChange={(event) => setOutputName(event.target.value)}
            placeholder="unlocked.pdf"
          />

          <button type="button" className="start-process-btn" disabled={busy} onClick={onUnlock}>
            {busy ? "Unlocking..." : "Unlock PDF"}
          </button>

          <p className={status.toLowerCase().includes("failed") ? "error" : "small"}>{status}</p>
          {downloadUrl ? (
            <a className="download" href={downloadUrl} target="_blank" rel="noreferrer">
              Download unlocked PDF
            </a>
          ) : null}
        </section>
      </main>
    </div>
  );
}
