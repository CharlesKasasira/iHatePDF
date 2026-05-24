export type DesktopUser = {
  id: string;
  email: string;
  name: string | null;
  isAdmin: boolean;
  suspendedAt: string | Date | null;
  lockedAt: string | Date | null;
  lockReason: string | null;
  createdAt: string | Date;
};

export type DesktopDeviceKeyResponse = {
  user: DesktopUser;
  apiKey: {
    id: string;
    name: string;
    key: string;
    keyPrefix: string;
    expiresAt: string | Date | null;
    createdAt: string | Date;
  };
};

export type UploadedFile = {
  id: string;
  objectKey: string;
  fileName: string;
};

export type ApiTaskStatus = {
  schemaVersion: string;
  task: {
    id: string;
    type: string;
    status: "queued" | "processing" | "completed" | "failed";
    progress: {
      percent: number;
      message: string | null;
    };
    result: {
      fileId: string | null;
      downloadUrl: string | null;
      expiresAt: string | null;
    };
    error: {
      message: string;
    } | null;
    timestamps: {
      createdAt: string;
      updatedAt: string;
    };
  };
};

export type QueueOperation =
  | "merge"
  | "split"
  | "compress"
  | "protect"
  | "unlock"
  | "jpg-to-pdf"
  | "pdf-to-jpg"
  | "pdf-to-word"
  | "pdf-to-excel"
  | "pdf-to-powerpoint"
  | "word-to-pdf"
  | "excel-to-pdf"
  | "powerpoint-to-pdf";

export class IhatePdfApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "IhatePdfApiError";
    this.status = status;
  }
}

type ClientOptions = {
  baseUrl: string;
  apiKey?: string;
  fetchImpl?: typeof fetch;
};

async function readError(response: Response): Promise<string> {
  const text = await response.text();
  if (!text) {
    return response.statusText || `Request failed with status ${response.status}`;
  }

  try {
    const parsed = JSON.parse(text) as { message?: string | string[]; error?: string };
    if (Array.isArray(parsed.message)) {
      return parsed.message.join(" ");
    }
    if (parsed.message) {
      return parsed.message;
    }
    if (parsed.error) {
      return parsed.error;
    }
  } catch {
    // Fall through to the raw response body.
  }

  return text;
}

function trimBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "");
}

function inferMimeType(fileName: string, reportedType?: string): string {
  if (reportedType && reportedType !== "application/octet-stream") {
    return reportedType;
  }

  const lower = fileName.toLowerCase();
  if (lower.endsWith(".pdf")) return "application/pdf";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".docx")) return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  if (lower.endsWith(".xlsx")) return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  if (lower.endsWith(".pptx")) return "application/vnd.openxmlformats-officedocument.presentationml.presentation";
  return "application/octet-stream";
}

function toBlobPart(bytes: Uint8Array | ArrayBuffer): ArrayBuffer {
  if (bytes instanceof ArrayBuffer) {
    return bytes;
  }

  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

export class IhatePdfClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private apiKey?: string;

  constructor(options: ClientOptions) {
    this.baseUrl = trimBaseUrl(options.baseUrl);
    this.apiKey = options.apiKey;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  setApiKey(apiKey: string | undefined): void {
    this.apiKey = apiKey;
  }

  private headers(init?: HeadersInit): Headers {
    const headers = new Headers(init);
    if (this.apiKey) {
      headers.set("Authorization", `Bearer ${this.apiKey}`);
    }
    return headers;
  }

  private async json<T>(path: string, init?: RequestInit): Promise<T> {
    const headers = this.headers(init?.headers);
    if (init?.body && !headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }

    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      ...init,
      cache: init?.cache ?? "no-store",
      headers
    });

    if (!response.ok) {
      throw new IhatePdfApiError(await readError(response), response.status);
    }

    return response.json() as Promise<T>;
  }

  createDesktopDeviceKey(input: {
    email: string;
    password: string;
    deviceName: string;
  }): Promise<DesktopDeviceKeyResponse> {
    return this.json<DesktopDeviceKeyResponse>("/auth/desktop-device-key", {
      method: "POST",
      body: JSON.stringify(input)
    });
  }

  async uploadFile(input: {
    bytes: Blob | Uint8Array | ArrayBuffer;
    fileName: string;
    mimeType?: string;
  }): Promise<UploadedFile> {
    const bytes =
      input.bytes instanceof Blob
        ? input.bytes
        : new Blob([toBlobPart(input.bytes)], { type: inferMimeType(input.fileName, input.mimeType) });
    const formData = new FormData();
    formData.append("file", bytes, input.fileName);

    const response = await this.fetchImpl(`${this.baseUrl}/v1/files`, {
      method: "POST",
      headers: this.headers(),
      body: formData
    });

    if (!response.ok) {
      throw new IhatePdfApiError(await readError(response), response.status);
    }

    const uploaded = (await response.json()) as { file: UploadedFile };
    return uploaded.file;
  }

  queueTask(operation: QueueOperation, payload: Record<string, unknown>): Promise<ApiTaskStatus> {
    return this.json<ApiTaskStatus>(`/v1/tasks/${operation}`, {
      method: "POST",
      body: JSON.stringify(payload)
    });
  }

  getTaskStatus(taskId: string): Promise<ApiTaskStatus> {
    return this.json<ApiTaskStatus>(`/v1/tasks/${taskId}/status`);
  }

  async pollTask(
    taskId: string,
    options: {
      onUpdate?: (status: ApiTaskStatus) => void;
      intervalMs?: number;
      maxAttempts?: number;
    } = {}
  ): Promise<ApiTaskStatus> {
    const intervalMs = options.intervalMs ?? 1500;
    const maxAttempts = options.maxAttempts ?? 120;

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const status = await this.getTaskStatus(taskId);
      options.onUpdate?.(status);
      if (status.task.status === "completed" || status.task.status === "failed") {
        return status;
      }
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }

    throw new Error("Task polling timed out.");
  }

  async downloadBytes(downloadUrl: string): Promise<Uint8Array> {
    const absoluteUrl = downloadUrl.startsWith("http") ? downloadUrl : `${this.baseUrl.replace(/\/api$/, "")}${downloadUrl}`;
    const response = await this.fetchImpl(absoluteUrl, {
      headers: this.headers()
    });

    if (!response.ok) {
      throw new IhatePdfApiError(await readError(response), response.status);
    }

    return new Uint8Array(await response.arrayBuffer());
  }
}
