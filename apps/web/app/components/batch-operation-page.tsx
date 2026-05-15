"use client";

import { startTransition, useState } from "react";
import { SiteHeader } from "./site-header";
import { isAllowedFileType, pollTask, type TaskStatusResponse, uploadFile } from "../lib/pdf-api";
import { TaskProgressState } from "./task-progress-state";
import { UploadDropzone } from "./upload-dropzone";

type BatchTaskPhase =
  | "idle"
  | "uploading"
  | "queueing"
  | "queued"
  | "processing"
  | "completed"
  | "failed";

type BatchTaskItem = {
  id: string;
  file: File;
  outputName: string;
  phase: BatchTaskPhase;
  progressPercent: number;
  progressMessage: string;
  downloadUrl: string;
  errorMessage: string;
};

type ExtraInputConfig = {
  id: string;
  label: string;
  placeholder: string;
  type?: "text" | "password";
  defaultValue?: string;
  validate?: (value: string) => string | null;
};

type BatchOperationPageProps = {
  active: React.ComponentProps<typeof SiteHeader>["active"];
  title: string;
  description: string;
  selectLabel: string;
  emptyHint: string;
  accept: string;
  allowedMimeTypes?: readonly string[];
  startLabel: string;
  runningLabel: string;
  downloadLabel: string;
  helperText: string;
  deriveOutputName: (file: File) => string;
  queueTask: (fileId: string, outputName: string, extraValue: string) => Promise<{ taskId: string }>;
  extraInput?: ExtraInputConfig;
};

const PARALLEL_LIMIT = 2;

function createItemId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function stripExtension(fileName: string): string {
  const dotIndex = fileName.lastIndexOf(".");
  return dotIndex > 0 ? fileName.slice(0, dotIndex) : fileName;
}

function taskMessage(task: TaskStatusResponse): string {
  if (task.progressMessage) {
    return task.progressMessage;
  }

  if (task.status === "queued") {
    return "Waiting in queue...";
  }

  if (task.status === "processing") {
    return "Processing...";
  }

  if (task.status === "completed") {
    return "Completed";
  }

  return task.errorMessage ?? "Task failed.";
}

function statusTone(item: BatchTaskItem): "error" | "success" | "neutral" {
  if (item.phase === "failed") {
    return "error";
  }

  if (item.phase === "completed") {
    return "success";
  }

  return "neutral";
}

