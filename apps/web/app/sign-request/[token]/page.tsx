"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000/api";

type SignatureRequestResponse = {
  id: string;
  token: string;
  status: "pending" | "completed" | "expired" | "cancelled";
  fileName: string;
  expiresAt: string;
  message: string | null;
};

type TaskStatusResponse = {
  id: string;
  status: "queued" | "processing" | "completed" | "failed";
  errorMessage: string | null;
  outputDownloadUrl: string | null;
};

async function jsonFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {})
    }
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Request failed (${response.status})`);
  }

  return response.json() as Promise<T>;
}

async function pollTask(taskId: string): Promise<TaskStatusResponse> {
  let last: TaskStatusResponse | null = null;

  for (let index = 0; index < 120; index += 1) {
    const task = await jsonFetch<TaskStatusResponse>(`/tasks/${taskId}`);
    last = task;

    if (task.status === "completed" || task.status === "failed") {
      return task;
    }

    await new Promise((resolve) => setTimeout(resolve, 2000));
  }

  if (!last) {
    throw new Error("Task polling timed out before first response.");
  }

  return last;
}

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
  const [page, setPage] = useState(1);
  const [x, setX] = useState(50);
  const [y, setY] = useState(50);
  const [width, setWidth] = useState(180);
  const [height, setHeight] = useState(80);
  const [outputName, setOutputName] = useState("signed-request.pdf");
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
        const response = await jsonFetch<SignatureRequestResponse>(`/signature-requests/${token}`);
        setRequest(response);
      } catch (loadError) {
        setError((loadError as Error).message);
      } finally {
        setLoading(false);
      }
    };

    void load();
  }, [token]);

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

      const { taskId } = await jsonFetch<{ taskId: string }>(
        `/signature-requests/${token}/complete`,
        {
          method: "POST",
          body: JSON.stringify({
            signatureDataUrl,
            page,
            x,
            y,
            width,
            height,
            outputName
          })
        }
      );

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
    <main>
      <h1>Complete Signature Request</h1>

      {loading ? <p className="small">Loading signature request...</p> : null}
      {error ? <p className="error">{error}</p> : null}

      {request ? (
        <section className="panel">
          <p className="small">Document: {request.fileName}</p>
          <p className="small">Status: {request.status}</p>
          <p className="small">Expires: {new Date(request.expiresAt).toLocaleString()}</p>
          {request.message ? <p className="small">Message: {request.message}</p> : null}

          {request.status !== "pending" ? (
            <p className="error">This request is no longer pending.</p>
          ) : (
            <>
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

              <div className="grid two">
                <div>
                  <label htmlFor="sig-page">Page</label>
                  <input
                    id="sig-page"
                    type="number"
                    min={1}
                    value={page}
                    onChange={(event) => setPage(Number(event.target.value))}
                  />
                </div>
                <div>
                  <label htmlFor="sig-x">X</label>
                  <input
                    id="sig-x"
                    type="number"
                    min={0}
                    value={x}
                    onChange={(event) => setX(Number(event.target.value))}
                  />
                </div>
                <div>
                  <label htmlFor="sig-y">Y</label>
                  <input
                    id="sig-y"
                    type="number"
                    min={0}
                    value={y}
                    onChange={(event) => setY(Number(event.target.value))}
                  />
                </div>
                <div>
                  <label htmlFor="sig-w">Width</label>
                  <input
                    id="sig-w"
                    type="number"
                    min={1}
                    value={width}
                    onChange={(event) => setWidth(Number(event.target.value))}
                  />
                </div>
                <div>
                  <label htmlFor="sig-h">Height</label>
                  <input
                    id="sig-h"
                    type="number"
                    min={1}
                    value={height}
                    onChange={(event) => setHeight(Number(event.target.value))}
                  />
                </div>
              </div>

              <label htmlFor="sig-output">Output filename</label>
              <input
                id="sig-output"
                value={outputName}
                onChange={(event) => setOutputName(event.target.value)}
              />

              <button type="button" disabled={busy} onClick={onSubmit}>
                {busy ? "Submitting..." : "Sign Document"}
              </button>

              <p className={status.includes("failed") ? "error" : "small"}>{status}</p>
              {downloadUrl ? (
                <a className="download" href={downloadUrl} target="_blank" rel="noreferrer">
                  Download signed document
                </a>
              ) : null}
            </>
          )}
        </section>
      ) : null}
    </main>
  );
}
