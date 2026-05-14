export const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000/api";

export type TaskStatusResponse = {
  id: string;
  status: "queued" | "processing" | "completed" | "failed";
  type: string;
  progressPercent: number;
  progressMessage: string | null;
  errorMessage: string | null;
  outputDownloadUrl: string | null;
  createdAt: string;
  updatedAt: string;
};

export type SignatureRequestResponse = {
  id: string;
  token: string;
  status: "pending" | "completed" | "expired" | "cancelled";
  fileId: string;
  fileName: string;
  expiresAt: string;
  message: string | null;
  signerName?: string;
  signerRole?: string;
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  outputName: string;
  pageWidth: number;
  pageHeight: number;
};

export type UploadedFileMeta = {
  fileId: string;
  fileName: string;
};

export type PdfFileMetadataResponse = {
  id: string;
  fileName: string;
  mimeType: string;
  pageCount: number;
  pages: Array<{
    pageNumber: number;
    width: number;
    height: number;
  }>;
};

async function readError(response: Response): Promise<string> {
  const text = await response.text();
  if (!text) {
    return `Request failed (${response.status})`;
  }

  try {
    const parsed = JSON.parse(text) as { message?: string | string[] };
    if (Array.isArray(parsed.message)) {
      return parsed.message.join(", ");
    }

    if (parsed.message) {
      return parsed.message;
    }
  } catch {
    // Not JSON, use raw text.
  }

  return text;
}

export async function jsonFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {})
    }
  });

  if (!response.ok) {
    throw new Error(await readError(response));
  }

  return response.json() as Promise<T>;
}

function inferMimeType(file: File): string {
  const reportedMime = file.type.trim();
  if (reportedMime && reportedMime !== "application/octet-stream") {
    return reportedMime;
  }

  const lower = file.name.toLowerCase();
  if (lower.endsWith(".pdf")) {
    return "application/pdf";
  }
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) {
    return "image/jpeg";
  }
  if (lower.endsWith(".docx")) {
    return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  }
  if (lower.endsWith(".xlsx")) {
    return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  }
  if (lower.endsWith(".pptx")) {
    return "application/vnd.openxmlformats-officedocument.presentationml.presentation";
  }

  return "application/octet-stream";
}

export function isAllowedFileType(file: File, allowedMimeTypes?: readonly string[]): boolean {
  const mimeType = inferMimeType(file);
  return !allowedMimeTypes || allowedMimeTypes.includes(mimeType);
}

export async function uploadFile(
  file: File,
  allowedMimeTypes?: readonly string[],
  options?: {
    retentionHours?: number;
  }
): Promise<UploadedFileMeta> {
  const mimeType = inferMimeType(file);
  if (allowedMimeTypes && !allowedMimeTypes.includes(mimeType)) {
    throw new Error(`Unsupported file type "${mimeType}".`);
  }

  const formData = new FormData();
  formData.append("file", file, file.name);
  if (options?.retentionHours) {
    formData.append("retentionHours", String(options.retentionHours));
  }

  const response = await fetch(`${API_BASE_URL}/uploads`, {
    method: "POST",
    body: formData
  });

  if (!response.ok) {
    throw new Error(await readError(response));
  }

  const uploaded = (await response.json()) as { fileId: string; fileName: string };
  return { fileId: uploaded.fileId, fileName: uploaded.fileName };
}

export async function uploadPdf(file: File): Promise<UploadedFileMeta> {
  return uploadFile(file, ["application/pdf"]);
}

export async function uploadJpg(file: File): Promise<UploadedFileMeta> {
  return uploadFile(file, ["image/jpeg", "image/jpg"]);
}

export async function uploadPdfWithRetention(
  file: File,
  retentionHours: number
): Promise<UploadedFileMeta> {
  return uploadFile(file, ["application/pdf"], { retentionHours });
}

export async function getPdfMetadata(fileId: string): Promise<PdfFileMetadataResponse> {
  return jsonFetch<PdfFileMetadataResponse>(`/files/${fileId}/metadata`);
}

export function getPdfPagePreviewUrl(fileId: string, pageNumber: number): string {
  return `${API_BASE_URL}/files/${fileId}/pages/${pageNumber}/preview`;
}

