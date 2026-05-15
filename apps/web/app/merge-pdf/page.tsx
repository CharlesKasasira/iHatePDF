"use client";

import { useState } from "react";
import { SiteHeader } from "../components/site-header";
import { pollTask, queueMerge, uploadPdf } from "../lib/pdf-api";
import { ReorderableList, ReorderHandle, moveItem } from "../components/reorderable-list";
import { TaskProgressState } from "../components/task-progress-state";
import { UploadDropzone } from "../components/upload-dropzone";

function filterPdfFiles(list: FileList | null): File[] {
  if (!list) {
    return [];
  }

  return Array.from(list).filter((file) => file.type === "application/pdf");
}

export default function MergePage(): React.JSX.Element {
  const [files, setFiles] = useState<File[]>([]);
  const [outputName, setOutputName] = useState("merged.pdf");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [progressPercent, setProgressPercent] = useState(0);
  const [downloadUrl, setDownloadUrl] = useState("");

  const addFiles = (incoming: File[]): void => {
    if (incoming.length === 0) {
      setStatus("Only PDF files are accepted.");
      return;
    }

    setFiles((prev) => [...prev, ...incoming]);
    setStatus("");
  };

  const onStartMerge = async (): Promise<void> => {
    if (files.length < 2) {
      setStatus("Select at least two PDF files to merge.");
      return;
    }

    if (!outputName.trim()) {
      setStatus("Set an output file name.");
      return;
    }

    try {
      setBusy(true);
      setDownloadUrl("");
      setProgressPercent(4);
      setStatus("Uploading files...");
      const uploaded = await Promise.all(files.map((file) => uploadPdf(file)));

      setProgressPercent(10);
      setStatus("Queueing merge...");
      const { taskId } = await queueMerge(
        uploaded.map((item) => item.fileId),
        outputName
      );

      setStatus("Waiting for the merge worker...");
      const done = await pollTask(taskId, {
        onUpdate: (task) => {
          setProgressPercent(task.progressPercent);
          setStatus(task.progressMessage ?? "Processing...");
        }
      });

      if (done.status === "completed" && done.outputDownloadUrl) {
        setDownloadUrl(done.outputDownloadUrl);
        setProgressPercent(100);
        setStatus("Merge completed.");
      } else {
        setStatus(`Merge failed: ${done.errorMessage ?? "unknown error"}`);
      }
    } catch (error) {
      setStatus(`Merge failed: ${(error as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="site-shell">
      <SiteHeader active="merge" />

      <main className="feature-page">
        <section className="feature-hero">
          <h1>Merge PDF files</h1>
          <p>Combine PDFs in the order you want with the easiest PDF merger available.</p>

          <UploadDropzone
            label="Select PDF files"
            hint={files.length > 0 ? `${files.length} PDFs ready to order` : "Drop PDFs here"}
            accept="application/pdf"
            multiple
            compact
            disabled={busy}
            onFiles={(fileList) => addFiles(filterPdfFiles(fileList))}
          />
        </section>

        <section className="merge-workbench">
          <h2>Selected files</h2>
          {files.length === 0 ? (
            <div className="tool-empty-state">
              <strong>No PDFs selected</strong>
              <span>Add at least two PDFs. Drag rows to set the merge order before exporting.</span>
            </div>
          ) : (
            <ReorderableList
              items={files}
              onReorder={setFiles}
              className="picked-files"
              disabled={busy}
              keyForItem={(file, index) => `${file.name}-${file.lastModified}-${index}`}
              renderItem={(file, index) => (
                <article className="picked-file-row">
                  <ReorderHandle />
                  <div>
                    <strong>{index + 1}.</strong> {file.name}
                  </div>
                  <div className="row-actions">
                    <button
                      type="button"
                      onClick={() => setFiles((prev) => moveItem(prev, index, index - 1))}
                      disabled={index === 0 || busy}
                    >
                      Up
                    </button>
                    <button
                      type="button"
                      onClick={() => setFiles((prev) => moveItem(prev, index, index + 1))}
                      disabled={index === files.length - 1 || busy}
                    >
                      Down
                    </button>
                    <button
                      type="button"
                      onClick={() => setFiles((prev) => prev.filter((_, itemIndex) => itemIndex !== index))}
                      disabled={busy}
                    >
                      Remove
                    </button>
                  </div>
                </article>
              )}
            />
          )}

            <label htmlFor="merge-output">Output filename</label>
            <input
              id="merge-output"
              value={outputName}
              onChange={(event) => setOutputName(event.target.value)}
              placeholder="merged.pdf"
            />

            <button
              type="button"
              className="start-process-btn"
              disabled={busy || files.length < 2}
              onClick={onStartMerge}
            >
              {busy ? "Merging..." : "Merge PDF"}
            </button>

            <TaskProgressState
              status={status}
              progressPercent={progressPercent}
              downloadUrl={downloadUrl}
              downloadLabel="Download merged PDF"
            />
          </section>
      </main>
    </div>
  );
}
