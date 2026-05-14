"use client";

import { useRef, useState } from "react";
import { SiteHeader } from "../components/site-header";
import { getPdfMetadata, pollTask, queueOrganizePdf, uploadPdf } from "../lib/pdf-api";

type LoadedPdf = {
  fileId: string;
  fileName: string;
  pageCount: number;
};

function stripExtension(fileName: string): string {
  const dotIndex = fileName.lastIndexOf(".");
  return dotIndex > 0 ? fileName.slice(0, dotIndex) : fileName;
}

function moveItem(items: number[], from: number, to: number): number[] {
  const next = [...items];
  const [removed] = next.splice(from, 1);
  next.splice(to, 0, removed);
  return next;
}

function duplicateItem(items: number[], index: number): number[] {
  const next = [...items];
  next.splice(index + 1, 0, items[index]);
  return next;
}

function removeItem(items: number[], index: number): number[] {
  return items.filter((_, itemIndex) => itemIndex !== index);
}

function parsePageOrderInput(value: string, maxPage: number): number[] {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error("Enter at least one page number.");
  }

  const pageOrder = trimmed
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => {
      const pageNumber = Number(item);
      if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > maxPage) {
        throw new Error(`Page ${item} is out of range. The PDF has ${maxPage} page(s).`);
      }
      return pageNumber;
    });

  if (pageOrder.length === 0) {
    throw new Error("Enter at least one page number.");
  }

  return pageOrder;
}

function pageOrderText(pageOrder: number[]): string {
  return pageOrder.join(", ");
}

