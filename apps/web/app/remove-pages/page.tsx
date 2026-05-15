"use client";

import { useMemo, useState } from "react";
import { SiteHeader } from "../components/site-header";
import {
  getPdfMetadata,
  getPdfPagePreviewUrl,
  pollTask,
  queueRemovePages,
  uploadPdf,
  type PdfFileMetadataResponse
} from "../lib/pdf-api";
import { TaskProgressState } from "../components/task-progress-state";
import { UploadDropzone } from "../components/upload-dropzone";

type LoadedPdf = {
  fileId: string;
  fileName: string;
  pageCount: number;
  pages: PdfFileMetadataResponse["pages"];
};

function stripExtension(fileName: string): string {
  const dotIndex = fileName.lastIndexOf(".");
  return dotIndex > 0 ? fileName.slice(0, dotIndex) : fileName;
}

export default function RemovePagesPage(): React.JSX.Element {
  const [loadedPdf, setLoadedPdf] = useState<LoadedPdf | null>(null);
  const [removedPages, setRemovedPages] = useState<number[]>([]);
  const [outputName, setOutputName] = useState("pages-removed.pdf");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("Upload a PDF, then remove pages directly from the page grid.");
  const [progressPercent, setProgressPercent] = useState(0);
  const [downloadUrl, setDownloadUrl] = useState("");

  const removedSet = useMemo(() => new Set(removedPages), [removedPages]);
  const remainingCount = loadedPdf ? loadedPdf.pageCount - removedPages.length : 0;

  const onSelectFile = async (file: File | null): Promise<void> => {
    if (!file) {
      return;
    }

    try {
      setBusy(true);
      setDownloadUrl("");
      setProgressPercent(0);
      setStatus("Uploading PDF for page preview...");
      const uploaded = await uploadPdf(file);
      const metadata = await getPdfMetadata(uploaded.fileId);

      setLoadedPdf({
        fileId: uploaded.fileId,
        fileName: metadata.fileName,
        pageCount: metadata.pageCount,
        pages: metadata.pages
      });
      setRemovedPages([]);
      setOutputName(`${stripExtension(file.name)}-pages-removed.pdf`);
      setStatus(`Loaded ${metadata.pageCount} page(s). Click delete on any page you want to remove.`);
    } catch (error) {
      setLoadedPdf(null);
      setRemovedPages([]);
      setStatus(`Failed to inspect PDF: ${(error as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const toggleRemovedPage = (pageNumber: number): void => {
    setRemovedPages((current) => {
      const exists = current.includes(pageNumber);
      const next = exists ? current.filter((item) => item !== pageNumber) : [...current, pageNumber];
      return next.sort((left, right) => left - right);
    });

    setStatus(
      removedSet.has(pageNumber)
        ? `Restored page ${pageNumber} to the output.`
        : `Marked page ${pageNumber} for removal.`
    );
  };

  const onRemovePages = async (): Promise<void> => {
    if (!loadedPdf) {
      setStatus("Upload a PDF first.");
      return;
    }

    if (removedPages.length === 0) {
      setStatus("Select at least one page to remove.");
      return;
    }

    if (remainingCount <= 0) {
      setStatus("Keep at least one page in the output PDF.");
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
      setStatus("Queueing page removal...");
      const { taskId } = await queueRemovePages(
        loadedPdf.fileId,
        removedPages.map((pageNumber) => String(pageNumber)),
        outputName.trim()
      );

      const done = await pollTask(taskId, {
        onUpdate: (task) => {
          setProgressPercent(task.progressPercent);
          setStatus(task.progressMessage ?? "Processing...");
        }
      });

      if (done.status === "completed" && done.outputDownloadUrl) {
        setProgressPercent(100);
        setStatus("Page removal completed.");
        setDownloadUrl(done.outputDownloadUrl);
      } else {
        setStatus(`Page removal failed: ${done.errorMessage ?? "unknown error"}`);
      }
    } catch (error) {
      setStatus(`Page removal failed: ${(error as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="site-shell">
      <SiteHeader active="remove-pages" />

      <main className="feature-page">
        <section className="feature-hero">
          <h1>Remove pages from PDF</h1>
          <p>Preview the real pages, mark the ones you do not want, and export the cleaned document.</p>

          <UploadDropzone
            label="Select PDF file"
            hint={
              loadedPdf
                ? `${loadedPdf.fileName} · ${loadedPdf.pageCount} page(s)`
                : "Upload or drop a PDF to remove pages visually"
            }
            accept="application/pdf"
            compact
            disabled={busy}
            onFiles={(files) => void onSelectFile(files?.[0] ?? null)}
          />
        </section>

        <section className="merge-workbench">
          <div className="organize-toolbar">
            <div className="organize-summary">
              <strong>{removedPages.length}</strong>
              <span>page(s) marked for removal</span>
            </div>

            <div className="organize-toolbar-actions">
              <button
                type="button"
                className="row-actions-button"
                disabled={busy || !loadedPdf || removedPages.length === 0}
                onClick={() => {
                  setRemovedPages([]);
                  setStatus("Cleared all removed page marks.");
                }}
              >
                Reset
              </button>
            </div>
          </div>

          <div className="grid two">
            <div>
              <label htmlFor="remove-output">Output filename</label>
              <input
                id="remove-output"
                value={outputName}
                onChange={(event) => setOutputName(event.target.value)}
                placeholder="pages-removed.pdf"
              />
            </div>
            <div className="remove-pages-stat">
              <strong>{remainingCount}</strong>
              <span>page(s) will remain in the output</span>
            </div>
          </div>

          {loadedPdf ? (
            <div className="remove-pages-grid">
              {loadedPdf.pages.map((page) => {
                const isRemoved = removedSet.has(page.pageNumber);

                return (
                  <article
                    key={page.pageNumber}
                    className={`remove-pages-card ${isRemoved ? "is-removed" : ""}`}
                  >
                    <div className="remove-pages-card__topline">
                      <div>
                        <strong>Page {page.pageNumber}</strong>
                        <p>
                          {Math.round(page.width)} x {Math.round(page.height)} pt
                        </p>
                      </div>
                      <button
                        type="button"
                        className={`row-actions-button ${isRemoved ? "is-warning" : ""}`}
                        disabled={busy}
                        onClick={() => toggleRemovedPage(page.pageNumber)}
                      >
                        {isRemoved ? "Restore" : "Delete"}
                      </button>
                    </div>

                    <div className="remove-pages-preview">
                      <img
                        src={getPdfPagePreviewUrl(loadedPdf.fileId, page.pageNumber)}
                        alt={`${loadedPdf.fileName} page ${page.pageNumber}`}
                        draggable={false}
                      />
                    </div>
                  </article>
                );
              })}
            </div>
          ) : (
            <div className="tool-empty-state">
              <strong>No preview loaded</strong>
              <span>Upload a PDF to preview pages and mark removals visually.</span>
            </div>
          )}

          <button
            type="button"
            className="start-process-btn"
            disabled={busy || !loadedPdf || removedPages.length === 0 || remainingCount <= 0}
            onClick={onRemovePages}
          >
            {busy ? "Removing..." : "Remove pages"}
          </button>

          <TaskProgressState
            status={status}
            progressPercent={progressPercent}
            downloadUrl={downloadUrl}
            downloadLabel="Download updated PDF"
          />
        </section>
      </main>
    </div>
  );
}
