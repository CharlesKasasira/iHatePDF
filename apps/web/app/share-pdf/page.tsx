"use client";

import { Copy, Mail, Share2 } from "lucide-react";
import { useState } from "react";
import { SiteHeader } from "../components/site-header";
import { UploadDropzone } from "../components/upload-dropzone";
import {
  createFileShare,
  isAllowedFileType,
  uploadPdf,
  type FileShareResponse
} from "../lib/pdf-api";

const EXPIRY_OPTIONS = [
  { value: 24, label: "24 hours" },
  { value: 72, label: "3 days" },
  { value: 168, label: "7 days" },
  { value: 720, label: "30 days" }
];

function fileSizeLabel(file: File): string {
  if (file.size < 1024 * 1024) {
    return `${Math.max(1, Math.round(file.size / 1024))} KB`;
  }

  return `${(file.size / (1024 * 1024)).toFixed(1)} MB`;
}

export default function SharePdfPage(): React.JSX.Element {
  const [file, setFile] = useState<File | null>(null);
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [expiresInHours, setExpiresInHours] = useState(72);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [share, setShare] = useState<FileShareResponse | null>(null);

  const addFile = (files: FileList | null): void => {
    const selectedFile = files?.[0] ?? null;
    setShare(null);

    if (!selectedFile) {
      return;
    }

    if (!isAllowedFileType(selectedFile, ["application/pdf"])) {
      setNotice("Select a PDF file to share.");
      return;
    }

    setFile(selectedFile);
    setNotice(`${selectedFile.name} is ready to share.`);
  };

  const createShare = async (): Promise<void> => {
    if (!file) {
      setNotice("Select a PDF file first.");
      return;
    }

    try {
      setBusy(true);
      setNotice("Uploading PDF...");
      setShare(null);

      const uploaded = await uploadPdf(file);
      setNotice(email.trim() ? "Creating link and sending email..." : "Creating share link...");

      const createdShare = await createFileShare({
        fileId: uploaded.fileId,
        email: email.trim() || undefined,
        message: message.trim() || undefined,
        expiresInHours
      });

      setShare(createdShare);
      setNotice(createdShare.emailSent ? "Share link created and email sent." : "Share link created.");
    } catch (error) {
      setNotice((error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const copyLink = async (): Promise<void> => {
    if (!share) {
      return;
    }

    await navigator.clipboard.writeText(share.shareUrl);
    setNotice("Share link copied.");
  };

  return (
    <div className="site-shell">
      <SiteHeader active="share-pdf" />

      <main className="feature-page">
        <section className="feature-hero">
          <h1>Share PDF files</h1>
          <p>Create an expiring link for a PDF, copy it, or send it by email from the workspace.</p>

          <UploadDropzone
            label="Select PDF file"
            hint={file ? `${file.name} · ${fileSizeLabel(file)}` : "Choose one PDF file"}
            accept="application/pdf"
            disabled={busy}
            compact
            onFiles={addFile}
          />
        </section>

        <section className="merge-workbench share-workbench">
          <div className="share-workbench__header">
            <span className="share-workbench__icon">
              <Share2 aria-hidden="true" size={22} />
            </span>
            <div>
              <h2>Link settings</h2>
              <p className="small">Shared links expire automatically and only expose this PDF through the generated token.</p>
            </div>
          </div>

          <div className="grid two">
            <div>
              <label htmlFor="share-email">Recipient email</label>
              <input
                id="share-email"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="name@example.com"
                disabled={busy}
              />
            </div>
            <div>
              <label htmlFor="share-expiry">Link expires after</label>
              <select
                id="share-expiry"
                value={expiresInHours}
                onChange={(event) => setExpiresInHours(Number(event.target.value))}
                disabled={busy}
              >
                {EXPIRY_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <label htmlFor="share-message">Email message</label>
          <textarea
            id="share-message"
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            placeholder="Add a short note for the recipient"
            disabled={busy}
          />

          <button className="start-process-btn" type="button" onClick={() => void createShare()} disabled={busy}>
            <Mail aria-hidden="true" size={18} />
            <span>{busy ? "Sharing..." : email.trim() ? "Create link and email" : "Create share link"}</span>
          </button>

          {notice ? <p className={notice.toLowerCase().includes("failed") || notice.toLowerCase().includes("select") ? "error" : "small"}>{notice}</p> : null}

          {share ? (
            <div className="share-result">
              <div>
                <strong>{share.fileName}</strong>
                <span>Expires {new Date(share.expiresAt).toLocaleString()}</span>
              </div>
              <input readOnly value={share.shareUrl} aria-label="Share link" />
              <div className="row-actions">
                <button type="button" onClick={() => void copyLink()}>
                  <Copy aria-hidden="true" size={16} />
                  <span>Copy link</span>
                </button>
                <a className="download" href={share.shareUrl} target="_blank" rel="noreferrer">
                  Open link
                </a>
              </div>
            </div>
          ) : null}
        </section>
      </main>
    </div>
  );
}