export default function OrganizePdfPage(): React.JSX.Element {
  const inputRef = useRef<HTMLInputElement>(null);
  const [loadedPdf, setLoadedPdf] = useState<LoadedPdf | null>(null);
  const [pageOrder, setPageOrder] = useState<number[]>([]);
  const [pageOrderInput, setPageOrderInput] = useState("");
  const [outputName, setOutputName] = useState("organized.pdf");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("Upload a PDF to arrange, duplicate, or remove pages.");
  const [progressPercent, setProgressPercent] = useState(0);
  const [downloadUrl, setDownloadUrl] = useState("");

  const syncPageOrder = (nextOrder: number[]): void => {
    setPageOrder(nextOrder);
    setPageOrderInput(pageOrderText(nextOrder));
  };

  const onSelectFile = async (file: File | null): Promise<void> => {
    if (!file) {
      return;
    }

    try {
      setBusy(true);
      setDownloadUrl("");
      setProgressPercent(0);
      setStatus("Uploading PDF for page inspection...");
      const uploaded = await uploadPdf(file);
      const metadata = await getPdfMetadata(uploaded.fileId);
      const initialOrder = Array.from({ length: metadata.pageCount }, (_, index) => index + 1);

      setLoadedPdf({
        fileId: uploaded.fileId,
        fileName: metadata.fileName,
        pageCount: metadata.pageCount
      });
      syncPageOrder(initialOrder);
      setOutputName(`${stripExtension(file.name)}-organized.pdf`);
      setStatus(`Loaded ${metadata.pageCount} page(s). Reorder, duplicate, or remove pages below.`);
    } catch (error) {
      setLoadedPdf(null);
      setPageOrder([]);
      setPageOrderInput("");
      setStatus(`Failed to inspect PDF: ${(error as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const applyManualOrder = (): void => {
    if (!loadedPdf) {
      setStatus("Upload a PDF first.");
      return;
    }

    try {
      const parsed = parsePageOrderInput(pageOrderInput, loadedPdf.pageCount);
      syncPageOrder(parsed);
      setStatus(`Applied a ${parsed.length}-slot page order.`);
    } catch (error) {
      setStatus((error as Error).message);
    }
  };

  const onOrganize = async (): Promise<void> => {
    if (!loadedPdf) {
      setStatus("Upload a PDF first.");
      return;
    }

    if (pageOrder.length === 0) {
      setStatus("Keep at least one page in the organized PDF.");
      return;
    }

    if (!outputName.trim()) {
      setStatus("Set an output file name.");
      return;
    }

    try {
      setBusy(true);
      setDownloadUrl("");
      setProgressPercent(10);
      setStatus("Queueing organization...");
      const { taskId } = await queueOrganizePdf(loadedPdf.fileId, pageOrder, outputName.trim());

      const done = await pollTask(taskId, {
        onUpdate: (task) => {
          setProgressPercent(task.progressPercent);
          setStatus(task.progressMessage ?? "Processing...");
        }
      });

      if (done.status === "completed" && done.outputDownloadUrl) {
        setProgressPercent(100);
        setStatus("PDF organization completed.");
        setDownloadUrl(done.outputDownloadUrl);
      } else {
        setStatus(`PDF organization failed: ${done.errorMessage ?? "unknown error"}`);
      }
    } catch (error) {
      setStatus(`PDF organization failed: ${(error as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="site-shell">
      <SiteHeader active="organize-pdf" />

      <main className="feature-page">
        <section className="feature-hero">
          <h1>Organize PDF</h1>
          <p>Reorder pages, duplicate the ones you need, and drop the rest before exporting a new PDF.</p>

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
              onChange={(event) => {
                void onSelectFile(event.target.files?.[0] ?? null);
                event.target.value = "";
              }}
            />
          </div>
          <p className="drop-hint">
            {loadedPdf
              ? `${loadedPdf.fileName} · ${loadedPdf.pageCount} original page(s)`
              : "Upload a PDF to start organizing its page order"}
          </p>
        </section>

        <section className="merge-workbench">
          <div className="organize-toolbar">
            <div className="organize-summary">
              <strong>{pageOrder.length || 0}</strong>
              <span>page slot(s) in the export order</span>
            </div>

            <div className="organize-toolbar-actions">
              <button
                type="button"
                className="row-actions-button"
                disabled={busy || !loadedPdf}
                onClick={() => {
                  if (!loadedPdf) {
                    return;
                  }
                  const reset = Array.from({ length: loadedPdf.pageCount }, (_, index) => index + 1);
                  syncPageOrder(reset);
                  setStatus("Reset the page order to the original document.");
                }}
              >
                Reset
              </button>
              <button
                type="button"
                className="row-actions-button"
                disabled={busy || pageOrder.length < 2}
                onClick={() => {
                  const reversed = [...pageOrder].reverse();
                  syncPageOrder(reversed);
                  setStatus("Reversed the current page order.");
                }}
              >
                Reverse
              </button>
            </div>
          </div>

          <label htmlFor="organize-order">Page order</label>
          <textarea
            id="organize-order"
            value={pageOrderInput}
            onChange={(event) => setPageOrderInput(event.target.value)}
            placeholder="1, 2, 3"
          />
          <div className="organize-inline-actions">
            <button
              type="button"
              className="row-actions-button"
              disabled={busy || !loadedPdf}
              onClick={applyManualOrder}
            >
              Apply typed order
            </button>
            <span className="small">
              Use comma-separated page numbers. Duplicates are allowed, for example `1, 1, 4, 2`.
            </span>
          </div>

          <label htmlFor="organize-output">Output filename</label>
          <input
            id="organize-output"
            value={outputName}
            onChange={(event) => setOutputName(event.target.value)}
            placeholder="organized.pdf"
          />

          <div className="organize-sequence">
            {pageOrder.map((pageNumber, index) => (
              <article key={`${pageNumber}-${index}`} className="organize-page-card">
                <div>
                  <strong>Slot {index + 1}</strong>
                  <p>Page {pageNumber}</p>
                </div>
                <div className="row-actions">
                  <button
                    type="button"
                    disabled={busy || index === 0}
                    onClick={() => syncPageOrder(moveItem(pageOrder, index, index - 1))}
                  >
                    Up
                  </button>
                  <button
                    type="button"
                    disabled={busy || index === pageOrder.length - 1}
                    onClick={() => syncPageOrder(moveItem(pageOrder, index, index + 1))}
                  >
                    Down
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => syncPageOrder(duplicateItem(pageOrder, index))}
                  >
                    Duplicate
                  </button>
                  <button
                    type="button"
                    disabled={busy || pageOrder.length === 1}
                    onClick={() => syncPageOrder(removeItem(pageOrder, index))}
                  >
                    Remove
                  </button>
                </div>
              </article>
            ))}
          </div>

          <button
            type="button"
            className="start-process-btn"
            disabled={busy || !loadedPdf || pageOrder.length === 0}
            onClick={onOrganize}
          >
            {busy ? "Organizing..." : "Organize PDF"}
          </button>

          {busy || progressPercent > 0 ? (
            <div className="batch-task-progress">
              <div className="batch-task-progress-row">
                <span>{status}</span>
                <strong>{progressPercent}%</strong>
              </div>
              <div className="task-progress-rail">
                <span style={{ width: `${progressPercent}%` }} />
              </div>
            </div>
          ) : null}

          <p
            className={
              status.toLowerCase().includes("failed") || status.toLowerCase().includes("error")
                ? "error"
                : "small"
            }
          >
            {status}
          </p>
          {downloadUrl ? (
            <a className="download" href={downloadUrl} target="_blank" rel="noreferrer">
              Download organized PDF
            </a>
          ) : null}
        </section>
      </main>
    </div>
  );
}
