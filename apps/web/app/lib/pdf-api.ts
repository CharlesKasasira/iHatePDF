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

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Failed to read file."));
    reader.onload = () => resolve(String(reader.result));
    reader.readAsDataURL(file);
  });
}

export async function uploadPdf(file: File): Promise<UploadedFileMeta> {
  const dataUrl = await fileToDataUrl(file);
  const dataBase64 = dataUrl.split(",")[1];
  if (!dataBase64) {
    throw new Error("Failed to encode PDF file.");
  }

  const response = await fetch(`${API_BASE_URL}/uploads`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      fileName: file.name,
      mimeType: "application/pdf",
      dataBase64
    })
  });

  if (!response.ok) {
    throw new Error(await readError(response));
  }

  const uploaded = (await response.json()) as { fileId: string; fileName: string };
  return { fileId: uploaded.fileId, fileName: uploaded.fileName };
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