export async function createSignatureRequest(input: {
  fileId: string;
  requesterEmail: string;
  signerName?: string;
  signerEmail: string;
  signerRole?: string;
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  outputName: string;
  message?: string;
}): Promise<{ id: string; token: string; signingUrl: string }> {
  return jsonFetch<{ id: string; token: string; signingUrl: string }>("/signature-requests", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export async function getSignatureRequest(token: string): Promise<SignatureRequestResponse> {
  return jsonFetch<SignatureRequestResponse>(`/signature-requests/${token}`);
}

export async function completeSignatureRequest(
  token: string,
  signatureDataUrl: string
): Promise<{ taskId: string }> {
  return jsonFetch<{ taskId: string }>(`/signature-requests/${token}/complete`, {
    method: "POST",
    body: JSON.stringify({ signatureDataUrl })
  });
}

function isTerminalTaskStatus(task: TaskStatusResponse): boolean {
  return task.status === "completed" || task.status === "failed";
}

function parseTaskStatusResponse(value: unknown): TaskStatusResponse {
  const task = value as TaskStatusResponse;
  return {
    ...task,
    progressPercent: Number.isFinite(task.progressPercent) ? task.progressPercent : 0,
    progressMessage: task.progressMessage ?? null
  };
}

export async function pollTask(
  taskId: string,
  options?: {
    onUpdate?: (task: TaskStatusResponse) => void;
  }
): Promise<TaskStatusResponse> {
  let last: TaskStatusResponse | null = null;
  const notifyUpdate = (task: TaskStatusResponse): void => {
    last = task;
    options?.onUpdate?.(task);
  };

  const firstTask = parseTaskStatusResponse(await jsonFetch<TaskStatusResponse>(`/tasks/${taskId}`));
  notifyUpdate(firstTask);

  if (isTerminalTaskStatus(firstTask)) {
    return firstTask;
  }

  const pollingPromise = (async (): Promise<TaskStatusResponse> => {
    for (let index = 0; index < 119; index += 1) {
      const task = parseTaskStatusResponse(await jsonFetch<TaskStatusResponse>(`/tasks/${taskId}`));
      notifyUpdate(task);

      if (isTerminalTaskStatus(task)) {
        return task;
      }

      await new Promise((resolve) => setTimeout(resolve, 1500));
    }

    if (!last) {
      throw new Error("Task polling timed out before first response.");
    }

    return last;
  })();

  if (typeof window !== "undefined" && typeof window.EventSource !== "undefined") {
    let eventSource: EventSource | null = new window.EventSource(`${API_BASE_URL}/tasks/${taskId}/events`);
    const closeEventSource = (): void => {
      if (eventSource) {
        eventSource.close();
        eventSource = null;
      }
    };

    const streamedTaskPromise = new Promise<TaskStatusResponse | null>((resolve) => {
      if (!eventSource) {
        resolve(null);
        return;
      }

      eventSource.onmessage = (event) => {
        try {
          const task = parseTaskStatusResponse(JSON.parse(event.data) as TaskStatusResponse);
          notifyUpdate(task);
          if (isTerminalTaskStatus(task)) {
            closeEventSource();
            resolve(task);
          }
        } catch {
          // Ignore malformed frames and keep the fallback path available.
        }
      };

      eventSource.onerror = () => {
        closeEventSource();
        resolve(null);
      };
    });

    const result = await Promise.race([
      streamedTaskPromise.then((task) => ({ source: "stream" as const, task })),
      pollingPromise.then((task) => ({ source: "poll" as const, task }))
    ]);

    closeEventSource();

    if (result.source === "stream") {
      if (result.task) {
        return result.task;
      }

      return pollingPromise;
    }

    return result.task;
  }

  return pollingPromise;
}

export async function queueMerge(fileIds: string[], outputName: string): Promise<{ taskId: string }> {
  return jsonFetch<{ taskId: string }>("/tasks/merge", {
    method: "POST",
    body: JSON.stringify({ fileIds, outputName })
  });
}

export async function queueSplit(
  fileId: string,
  pageRanges: string[],
  outputPrefix: string
): Promise<{ taskId: string }> {
  return jsonFetch<{ taskId: string }>("/tasks/split", {
    method: "POST",
    body: JSON.stringify({ fileId, pageRanges, outputPrefix })
  });
}

export async function queueRemovePages(
  fileId: string,
  pageRanges: string[],
  outputName: string
): Promise<{ taskId: string }> {
  return jsonFetch<{ taskId: string }>("/tasks/remove-pages", {
    method: "POST",
    body: JSON.stringify({ fileId, pageRanges, outputName })
  });
}

export async function queueExtractPages(
  fileId: string,
  pageRanges: string[],
  outputName: string
): Promise<{ taskId: string }> {
  return jsonFetch<{ taskId: string }>("/tasks/extract-pages", {
    method: "POST",
    body: JSON.stringify({ fileId, pageRanges, outputName })
  });
}

export async function queueOrganizePdf(
  fileId: string,
  pageOrder: number[],
  outputName: string
): Promise<{ taskId: string }> {
  return jsonFetch<{ taskId: string }>("/tasks/organize-pdf", {
    method: "POST",
    body: JSON.stringify({ fileId, pageOrder, outputName })
  });
}

export async function queueCompress(fileId: string, outputName: string): Promise<{ taskId: string }> {
  return jsonFetch<{ taskId: string }>("/tasks/compress", {
    method: "POST",
    body: JSON.stringify({ fileId, outputName })
  });
}

export async function queueProtect(
  fileId: string,
  password: string,
  outputName: string
): Promise<{ taskId: string }> {
  return jsonFetch<{ taskId: string }>("/tasks/protect", {
    method: "POST",
    body: JSON.stringify({ fileId, password, outputName })
  });
}

export async function queueUnlock(
  fileId: string,
  password: string,
  outputName: string
): Promise<{ taskId: string }> {
  return jsonFetch<{ taskId: string }>("/tasks/unlock", {
    method: "POST",
    body: JSON.stringify({ fileId, password, outputName })
  });
}

export async function queuePdfToWord(fileId: string, outputName: string): Promise<{ taskId: string }> {
  return jsonFetch<{ taskId: string }>("/tasks/pdf-to-word", {
    method: "POST",
    body: JSON.stringify({ fileId, outputName })
  });
}

export async function queueJpgToPdf(
  fileIds: string[],
  outputName: string
): Promise<{ taskId: string }> {
  return jsonFetch<{ taskId: string }>("/tasks/jpg-to-pdf", {
    method: "POST",
    body: JSON.stringify({ fileIds, outputName })
  });
}

export async function queuePdfToJpg(fileId: string, outputName: string): Promise<{ taskId: string }> {
  return jsonFetch<{ taskId: string }>("/tasks/pdf-to-jpg", {
    method: "POST",
    body: JSON.stringify({ fileId, outputName })
  });
}

export async function queuePdfToPowerpoint(
  fileId: string,
  outputName: string
): Promise<{ taskId: string }> {
  return jsonFetch<{ taskId: string }>("/tasks/pdf-to-powerpoint", {
    method: "POST",
    body: JSON.stringify({ fileId, outputName })
  });
}

export async function queuePdfToExcel(fileId: string, outputName: string): Promise<{ taskId: string }> {
  return jsonFetch<{ taskId: string }>("/tasks/pdf-to-excel", {
    method: "POST",
    body: JSON.stringify({ fileId, outputName })
  });
}

export async function queueWordToPdf(fileId: string, outputName: string): Promise<{ taskId: string }> {
  return jsonFetch<{ taskId: string }>("/tasks/word-to-pdf", {
    method: "POST",
    body: JSON.stringify({ fileId, outputName })
  });
}

export async function queueExcelToPdf(fileId: string, outputName: string): Promise<{ taskId: string }> {
  return jsonFetch<{ taskId: string }>("/tasks/excel-to-pdf", {
    method: "POST",
    body: JSON.stringify({ fileId, outputName })
  });
}

export async function queuePowerpointToPdf(
  fileId: string,
  outputName: string
): Promise<{ taskId: string }> {
  return jsonFetch<{ taskId: string }>("/tasks/powerpoint-to-pdf", {
    method: "POST",
    body: JSON.stringify({ fileId, outputName })
  });
}

export type EditTextInput = {
  page: number;
  x: number;
  y: number;
  text: string;
  fontSize: number;
  fontFamily: "sans" | "serif" | "mono";
  bold: boolean;
  italic: boolean;
  underline: boolean;
  color: string;
};

export type EditRectangleInput = {
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  color: string;
  opacity: number;
};

export type EditImageInput = {
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  dataUrl: string;
};

export type EditPageRotationInput = {
  page: number;
  degrees: 90 | 180 | 270;
};

export type EditPageNumbersInput = {
  startAt: number;
  fontSize: number;
  color: string;
  position: "top-left" | "top-center" | "top-right" | "bottom-left" | "bottom-center" | "bottom-right";
  margin: number;
  prefix?: string;
};

export type EditWatermarkInput = {
  text: string;
  fontSize: number;
  color: string;
  opacity: number;
  rotation: number;
};

export async function queueEditPdf(
  fileId: string,
  outputName: string,
  edits: {
    textEdits?: EditTextInput[];
    rectangleEdits?: EditRectangleInput[];
    imageEdits?: EditImageInput[];
    pageRotations?: EditPageRotationInput[];
    pageNumbers?: EditPageNumbersInput;
    watermark?: EditWatermarkInput;
    retentionHours?: number;
  }
): Promise<{ taskId: string }> {
  return jsonFetch<{ taskId: string }>("/tasks/edit", {
    method: "POST",
    body: JSON.stringify({ fileId, outputName, ...edits })
  });
}
