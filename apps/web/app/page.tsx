"use client";

import { useMemo, useState } from "react";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000/api";

type TaskStatusResponse = {
  id: string;
  status: "queued" | "processing" | "completed" | "failed";
  type: string;
  errorMessage: string | null;
  outputDownloadUrl: string | null;
  createdAt: string;
  updatedAt: string;
};

type UploadedFileMeta = {
  fileId: string;
  objectKey: string;
  fileName: string;
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
    const errorText = await response.text();
    throw new Error(errorText || `Request failed (${response.status})`);
  }

  return response.json() as Promise<T>;
}

async function uploadPdf(file: File): Promise<UploadedFileMeta> {
  const presign = await jsonFetch<{ objectKey: string; uploadUrl: string }>("/uploads/presign", {
    method: "POST",
    body: JSON.stringify({
      fileName: file.name,
      mimeType: file.type || "application/pdf",
      sizeBytes: file.size
    })
  });

  const uploadResponse = await fetch(presign.uploadUrl, {
    method: "PUT",
    headers: {
      "Content-Type": file.type || "application/pdf"
    },
    body: file
  });

  if (!uploadResponse.ok) {
    throw new Error("Failed to upload file content to object storage.");
  }

  const complete = await jsonFetch<{ fileId: string; objectKey: string }>("/uploads/complete", {
    method: "POST",
    body: JSON.stringify({
      objectKey: presign.objectKey,
      fileName: file.name,
      mimeType: file.type || "application/pdf",
      sizeBytes: file.size
    })
  });

  return { fileId: complete.fileId, objectKey: complete.objectKey, fileName: file.name };
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

function moveItem<T>(items: T[], from: number, to: number): T[] {
  const next = [...items];
  const [removed] = next.splice(from, 1);
  next.splice(to, 0, removed);
  return next;
}

export default function HomePage(): React.JSX.Element {
  const [mergeFiles, setMergeFiles] = useState<File[]>([]);
  const [mergeName, setMergeName] = useState("merged.pdf");
  const [mergeState, setMergeState] = useState<string>("");
  const [mergeDownload, setMergeDownload] = useState<string>("");
  const [mergeBusy, setMergeBusy] = useState(false);

  const [splitFile, setSplitFile] = useState<File | null>(null);
  const [splitRanges, setSplitRanges] = useState("1");
  const [splitPrefix, setSplitPrefix] = useState("split");
  const [splitState, setSplitState] = useState<string>("");
  const [splitDownload, setSplitDownload] = useState<string>("");
  const [splitBusy, setSplitBusy] = useState(false);

  const [signFile, setSignFile] = useState<File | null>(null);
  const [signatureImage, setSignatureImage] = useState<string>("");
  const [signPage, setSignPage] = useState(1);
  const [signX, setSignX] = useState(50);
  const [signY, setSignY] = useState(50);
  const [signWidth, setSignWidth] = useState(180);
  const [signHeight, setSignHeight] = useState(80);
  const [signOutputName, setSignOutputName] = useState("signed.pdf");
  const [signState, setSignState] = useState<string>("");
  const [signDownload, setSignDownload] = useState<string>("");
  const [signBusy, setSignBusy] = useState(false);

  const [requestFile, setRequestFile] = useState<File | null>(null);
  const [requesterEmail, setRequesterEmail] = useState("you@example.com");
  const [signerEmail, setSignerEmail] = useState("signer@example.com");
  const [requestMessage, setRequestMessage] = useState("Please sign this document.");
  const [requestState, setRequestState] = useState<string>("");
  const [requestLink, setRequestLink] = useState<string>("");
  const [requestBusy, setRequestBusy] = useState(false);

  const canSubmitMerge = useMemo(() => mergeFiles.length >= 2 && mergeName.trim().length > 0, [mergeFiles, mergeName]);

  const onMerge = async (): Promise<void> => {
    try {
      setMergeBusy(true);
      setMergeState("Uploading files...");
      setMergeDownload("");

      const uploaded = await Promise.all(mergeFiles.map((file) => uploadPdf(file)));

      setMergeState("Queueing merge...");
      const { taskId } = await jsonFetch<{ taskId: string }>("/tasks/merge", {
        method: "POST",
        body: JSON.stringify({
          fileIds: uploaded.map((item) => item.fileId),
          outputName: mergeName
        })
      });

      setMergeState(`Processing task ${taskId}...`);
      const done = await pollTask(taskId);

      if (done.status === "completed" && done.outputDownloadUrl) {
        setMergeState("Merge completed.");
        setMergeDownload(done.outputDownloadUrl);
      } else {
        setMergeState(`Merge failed: ${done.errorMessage ?? "unknown error"}`);
      }
    } catch (error) {
      setMergeState(`Merge failed: ${(error as Error).message}`);
    } finally {
      setMergeBusy(false);
    }
  };

  const onSplit = async (): Promise<void> => {
    if (!splitFile) {
      setSplitState("Choose a PDF first.");
      return;
    }

    try {
      setSplitBusy(true);
      setSplitDownload("");
      setSplitState("Uploading file...");
      const uploaded = await uploadPdf(splitFile);

      const pageRanges = splitRanges
        .split(",")
        .map((part) => part.trim())
        .filter(Boolean);

      setSplitState("Queueing split...");
      const { taskId } = await jsonFetch<{ taskId: string }>("/tasks/split", {
        method: "POST",
        body: JSON.stringify({
          fileId: uploaded.fileId,
          pageRanges,
          outputPrefix: splitPrefix || "split"
        })
      });

      setSplitState(`Processing task ${taskId}...`);
      const done = await pollTask(taskId);

      if (done.status === "completed" && done.outputDownloadUrl) {
        setSplitState("Split completed.");
        setSplitDownload(done.outputDownloadUrl);
      } else {
        setSplitState(`Split failed: ${done.errorMessage ?? "unknown error"}`);
      }
    } catch (error) {
      setSplitState(`Split failed: ${(error as Error).message}`);
    } finally {
      setSplitBusy(false);
    }
  };

  const onSign = async (): Promise<void> => {
    if (!signFile) {
      setSignState("Choose a PDF first.");
      return;
    }

    if (!signatureImage) {
      setSignState("Upload a signature image (PNG/JPG). ");
      return;
    }

    try {
      setSignBusy(true);
      setSignDownload("");
      setSignState("Uploading file...");
      const uploaded = await uploadPdf(signFile);

      setSignState("Queueing sign operation...");
      const { taskId } = await jsonFetch<{ taskId: string }>("/tasks/sign", {
        method: "POST",
        body: JSON.stringify({
          fileId: uploaded.fileId,
          signatureDataUrl: signatureImage,
          page: signPage,
          x: signX,
          y: signY,
          width: signWidth,
          height: signHeight,
          outputName: signOutputName
        })
      });

      setSignState(`Processing task ${taskId}...`);
      const done = await pollTask(taskId);

      if (done.status === "completed" && done.outputDownloadUrl) {
        setSignState("Sign completed.");
        setSignDownload(done.outputDownloadUrl);
      } else {
        setSignState(`Sign failed: ${done.errorMessage ?? "unknown error"}`);
      }
    } catch (error) {
      setSignState(`Sign failed: ${(error as Error).message}`);
    } finally {
      setSignBusy(false);
    }
  };

  const onCreateRequest = async (): Promise<void> => {
    if (!requestFile) {
      setRequestState("Choose a PDF first.");
      return;
    }

    try {
      setRequestBusy(true);
      setRequestState("Uploading file...");
      setRequestLink("");

      const uploaded = await uploadPdf(requestFile);

      const request = await jsonFetch<{ id: string; token: string }>("/signature-requests", {
        method: "POST",
        body: JSON.stringify({
          fileId: uploaded.fileId,
          requesterEmail,
          signerEmail,
          message: requestMessage
        })
      });

      const signingUrl = `${window.location.origin}/sign-request/${request.token}`;
      setRequestLink(signingUrl);
      setRequestState("Signature request created and email sent.");
    } catch (error) {
      setRequestState(`Failed to create request: ${(error as Error).message}`);
    } finally {
      setRequestBusy(false);
    }
  };

  return (
    <main>
      <h1>iHatePDF</h1>
      <p className="small">Self-hosted open-source PDF merge, split, and sign.</p>

      <div className="grid two">
        <section className="panel">
          <h2>Merge PDF Files</h2>
          <p className="small">Upload multiple PDFs and combine them in your chosen order.</p>

          <label htmlFor="merge-files">PDF files</label>
          <input
            id="merge-files"
            type="file"
            accept="application/pdf"
            multiple
            onChange={(event) => setMergeFiles(Array.from(event.target.files ?? []))}
          />

          <div className="file-list">
            {mergeFiles.map((file, index) => (
              <div className="file-item" key={`${file.name}-${index}`}>
                <span>{`${index + 1}. ${file.name}`}</span>
                <div className="actions">
                  <button
                    type="button"
                    onClick={() => setMergeFiles((prev) => moveItem(prev, index, index - 1))}
                    disabled={index === 0 || mergeBusy}
                  >
                    Up
                  </button>
                  <button
                    type="button"
                    onClick={() => setMergeFiles((prev) => moveItem(prev, index, index + 1))}
                    disabled={index === mergeFiles.length - 1 || mergeBusy}
                  >
                    Down
                  </button>
                </div>
              </div>
            ))}
          </div>

          <label htmlFor="merge-name">Output filename</label>
          <input
            id="merge-name"
            value={mergeName}
            onChange={(event) => setMergeName(event.target.value)}
            placeholder="merged.pdf"
          />

          <button type="button" disabled={!canSubmitMerge || mergeBusy} onClick={onMerge}>
            {mergeBusy ? "Merging..." : "Merge PDFs"}
          </button>
          <p className={mergeState.includes("failed") ? "error" : "small"}>{mergeState}</p>
          {mergeDownload ? (
            <a className="download" href={mergeDownload} target="_blank" rel="noreferrer">
              Download merged PDF
            </a>
          ) : null}
        </section>

        <section className="panel">
          <h2>Split PDF File</h2>
          <p className="small">Extract one or more page ranges. Multiple ranges return a ZIP.</p>

          <label htmlFor="split-file">PDF file</label>
          <input
            id="split-file"
            type="file"
            accept="application/pdf"
            onChange={(event) => setSplitFile(event.target.files?.[0] ?? null)}
          />

          <label htmlFor="split-ranges">Page ranges (comma-separated)</label>
          <input
            id="split-ranges"
            value={splitRanges}
            onChange={(event) => setSplitRanges(event.target.value)}
            placeholder="1,2-4"
          />

          <label htmlFor="split-prefix">Output prefix</label>
          <input
            id="split-prefix"
            value={splitPrefix}
            onChange={(event) => setSplitPrefix(event.target.value)}
            placeholder="split"
          />

          <button type="button" disabled={splitBusy} onClick={onSplit}>
            {splitBusy ? "Splitting..." : "Split PDF"}
          </button>
          <p className={splitState.includes("failed") ? "error" : "small"}>{splitState}</p>
          {splitDownload ? (
            <a className="download" href={splitDownload} target="_blank" rel="noreferrer">
              Download split output
            </a>
          ) : null}
        </section>

        <section className="panel">
          <h2>Sign PDF</h2>
          <p className="small">Apply a signature image to the selected page and coordinates.</p>

          <label htmlFor="sign-file">PDF file</label>
          <input
            id="sign-file"
            type="file"
            accept="application/pdf"
            onChange={(event) => setSignFile(event.target.files?.[0] ?? null)}
          />

          <label htmlFor="signature-image">Signature image (PNG or JPG)</label>
          <input
            id="signature-image"
            type="file"
            accept="image/png,image/jpeg"
            onChange={async (event) => {
              const file = event.target.files?.[0];
              if (!file) {
                return;
              }
              const dataUrl = await fileToDataUrl(file);
              setSignatureImage(dataUrl);
            }}
          />

          <div className="grid two">
            <div>
              <label htmlFor="sign-page">Page</label>
              <input
                id="sign-page"
                type="number"
                min={1}
                value={signPage}
                onChange={(event) => setSignPage(Number(event.target.value))}
              />
            </div>
            <div>
              <label htmlFor="sign-x">X</label>
              <input
                id="sign-x"
                type="number"
                min={0}
                value={signX}
                onChange={(event) => setSignX(Number(event.target.value))}
              />
            </div>
            <div>
              <label htmlFor="sign-y">Y</label>
              <input
                id="sign-y"
                type="number"
                min={0}
                value={signY}
                onChange={(event) => setSignY(Number(event.target.value))}
              />
            </div>
            <div>
              <label htmlFor="sign-width">Width</label>
              <input
                id="sign-width"
                type="number"
                min={1}
                value={signWidth}
                onChange={(event) => setSignWidth(Number(event.target.value))}
              />
            </div>
            <div>
              <label htmlFor="sign-height">Height</label>
              <input
                id="sign-height"
                type="number"
                min={1}
                value={signHeight}
                onChange={(event) => setSignHeight(Number(event.target.value))}
              />
            </div>
          </div>

          <label htmlFor="sign-output">Output filename</label>
          <input
            id="sign-output"
            value={signOutputName}
            onChange={(event) => setSignOutputName(event.target.value)}
            placeholder="signed.pdf"
          />

          <button type="button" disabled={signBusy} onClick={onSign}>
            {signBusy ? "Signing..." : "Sign PDF"}
          </button>
          <p className={signState.includes("failed") ? "error" : "small"}>{signState}</p>
          {signDownload ? (
            <a className="download" href={signDownload} target="_blank" rel="noreferrer">
              Download signed PDF
            </a>
          ) : null}
        </section>

        <section className="panel">
          <h2>Request Signature</h2>
          <p className="small">Send secure link to signer. They sign in browser.</p>

          <label htmlFor="request-file">PDF file</label>
          <input
            id="request-file"
            type="file"
            accept="application/pdf"
            onChange={(event) => setRequestFile(event.target.files?.[0] ?? null)}
          />

          <label htmlFor="requester-email">Requester email</label>
          <input
            id="requester-email"
            type="email"
            value={requesterEmail}
            onChange={(event) => setRequesterEmail(event.target.value)}
          />

          <label htmlFor="signer-email">Signer email</label>
          <input
            id="signer-email"
            type="email"
            value={signerEmail}
            onChange={(event) => setSignerEmail(event.target.value)}
          />

          <label htmlFor="request-message">Message</label>
          <textarea
            id="request-message"
            value={requestMessage}
            onChange={(event) => setRequestMessage(event.target.value)}
          />

          <button type="button" disabled={requestBusy} onClick={onCreateRequest}>
            {requestBusy ? "Creating request..." : "Create Signature Request"}
          </button>
          <p className={requestState.includes("Failed") ? "error" : "small"}>{requestState}</p>
          {requestLink ? (
            <p className="success">
              Signing link: <a className="download" href={requestLink}>{requestLink}</a>
            </p>
          ) : null}
        </section>
      </div>
    </main>
  );
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Failed to read file."));
    reader.onload = () => resolve(String(reader.result));
    reader.readAsDataURL(file);
  });
}
