export const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000/api";

export type TaskStatusResponse = {
  id: string;
  status: "queued" | "processing" | "completed" | "failed";
  type: string;
  errorMessage: string | null;
  outputDownloadUrl: string | null;
  createdAt: string;
  updatedAt: string;
};

export type UploadedFileMeta = {
  fileId: string;
  fileName: string;
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
  if (lower.endsWith(".xlsx")) {
    return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  }
  if (lower.endsWith(".pptx")) {
    return "application/vnd.openxmlformats-officedocument.presentationml.presentation";
  }

  return "application/octet-stream";
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

export async function uploadPdfWithRetention(
  file: File,
  retentionHours: number
): Promise<UploadedFileMeta> {
  return uploadFile(file, ["application/pdf"], { retentionHours });
}

export async function pollTask(taskId: string): Promise<TaskStatusResponse> {
  let last: TaskStatusResponse | null = null;

  for (let index = 0; index < 120; index += 1) {
    const task = await jsonFetch<TaskStatusResponse>(`/tasks/${taskId}`);
    last = task;

    if (task.status === "completed" || task.status === "failed") {
      return task;
    }

    await new Promise((resolve) => setTimeout(resolve, 1500));
  }

  if (!last) {
    throw new Error("Task polling timed out before first response.");
  }

  return last;
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

export async function queueEditPdf(
  fileId: string,
  outputName: string,
  edits: {
    textEdits?: EditTextInput[];
    rectangleEdits?: EditRectangleInput[];
    imageEdits?: EditImageInput[];
    retentionHours?: number;
  }
): Promise<{ taskId: string }> {
  return jsonFetch<{ taskId: string }>("/tasks/edit", {
    method: "POST",
    body: JSON.stringify({ fileId, outputName, ...edits })
  });
}