export function BatchOperationPage({
  active,
  title,
  description,
  selectLabel,
  emptyHint,
  accept,
  allowedMimeTypes,
  startLabel,
  runningLabel,
  downloadLabel,
  helperText,
  deriveOutputName,
  queueTask,
  extraInput
}: BatchOperationPageProps): React.JSX.Element {
  const [items, setItems] = useState<BatchTaskItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [extraValue, setExtraValue] = useState(extraInput?.defaultValue ?? "");

  const updateItem = (
    itemId: string,
    updater: Partial<BatchTaskItem> | ((item: BatchTaskItem) => BatchTaskItem)
  ): void => {
    setItems((current) =>
      current.map((item) => {
        if (item.id !== itemId) {
          return item;
        }

        return typeof updater === "function" ? updater(item) : { ...item, ...updater };
      })
    );
  };

  const addFiles = (fileList: FileList | null): void => {
    const selectedFiles = Array.from(fileList ?? []);
    if (selectedFiles.length === 0) {
      return;
    }

    const accepted = selectedFiles.filter((file) => isAllowedFileType(file, allowedMimeTypes));
    if (accepted.length === 0) {
      setNotice("The selected files do not match this tool.");
      return;
    }

    const rejectedCount = selectedFiles.length - accepted.length;
    startTransition(() => {
      setItems((current) => [
        ...current,
        ...accepted.map((file) => ({
          id: createItemId(),
          file,
          outputName: deriveOutputName(file),
          phase: "idle" as const,
          progressPercent: 0,
          progressMessage: "Ready to upload",
          downloadUrl: "",
          errorMessage: ""
        }))
      ]);
    });

    setNotice(
      rejectedCount > 0
        ? `${accepted.length} file(s) added. ${rejectedCount} file(s) were skipped.`
        : `${accepted.length} file(s) added to the batch.`
    );
  };

  const runItem = async (item: BatchTaskItem): Promise<void> => {
    updateItem(item.id, {
      phase: "uploading",
      progressPercent: 4,
      progressMessage: "Uploading file...",
      errorMessage: "",
      downloadUrl: ""
    });

    const uploaded = await uploadFile(item.file, allowedMimeTypes);

    updateItem(item.id, {
      phase: "queueing",
      progressPercent: 10,
      progressMessage: "Queueing task..."
    });

    const { taskId } = await queueTask(uploaded.fileId, item.outputName.trim(), extraValue.trim());

    updateItem(item.id, {
      phase: "queued",
      progressPercent: 12,
      progressMessage: "Waiting for a worker..."
    });

    const completedTask = await pollTask(taskId, {
      onUpdate: (task) => {
        updateItem(item.id, {
          phase:
            task.status === "completed"
              ? "completed"
              : task.status === "failed"
                ? "failed"
                : task.status === "queued"
                  ? "queued"
                  : "processing",
          progressPercent: task.progressPercent,
          progressMessage: taskMessage(task),
          errorMessage: task.errorMessage ?? "",
          downloadUrl: task.outputDownloadUrl ?? ""
        });
      }
    });

    if (completedTask.status === "failed") {
      throw new Error(completedTask.errorMessage ?? "The task failed.");
    }
  };

  const startBatch = async (): Promise<void> => {
    const pendingItems = items.filter((item) => item.phase === "idle" || item.phase === "failed");
    if (pendingItems.length === 0) {
      setNotice("Add files to the batch first.");
      return;
    }

    const emptyOutput = pendingItems.find((item) => !item.outputName.trim());
    if (emptyOutput) {
      setNotice(`Set an output filename for ${emptyOutput.file.name}.`);
      return;
    }

    if (extraInput?.validate) {
      const extraError = extraInput.validate(extraValue.trim());
      if (extraError) {
        setNotice(extraError);
        return;
      }
    }

    setBusy(true);
    setNotice(`Processing ${pendingItems.length} file(s) with live progress updates.`);

    let nextIndex = 0;
    const workers = Array.from({ length: Math.min(PARALLEL_LIMIT, pendingItems.length) }, () =>
      (async () => {
        while (nextIndex < pendingItems.length) {
          const currentIndex = nextIndex;
          nextIndex += 1;
          const currentItem = pendingItems[currentIndex];

          try {
            await runItem(currentItem);
          } catch (error) {
            updateItem(currentItem.id, {
              phase: "failed",
              errorMessage: (error as Error).message,
              progressMessage: (error as Error).message
            });
          }
        }
      })()
    );

    try {
      await Promise.all(workers);
      setNotice("Batch run finished.");
    } finally {
      setBusy(false);
    }
  };

  const completedCount = items.filter((item) => item.phase === "completed").length;
  const failedCount = items.filter((item) => item.phase === "failed").length;
  const activeCount = items.filter(
    (item) =>
      item.phase === "uploading" ||
      item.phase === "queueing" ||
      item.phase === "queued" ||
      item.phase === "processing"
  ).length;
  const averageProgress =
    items.length > 0
      ? Math.round(items.reduce((sum, item) => sum + item.progressPercent, 0) / items.length)
      : 0;

  return (
    <div className="site-shell">
      <SiteHeader active={active} />

      <main className="feature-page">
        <section className="feature-hero">
          <h1>{title}</h1>
          <p>{description}</p>

          <UploadDropzone
            label={selectLabel}
            hint={items.length > 0 ? `${items.length} file(s) staged` : emptyHint}
            accept={accept}
            multiple
            compact
            disabled={busy}
            onFiles={addFiles}
          />
        </section>

        <section className="merge-workbench batch-workbench">
          <div className="batch-workbench-header">
            <div>
              <h2>Batch queue</h2>
              <p className="small">{helperText}</p>
            </div>
            <div className="batch-summary">
              <strong>{averageProgress}%</strong>
              <span>
                {completedCount} completed, {failedCount} failed, {activeCount} active
              </span>
            </div>
          </div>

          <div className="task-progress-rail overall">
            <span style={{ width: `${averageProgress}%` }} />
          </div>

          {extraInput ? (
            <>
              <label htmlFor={extraInput.id}>{extraInput.label}</label>
              <input
                id={extraInput.id}
                type={extraInput.type ?? "text"}
                value={extraValue}
                onChange={(event) => setExtraValue(event.target.value)}
                placeholder={extraInput.placeholder}
                disabled={busy}
              />
            </>
          ) : null}

          <button
            type="button"
            className="start-process-btn"
            disabled={busy || items.length === 0}
            onClick={startBatch}
          >
            {busy ? runningLabel : startLabel}
          </button>

          {items.length === 0 ? (
            <div className="tool-empty-state">
              <strong>No files staged yet</strong>
              <span>{emptyHint}</span>
            </div>
          ) : null}

          <p className={notice.toLowerCase().includes("failed") ? "error" : "small"}>{notice}</p>

          {items.length > 0 ? (
            <div className="batch-task-list">
              {items.map((item, index) => (
                <article key={item.id} className={`batch-task-card is-${statusTone(item)}`}>
                  <div className="batch-task-topline">
                    <div>
                      <strong>
                        {index + 1}. {item.file.name}
                      </strong>
                      <p className="small">
                        {stripExtension(item.file.name)} · {Math.round(item.file.size / 1024)} KB
                      </p>
                    </div>

                    <button
                      type="button"
                      className="row-link-btn"
                      onClick={() =>
                        setItems((current) => current.filter((currentItem) => currentItem.id !== item.id))
                      }
                      disabled={busy && item.phase !== "completed" && item.phase !== "failed"}
                    >
                      Remove
                    </button>
                  </div>

                  <label htmlFor={`output-${item.id}`}>Output filename</label>
                  <input
                    id={`output-${item.id}`}
                    value={item.outputName}
                    onChange={(event) =>
                      updateItem(item.id, {
                        outputName: event.target.value
                      })
                    }
                    disabled={busy}
                  />

                  <TaskProgressState
                    status={item.errorMessage || item.progressMessage}
                    progressPercent={item.progressPercent}
                    downloadUrl={item.downloadUrl}
                    downloadLabel={downloadLabel}
                  />
                </article>
              ))}
            </div>
          ) : null}
        </section>
      </main>
    </div>
  );
}
