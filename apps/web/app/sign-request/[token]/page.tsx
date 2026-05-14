"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import {
  completeSignatureRequest,
  getPdfPagePreviewUrl,
  getSignatureRequest,
  pollTask,
  type SignatureRequestResponse
} from "../../lib/pdf-api";

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Failed to read file."));
    reader.onload = () => resolve(String(reader.result));
    reader.readAsDataURL(file);
  });
}

export default function SignRequestPage(): React.JSX.Element {
  const params = useParams<{ token: string }>();
  const token = params.token;
  const [request, setRequest] = useState<SignatureRequestResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [signatureDataUrl, setSignatureDataUrl] = useState("");
  const [status, setStatus] = useState("");
  const [downloadUrl, setDownloadUrl] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!token) {
      return;
    }

    const load = async (): Promise<void> => {
      try {
        setLoading(true);
        setError("");
        setRequest(await getSignatureRequest(token));
      } catch (loadError) {
        setError((loadError as Error).message);
      } finally {
        setLoading(false);
      }
    };

    void load();
  }, [token]);

  const previewUrl = useMemo(() => {
    if (!request) {
      return "";
    }

    return getPdfPagePreviewUrl(request.fileId, request.page);
  }, [request]);

  const signatureBoxStyle = useMemo((): React.CSSProperties | null => {
    if (!request) {
      return null;
    }

    return {
      left: `${(request.x / request.pageWidth) * 100}%`,
      top: `${((request.pageHeight - (request.y + request.height)) / request.pageHeight) * 100}%`,
      width: `${(request.width / request.pageWidth) * 100}%`,
      height: `${(request.height / request.pageHeight) * 100}%`
    };
  }, [request]);

  const onSubmit = async (): Promise<void> => {
    if (!token) {
      setStatus("Invalid signature token.");
      return;
    }

    if (!signatureDataUrl) {
      setStatus("Upload signature image first.");
      return;
    }

    try {
      setBusy(true);
      setStatus("Submitting signature...");
      setDownloadUrl("");

      const { taskId } = await completeSignatureRequest(token, signatureDataUrl);

      setStatus("Processing signed document...");
      const task = await pollTask(taskId);

      if (task.status === "completed" && task.outputDownloadUrl) {
        setStatus("Document signed successfully.");
        setDownloadUrl(task.outputDownloadUrl);
      } else {
        setStatus(`Signing failed: ${task.errorMessage ?? "unknown error"}`);
      }
    } catch (submitError) {
      setStatus(`Signing failed: ${(submitError as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="feature-page">
      <section className="feature-hero">
        <h1>Complete Signature Request</h1>
        <p>Upload your signature and place it into the marked space on the requested PDF page.</p>
      </section>

      {loading ? <p className="small">Loading signature request...</p> : null}
      {error ? <p className="error">{error}</p> : null}

      {request ? (
        <section className="studio-workspace">
          <aside className="studio-sidebar">
            <div className="studio-panel">
              <div className="studio-panel__eyebrow">Request</div>
              <h2>{request.fileName}</h2>
              <p className="small">Status: {request.status}</p>
              <p className="small">Expires: {new Date(request.expiresAt).toLocaleString()}</p>
              <p className="small">Page: {request.page}</p>
              {request.message ? <p className="small">Message: {request.message}</p> : null}
            </div>

            {request.status !== "pending" ? (
              <div className="studio-panel">
                <p className="error">This request is no longer pending.</p>
              </div>
            ) : (
              <div className="studio-panel">
                <div className="studio-panel__eyebrow">Your Signature</div>
                <label htmlFor="sig-image">Signature image</label>
                <input
                  id="sig-image"
                  type="file"
                  accept="image/png,image/jpeg"
                  onChange={async (event) => {
                    const file = event.target.files?.[0];
                    if (!file) {
                      return;
                    }

                    setSignatureDataUrl(await fileToDataUrl(file));
                  }}
                />

                {signatureDataUrl ? (
                  <img
                    src={signatureDataUrl}
                    alt="Signature preview"
                    style={{ maxWidth: "100%", marginTop: 12, borderRadius: 12 }}
                  />
                ) : null}

                <button type="button" className="studio-primary-button studio-primary-button--full" disabled={busy} onClick={onSubmit}>
                  {busy ? "Submitting..." : "Sign Document"}
                </button>

                <p className={status.includes("failed") ? "error" : "small"}>{status}</p>
                {downloadUrl ? (
                  <a className="download studio-download-link" href={downloadUrl} target="_blank" rel="noreferrer">
                    Download signed document
                  </a>
                ) : null}
              </div>
            )}
          </aside>

          <section className="studio-canvas-area">
            <article className="studio-page-card">
              <div className="studio-page-card__meta">
                <span>Page {request.page}</span>
                <span>Signature area</span>
              </div>
              <div className="studio-page-surface" style={{ height: "auto", cursor: "default" }}>
                <div
                  className="studio-page-paper"
                  style={{
                    aspectRatio: `${request.pageWidth} / ${request.pageHeight}`
                  }}
                >
                  <img
                    className="studio-page-paper__preview"
                    src={previewUrl}
                    alt={`${request.fileName} page ${request.page}`}
                    draggable={false}
                  />
                  {signatureBoxStyle ? (
                    <div className="studio-signature-request-box" style={signatureBoxStyle}>
                      <span>Sign here</span>
                    </div>
                  ) : null}
                </div>
              </div>
            </article>
          </section>
        </section>
      ) : null}
    </main>
  );
}
