"use client";

import { useState } from "react";
import { SiteHeader } from "../components/site-header";
import { pollTask, queueJpgToPdf, uploadJpg } from "../lib/pdf-api";
import { ReorderableList, ReorderHandle, moveItem } from "../components/reorderable-list";
import { TaskProgressState } from "../components/task-progress-state";
import { UploadDropzone } from "../components/upload-dropzone";

const JPEG_MIME_TYPES = new Set(["image/jpeg", "image/jpg"]);

function isJpgFile(file: File): boolean {
  return JPEG_MIME_TYPES.has(file.type) || /\.jpe?g$/i.test(file.name);
}

function filterJpgFiles(list: FileList | null): File[] {
  if (!list) {
    return [];
  }

  return Array.from(list).filter(isJpgFile);
}

export default function JpgToPdfPage(): React.JSX.Element {
  const [files, setFiles] = useState<File[]>([]);
  const [outputName, setOutputName] = useState("images.pdf");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [progressPercent, setProgressPercent] = useState(0);
  const [downloadUrl, setDownloadUrl] = useState("");

  const addFiles = (incoming: File[]): void => {
    if (incoming.length === 0) {
      setStatus("Only JPG and JPEG files are accepted.");
      return;
    }

    setFiles((current) => [...current, ...incoming]);
    setStatus("");
  };

  const onStartConversion = async (): Promise<void> => {
    if (files.length === 0) {
      setStatus("Select at least one JPG image.");
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
      setStatus("Uploading images...");
      const uploaded = await Promise.all(files.map((file) => uploadJpg(file)));

      setProgressPercent(10);
      setStatus("Queueing JPG to PDF conversion...");
      const { taskId } = await queueJpgToPdf(
        uploaded.map((item) => item.fileId),
        outputName
      );

      setStatus("Waiting for the conversion worker...");
      const done = await pollTask(taskId, {
        onUpdate: (task) => {
          setProgressPercent(task.progressPercent);
          setStatus(task.progressMessage ?? "Processing...");
        }
      });

      if (done.status === "completed" && done.outputDownloadUrl) {
        setDownloadUrl(done.outputDownloadUrl);
        setProgressPercent(100);
        setStatus("JPG to PDF conversion completed.");
      } else {
        setStatus(`Conversion failed: ${done.errorMessage ?? "unknown error"}`);
      }
    } catch (error) {
      setStatus(`Conversion failed: ${(error as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="site-shell">
      <SiteHeader active="jpg-to-pdf" />

      <main className="feature-page">
        <section className="feature-hero">
          <h1>JPG to PDF</h1>
          <p>Combine JPG and JPEG images into one PDF in the exact order you choose.</p>

          <UploadDropzone
            label="Select JPG files"
            hint={files.length > 0 ? `${files.length} images ready to order` : "Drop JPG images here"}
            accept=".jpg,.jpeg,image/jpeg"
            multiple
            disabled={busy}
            onFiles={(fileList) => addFiles(filterJpgFiles(fileList))}
          />
        </section>

        <section className="merge-workbench">
          <h2>Selected images</h2>
          {files.length === 0 ? (
            <div className="tool-empty-state">
              <strong>No images selected</strong>
              <span>Add one or more JPGs. Drag rows to control the page order in the PDF.</span>
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
                      onClick={() => setFiles((current) => moveItem(current, index, index - 1))}
                      disabled={index === 0 || busy}
                    >
                      Up
                    </button>
                    <button
                      type="button"
                      onClick={() => setFiles((current) => moveItem(current, index, index + 1))}
                      disabled={index === files.length - 1 || busy}
                    >
                      Down
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setFiles((current) => current.filter((_, itemIndex) => itemIndex !== index))
                      }
                      disabled={busy}
                    >
                      Remove
                    </button>
                  </div>
                </article>
              )}
            />
          )}

            <label htmlFor="jpg-to-pdf-output">Output filename</label>
            <input
              id="jpg-to-pdf-output"
              value={outputName}
              onChange={(event) => setOutputName(event.target.value)}
              placeholder="images.pdf"
            />

            <button
              type="button"
              className="start-process-btn"
              disabled={busy || files.length === 0}
              onClick={onStartConversion}
            >
              {busy ? "Converting..." : "Convert JPG to PDF"}
            </button>

            <TaskProgressState
              status={status}
              progressPercent={progressPercent}
              downloadUrl={downloadUrl}
              downloadLabel="Download PDF"
            />
          </section>
      </main>
    </div>
  );
}
