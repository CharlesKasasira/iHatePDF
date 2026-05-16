"use client";

import { Download, FileText } from "lucide-react";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { SiteHeader } from "../../components/site-header";
import { getSharedFile, type SharedFileMetadataResponse } from "../../lib/pdf-api";

function bytesLabel(value: string): string {
  const bytes = Number(value);
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "PDF file";
  }

  if (bytes < 1024 * 1024) {
    return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  }

  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function SharedPdfPage(): React.JSX.Element {
  const params = useParams<{ token: string }>();
  const token = params.token;
  const [file, setFile] = useState<SharedFileMetadataResponse | null>(null);
  const [status, setStatus] = useState("Loading shared PDF...");

  useEffect(() => {
    if (!token) {
      return;
    }

    let cancelled = false;

    async function load(): Promise<void> {
      try {
        const sharedFile = await getSharedFile(token);
        if (!cancelled) {
          setFile(sharedFile);
          setStatus("");
        }
      } catch (error) {
        if (!cancelled) {
          setStatus((error as Error).message);
        }
      }
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, [token]);

  return (
    <div className="site-shell">
      <SiteHeader />

      <main className="feature-page">
        <section className="feature-hero">
          <h1>Shared PDF</h1>
          <p>Download the PDF from this expiring shared link.</p>
        </section>

        <section className="merge-workbench shared-file-card">
          {file ? (
            <>
              <span className="share-workbench__icon">
                <FileText aria-hidden="true" size={24} />
              </span>
              <div>
                <h2>{file.fileName}</h2>
                <p className="small">
                  {bytesLabel(file.sizeBytes)} · Expires {new Date(file.expiresAt).toLocaleString()}
                </p>
              </div>
              <a className="download shared-file-card__download" href={file.downloadUrl}>
                <Download aria-hidden="true" size={18} />
                <span>Download PDF</span>
              </a>
            </>
          ) : (
            <div className="tool-empty-state">
              <strong>{status || "Shared file unavailable."}</strong>
              <span>{token ? "Ask the sender for a fresh link if this one has expired." : "Checking the link..."}</span>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
