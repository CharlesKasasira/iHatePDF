"use client";

import { useMemo, useRef, useState } from "react";
import { SiteHeader } from "../components/site-header";
import {
  getPdfMetadata,
  getPdfPagePreviewUrl,
  pollTask,
  queueExtractPages,
  uploadPdf,
  type PdfFileMetadataResponse
} from "../lib/pdf-api";

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

export default function ExtractPagesPage(): React.JSX.Element {
  const inputRef = useRef<HTMLInputElement>(null);
  const [loadedPdf, setLoadedPdf] = useState<LoadedPdf | null>(null);
  const [selectedPages, setSelectedPages] = useState<number[]>([]);
  const [outputName, setOutputName] = useState("extracted-pages.pdf");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("Upload a PDF, then choose the pages you want to keep.");
  const [progressPercent, setProgressPercent] = useState(0);
  const [downloadUrl, setDownloadUrl] = useState("");

  const selectedSet = useMemo(() => new Set(selectedPages), [selectedPages]);

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
      const initialSelected = metadata.pages.map((page) => page.pageNumber);

      setLoadedPdf({
        fileId: uploaded.fileId,
        fileName: metadata.fileName,
        pageCount: metadata.pageCount,
        pages: metadata.pages
      });
      setSelectedPages(initialSelected);
      setOutputName(`${stripExtension(file.name)}-extracted.pdf`);
      setStatus(`Loaded ${metadata.pageCount} page(s). Click pages to keep or remove them from the extract.`);
    } catch (error) {
      setLoadedPdf(null);
      setSelectedPages([]);
      setStatus(`Failed to inspect PDF: ${(error as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const toggleSelectedPage = (pageNumber: number): void => {
    setSelectedPages((current) => {
      const exists = current.includes(pageNumber);
      const next = exists ? current.filter((item) => item !== pageNumber) : [...current, pageNumber];
      return next.sort((left, right) => left - right);
    });

    setStatus(
      selectedSet.has(pageNumber)
        ? `Removed page ${pageNumber} from the extraction set.`
        : `Added page ${pageNumber} to the extraction set.`
    );
  };

  const onExtractPages = async (): Promise<void> => {
    if (!loadedPdf) {
      setStatus("Upload a PDF first.");
      return;
    }

    if (selectedPages.length === 0) {
      setStatus("Select at least one page to extract.");
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
      setStatus("Queueing page extraction...");
      const { taskId } = await queueExtractPages(
        loadedPdf.fileId,
        selectedPages.map((pageNumber) => String(pageNumber)),
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
        setStatus("Page extraction completed.");
        setDownloadUrl(done.outputDownloadUrl);
      } else {
        setStatus(`Page extraction failed: ${done.errorMessage ?? "unknown error"}`);
      }
    } catch (error) {
      setStatus(`Page extraction failed: ${(error as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="site-shell">
      <SiteHeader active="extract-pages" />

      <main className="feature-page">
        <section className="feature-hero">
          <h1>Extract pages from PDF</h1>
          <p>Preview the real pages, choose the ones you want to keep, and export only those pages.</p>

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
              ? `${loadedPdf.fileName} · ${loadedPdf.pageCount} page(s)`
              : "Upload a PDF to extract pages visually"}
          </p>
        </section>

        <section className="merge-workbench">
          <div className="organize-toolbar">
            <div className="organize-summary">
              <strong>{selectedPages.length}</strong>
              <span>page(s) selected for extraction</span>
            </div>

            <div className="organize-toolbar-actions">
              <button
                type="button"
                className="row-actions-button"
                disabled={busy || !loadedPdf || selectedPages.length === loadedPdf.pageCount}
                onClick={() => {
                  if (!loadedPdf) {
                    return;
                  }
                  setSelectedPages(loadedPdf.pages.map((page) => page.pageNumber));
                  setStatus("Selected all pages for extraction.");
                }}
              >
                Select all
              </button>
              <button
                type="button"
                className="row-actions-button"
                disabled={busy || selectedPages.length === 0}
                onClick={() => {
                  setSelectedPages([]);
                  setStatus("Cleared the extraction set.");
                }}
              >
                Clear
              </button>
            </div>
          </div>

          <div className="grid two">
            <div>
              <label htmlFor="extract-output">Output filename</label>
              <input
                id="extract-output"
                value={outputName}
                onChange={(event) => setOutputName(event.target.value)}
                placeholder="extracted-pages.pdf"
              />
            </div>
            <div className="remove-pages-stat">
              <strong>{selectedPages.length}</strong>
              <span>page(s) will be included in the output</span>
            </div>
          </div>

          {loadedPdf ? (
            <div className="remove-pages-grid">
              {loadedPdf.pages.map((page) => {
                const isSelected = selectedSet.has(page.pageNumber);

                return (
                  <article
                    key={page.pageNumber}
                    className={`remove-pages-card ${isSelected ? "is-selected" : ""}`}
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
                        className={`row-actions-button ${isSelected ? "" : "is-warning"}`}
                        disabled={busy}
                        onClick={() => toggleSelectedPage(page.pageNumber)}
                      >
                        {isSelected ? "Keep" : "Add back"}
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
          ) : null}

          <button
            type="button"
            className="start-process-btn"
            disabled={busy || !loadedPdf || selectedPages.length === 0}
            onClick={onExtractPages}
          >
            {busy ? "Extracting..." : "Extract pages"}
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
              Download extracted PDF
            </a>
          ) : null}
        </section>
      </main>
    </div>
  );
}
