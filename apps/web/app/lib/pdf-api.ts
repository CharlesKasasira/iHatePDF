export const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000/api";

export type AuthUser = {
  id: string;
  email: string;
  name: string | null;
  isAdmin: boolean;
  suspendedAt: string | null;
  lockedAt: string | null;
  lockReason: string | null;
  createdAt: string;
};

export type AdminUser = {
  id: string;
  email: string;
  name: string | null;
  isAdmin: boolean;
  suspendedAt: string | null;
  lockedAt: string | null;
  lockReason: string | null;
  createdAt: string;
  updatedAt: string;
  counts: {
    files: number;
    tasks: number;
    apiKeys: number;
    sessions: number;
  };
  recentSecurityEvents: Array<{
    id: string;
    type: string;
    description: string;
    ipAddress: string | null;
    userAgent: string | null;
    actorEmail: string | null;
    createdAt: string;
  }>;
};

export type AdminApiKey = {
  id: string;
  name: string;
  keyPrefix: string;
  ownerId: string;
  ownerEmail: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
  rateLimitedAt: string | null;
  rateLimitReason: string | null;
  createdAt: string;
  usage: {
    total: number;
    last30Days: number;
    byRoute: Array<{
      route: string;
      method: string;
      count: number;
      lastUsedAt: string;
    }>;
  };
};

export type AccountActivityResponse = {
  files: Array<{
    id: string;
    fileName: string;
    mimeType: string;
    sizeBytes: string;
    createdAt: string;
    expiresAt: string | null;
    downloadUrl: string | null;
  }>;
  tasks: Array<{
    id: string;
    type: string;
    status: "queued" | "processing" | "completed" | "failed";
    progressPercent: number;
    progressMessage: string | null;
    errorMessage: string | null;
    retryCount: number;
    lastRetriedAt: string | null;
    canRetry: boolean;
    retryHint: string;
    createdAt: string;
    updatedAt: string;
    outputFileName: string | null;
    outputDownloadUrl: string | null;
  }>;
  signatureEnvelopes: Array<{
    id: string;
    title: string | null;
    requesterEmail: string;
    status:
      | "sent"
      | "in_progress"
      | "finalizing"
      | "finalization_failed"
      | "completed"
      | "expired"
      | "revoked";
    routing: "sequential" | "parallel";
    outputName: string;
    fileName: string;
    createdAt: string;
    expiresAt: string;
    completedAt: string | null;
    manageUrl: string;
    finalDownloadUrl: string | null;
    auditCertificateUrl: string | null;
  }>;
  storageUsage: {
    totalBytes: string;
    fileCount: number;
    expiringSoonCount: number;
    largestFiles: AccountActivityResponse["files"];
  };
  apiUsage: {
    apiKeyCount: number;
    activeApiKeyCount: number;
    totalEvents: number;
    eventsLast30Days: number;
    keys: Array<{
      id: string;
      name: string;
      keyPrefix: string;
      lastUsedAt: string | null;
      expiresAt: string | null;
      revokedAt: string | null;
      createdAt: string;
      usageCount: number;
    }>;
    recentEvents: Array<{
      id: string;
      method: string;
      route: string;
      statusCode: number | null;
      taskId: string | null;
      fileId: string | null;
      apiKeyName: string | null;
      apiKeyPrefix: string | null;
      createdAt: string;
    }>;
  };
  webhooks: {
    endpointCount: number;
    activeEndpointCount: number;
    deliveries: WebhookDeliveryItem[];
  };
  retryVisibility: {
    failedTaskCount: number;
    retriedTaskCount: number;
    tasks: AccountActivityResponse["tasks"];
  };
};

export type WebhookDeliveryItem = {
  id: string;
  endpointId: string;
  endpointUrl: string;
  endpointActive: boolean;
  eventType: string;
  status: string;
  responseStatus: number | null;
  errorMessage: string | null;
  attemptCount: number;
  deliveredAt: string | null;
  createdAt: string;
};

export type ApiKeyItem = {
  id: string;
  name: string;
  keyPrefix: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
  createdAt: string;
};

export type CreatedApiKey = ApiKeyItem & {
  key: string;
};

export type WebhookEndpointItem = {
  id: string;
  url: string;
  description: string | null;
  events: unknown;
  active: boolean;
  createdAt: string;
  updatedAt: string;
};

export type CreatedWebhookEndpoint = WebhookEndpointItem & {
  signingSecret: string;
};

export type AdminDashboardResponse = {
  generatedAt: string;
  counts: {
    users: number;
    files: number;
    tasks: number;
    apiKeys: number;
    webhookEndpoints: number;
    webhookDeliveries: number;
  };
  storageUsage: {
    totalBytes: string;
    topOwners: Array<{
      ownerId: string | null;
      ownerEmail: string | null;
      fileCount: number;
      totalBytes: string;
    }>;
  };
  apiUsage: {
    totalEvents: number;
    eventsLast30Days: number;
    recentEvents: Array<{
      id: string;
      ownerEmail: string;
      apiKeyName: string | null;
      method: string;
      route: string;
      statusCode: number | null;
      taskId: string | null;
      fileId: string | null;
      createdAt: string;
    }>;
  };
  webhookDeliveries: WebhookDeliveryItem[];
  taskRetryVisibility: {
    byStatus: Array<{ status: string; count: number }>;
    queue: {
      name: string;
      waiting: number;
      active: number;
      delayed: number;
      completed: number;
      failed: number;
      paused: number;
    } | null;
    failedTasks: Array<AccountActivityResponse["tasks"][number] & { ownerEmail: string | null }>;
  };
  fileHistory: Array<AccountActivityResponse["files"][number] & { ownerEmail: string | null }>;
};

export type TaskStatusResponse = {
  id: string;
  status: "queued" | "processing" | "completed" | "failed";
  type: string;
  progressPercent: number;
  progressMessage: string | null;
  errorMessage: string | null;
  retryCount: number;
  lastRetriedAt: string | null;
  outputDownloadUrl: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ImageToolOperation =
  | "compress"
  | "resize"
  | "crop"
  | "rotate"
  | "convert_to_jpg"
  | "convert_from_jpg"
  | "watermark"
  | "meme";

export type SignatureRequestResponse = {
  envelopeId: string;
  title: string | null;
  requesterEmail: string;
  status:
    | "sent"
    | "in_progress"
    | "finalizing"
    | "finalization_failed"
    | "completed"
    | "expired"
    | "revoked";
  routing: "sequential" | "parallel";
  fileId: string | null;
  fileName: string;
  expiresAt: string;
  currentOrder: number | null;
  canSubmit: boolean;
  verification: {
    otpRequired: boolean;
    otpVerified: boolean;
    passcodeRequired: boolean;
    passcodeVerified: boolean;
    identityVerified: boolean;
    otpExpiresAt: string | null;
  };
  message: string | null;
  recipient: {
    id: string;
    name: string | null;
    email: string;
    role: string | null;
    routingOrder: number;
    status: "waiting" | "notified" | "viewed" | "completed" | "revoked";
  };
  recipients: Array<{
    id: string;
    name: string | null;
    email: string;
    role: string | null;
    routingOrder: number;
    status: "waiting" | "notified" | "viewed" | "completed" | "revoked";
    completedAt: string | null;
  }>;
  fields: Array<{
    id: string;
    recipientId: string;
    recipientName: string | null;
    type: "signature" | "initials" | "name" | "date" | "checkbox" | "text";
    label: string | null;
    placeholder: string | null;
    required: boolean;
    page: number;
    x: number;
    y: number;
    width: number;
    height: number;
    value: Record<string, unknown> | null;
  }>;
  auditTrail: Array<{
    id: string;
    type:
      | "created"
      | "notification_sent"
      | "otp_requested"
      | "otp_verified"
      | "otp_failed"
      | "passcode_verified"
      | "passcode_failed"
      | "viewed"
      | "reminded"
      | "completed"
      | "finalization_failed"
      | "completion_email_sent"
      | "completion_email_failed"
      | "reassigned"
      | "revoked"
      | "expired"
      | "finalized";
    actorEmail: string | null;
    description: string;
    createdAt: string;
    ipAddress: string | null;
    userAgent: string | null;
  }>;
  finalDownloadUrl: string | null;
  auditCertificateUrl: string | null;
};

export type SignatureEnvelopeResponse = {
  id: string;
  title: string | null;
  requesterEmail: string;
  status:
    | "sent"
    | "in_progress"
    | "finalizing"
    | "finalization_failed"
    | "completed"
    | "expired"
    | "revoked";
  routing: "sequential" | "parallel";
  outputName: string;
  fileId: string;
  fileName: string;
  expiresAt: string;
  createdAt: string;
  completedAt: string | null;
  revokedAt: string | null;
  finalDownloadUrl: string | null;
  auditCertificateUrl: string | null;
  recipients: Array<{
    id: string;
    name: string | null;
    email: string;
    role: string | null;
    routingOrder: number;
    status: "waiting" | "notified" | "viewed" | "completed" | "revoked";
    reminderCount: number;
    lastViewedAt: string | null;
    completedAt: string | null;
    signingUrl: string;
  }>;
  fields: Array<{
    id: string;
    recipientId: string;
    recipientName: string | null;
    type: "signature" | "initials" | "name" | "date" | "checkbox" | "text";
    label: string | null;
    required: boolean;
    page: number;
    x: number;
    y: number;
    width: number;
    height: number;
    value: Record<string, unknown> | null;
  }>;
  auditTrail: Array<{
    id: string;
    type:
      | "created"
      | "notification_sent"
      | "otp_requested"
      | "otp_verified"
      | "otp_failed"
      | "passcode_verified"
      | "passcode_failed"
      | "viewed"
      | "reminded"
      | "completed"
      | "finalization_failed"
      | "completion_email_sent"
      | "completion_email_failed"
      | "reassigned"
      | "revoked"
      | "expired"
      | "finalized";
    actorEmail: string | null;
    description: string;
    createdAt: string;
    ipAddress: string | null;
    userAgent: string | null;
  }>;
};

export type SignatureEnvelopeTemplate = {
  id: string;
  name: string;
  title: string | null;
  requesterEmail: string | null;
  message: string | null;
  outputName: string;
  routing: "sequential" | "parallel";
  createdAt: string;
  updatedAt: string;
  recipients: Array<{
    key: string;
    name: string | null;
    email: string | null;
    role: string | null;
    routingOrder: number;
  }>;
  fields: Array<{
    recipientKey: string;
    type: "signature" | "initials" | "name" | "date" | "checkbox" | "text";
    label: string | null;
    placeholder: string | null;
    required: boolean;
    page: number;
    x: number;
    y: number;
    width: number;
    height: number;
  }>;
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

export type FileShareResponse = {
  id: string;
  token: string;
  fileName: string;
  shareUrl: string;
  downloadUrl: string;
  expiresAt: string;
  emailSent: boolean;
};

export type SharedFileMetadataResponse = {
  fileName: string;
  mimeType: string;
  sizeBytes: string;
  expiresAt: string;
  downloadUrl: string;
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
  const headers = new Headers(init?.headers);
  if (init?.body !== undefined && init.body !== null && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    cache: init?.cache ?? "no-store",
    credentials: "include",
    headers
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
  if (lower.endsWith(".png")) {
    return "image/png";
  }
  if (lower.endsWith(".webp")) {
    return "image/webp";
  }
  if (lower.endsWith(".gif")) {
    return "image/gif";
  }
  if (lower.endsWith(".svg")) {
    return "image/svg+xml";
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
    credentials: "include",
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

export async function uploadImage(file: File): Promise<UploadedFileMeta> {
  return uploadFile(file, ["image/jpeg", "image/jpg", "image/png", "image/webp", "image/gif", "image/svg+xml"]);
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

export async function createFileShare(input: {
  fileId: string;
  email?: string;
  message?: string;
  expiresInHours?: number;
  mode?: "download" | "editor";
}): Promise<FileShareResponse> {
  return jsonFetch<FileShareResponse>(`/files/${input.fileId}/share`, {
    method: "POST",
    body: JSON.stringify({
      email: input.email || undefined,
      message: input.message || undefined,
      expiresInHours: input.expiresInHours,
      mode: input.mode
    })
  });
}

export async function getSharedFile(token: string): Promise<SharedFileMetadataResponse> {
  return jsonFetch<SharedFileMetadataResponse>(`/files/shared/${encodeURIComponent(token)}`);
}

export function getPdfPagePreviewUrl(fileId: string, pageNumber: number): string {
  return `${API_BASE_URL}/files/${fileId}/pages/${pageNumber}/preview`;
}

export async function getSignaturePdfMetadata(token: string): Promise<PdfFileMetadataResponse> {
  return jsonFetch<PdfFileMetadataResponse>(`/files/signature-requests/${token}/metadata`);
}

export function getSignaturePdfPagePreviewUrl(token: string, pageNumber: number): string {
  return `${API_BASE_URL}/files/signature-requests/${token}/pages/${pageNumber}/preview`;
}

export async function signup(input: {
  email: string;
  password: string;
  name?: string;
}): Promise<AuthUser> {
  return jsonFetch<AuthUser>("/auth/signup", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export async function login(input: { email: string; password: string }): Promise<AuthUser> {
  return jsonFetch<AuthUser>("/auth/login", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export async function logout(): Promise<{ ok: true }> {
  return jsonFetch<{ ok: true }>("/auth/logout", {
    method: "POST"
  });
}

export async function getCurrentUser(): Promise<AuthUser | null> {
  return jsonFetch<AuthUser | null>("/auth/me");
}

export async function requestPasswordReset(email: string): Promise<{ ok: true }> {
  return jsonFetch<{ ok: true }>("/auth/password-reset/request", {
    method: "POST",
    body: JSON.stringify({ email })
  });
}

export async function confirmPasswordReset(input: {
  token: string;
  password: string;
}): Promise<{ ok: true }> {
  return jsonFetch<{ ok: true }>("/auth/password-reset/confirm", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export async function getAccountActivity(): Promise<AccountActivityResponse> {
  return jsonFetch<AccountActivityResponse>("/account/activity");
}

export async function getAdminDashboard(): Promise<AdminDashboardResponse> {
  return jsonFetch<AdminDashboardResponse>("/account/admin-dashboard");
}

export async function listApiKeys(): Promise<ApiKeyItem[]> {
  return jsonFetch<ApiKeyItem[]>("/api-keys");
}

export async function createApiKey(input: {
  name: string;
  expiresAt?: string;
}): Promise<CreatedApiKey> {
  return jsonFetch<CreatedApiKey>("/api-keys", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export async function revokeApiKey(id: string): Promise<{ ok: true }> {
  return jsonFetch<{ ok: true }>(`/api-keys/${id}`, {
    method: "DELETE"
  });
}

export async function listWebhookEvents(): Promise<{ events: string[] }> {
  return jsonFetch<{ events: string[] }>("/webhooks/events");
}

export async function listWebhooks(): Promise<WebhookEndpointItem[]> {
  return jsonFetch<WebhookEndpointItem[]>("/webhooks");
}

export async function createWebhook(input: {
  url: string;
  description?: string;
  events?: string[];
}): Promise<CreatedWebhookEndpoint> {
  return jsonFetch<CreatedWebhookEndpoint>("/webhooks", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export async function updateWebhook(
  id: string,
  input: {
    url?: string;
    description?: string;
    events?: string[];
    active?: boolean;
  }
): Promise<WebhookEndpointItem> {
  return jsonFetch<WebhookEndpointItem>(`/webhooks/${id}`, {
    method: "PATCH",
    body: JSON.stringify(input)
  });
}

export async function rotateWebhookSecret(id: string): Promise<{ id: string; signingSecret: string }> {
  return jsonFetch<{ id: string; signingSecret: string }>(`/webhooks/${id}/rotate-secret`, {
    method: "POST"
  });
}

export async function deleteWebhook(id: string): Promise<{ ok: true }> {
  return jsonFetch<{ ok: true }>(`/webhooks/${id}`, {
    method: "DELETE"
  });
}

export async function getAdminUsers(): Promise<AdminUser[]> {
  return jsonFetch<AdminUser[]>("/account/admin/users");
}

export async function updateAdminUser(
  userId: string,
  input: { isAdmin?: boolean; suspended?: boolean; locked?: boolean; lockReason?: string }
): Promise<AdminUser> {
  return jsonFetch<AdminUser>(`/account/admin/users/${userId}`, {
    method: "PATCH",
    body: JSON.stringify(input)
  });
}

export async function resetAdminUserPassword(userId: string, password: string): Promise<{ ok: true }> {
  return jsonFetch<{ ok: true }>(`/account/admin/users/${userId}/reset-password`, {
    method: "POST",
    body: JSON.stringify({ password })
  });
}

export async function forceLogoutAdminUser(userId: string): Promise<{ ok: true; revokedSessions: number }> {
  return jsonFetch<{ ok: true; revokedSessions: number }>(`/account/admin/users/${userId}/force-logout`, {
    method: "POST"
  });
}

export async function getAdminApiKeys(): Promise<AdminApiKey[]> {
  return jsonFetch<AdminApiKey[]>("/account/admin/api-keys");
}

export async function updateAdminApiKey(
  apiKeyId: string,
  input: { revoked?: boolean; rateLimited?: boolean; rateLimitReason?: string }
): Promise<AdminApiKey> {
  return jsonFetch<AdminApiKey>(`/account/admin/api-keys/${apiKeyId}`, {
    method: "PATCH",
    body: JSON.stringify(input)
  });
}

export async function retryTask(taskId: string): Promise<TaskStatusResponse> {
  return jsonFetch<TaskStatusResponse>(`/tasks/${taskId}/retry`, {
    method: "POST"
  });
}

export async function createSignatureRequest(input: {
  fileId: string;
  requesterEmail: string;
  title?: string;
  message?: string;
  outputName: string;
  routing: "sequential" | "parallel";
  expiresAt?: string;
  recipients: Array<{
    key: string;
    name?: string;
    email: string;
    role?: string;
    routingOrder: number;
    passcode?: string;
  }>;
  fields: Array<{
    recipientKey: string;
    type: "signature" | "initials" | "name" | "date" | "checkbox" | "text";
    label?: string;
    placeholder?: string;
    required?: boolean;
    page: number;
    x: number;
    y: number;
    width: number;
    height: number;
  }>;
} | {
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
}): Promise<{
  id: string;
  status:
    | "sent"
    | "in_progress"
    | "finalizing"
    | "finalization_failed"
    | "completed"
    | "expired"
    | "revoked";
  routing: "sequential" | "parallel";
  expiresAt: string;
  manageUrl: string;
  signerLinks: Array<{
    recipientId: string;
    name: string | null;
    email: string;
    routingOrder: number;
    status: "waiting" | "notified" | "viewed" | "completed" | "revoked";
    signingUrl: string;
  }>;
} | {
  id: string;
  token: string;
  signingUrl: string;
}> {
  return jsonFetch("/signature-requests", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export async function getSignatureEnvelope(envelopeId: string): Promise<SignatureEnvelopeResponse> {
  return jsonFetch<SignatureEnvelopeResponse>(`/signature-requests/envelopes/${envelopeId}`);
}

export async function listSignatureTemplates(): Promise<SignatureEnvelopeTemplate[]> {
  return jsonFetch<SignatureEnvelopeTemplate[]>("/signature-requests/templates");
}

export async function createSignatureTemplate(input: {
  name: string;
  title?: string;
  requesterEmail?: string;
  message?: string;
  outputName: string;
  routing: "sequential" | "parallel";
  recipients: Array<{
    key: string;
    name?: string;
    email?: string;
    role?: string;
    routingOrder: number;
  }>;
  fields: Array<{
    recipientKey: string;
    type: "signature" | "initials" | "name" | "date" | "checkbox" | "text";
    label?: string;
    placeholder?: string;
    required?: boolean;
    page: number;
    x: number;
    y: number;
    width: number;
    height: number;
  }>;
}): Promise<SignatureEnvelopeTemplate> {
  return jsonFetch<SignatureEnvelopeTemplate>("/signature-requests/templates", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export async function createSignatureTemplateFromEnvelope(
  envelopeId: string,
  name: string
): Promise<SignatureEnvelopeTemplate> {
  return jsonFetch<SignatureEnvelopeTemplate>(`/signature-requests/envelopes/${envelopeId}/templates`, {
    method: "POST",
    body: JSON.stringify({ name })
  });
}

export async function deleteSignatureTemplate(templateId: string): Promise<{ ok: true }> {
  return jsonFetch<{ ok: true }>(`/signature-requests/templates/${templateId}`, {
    method: "DELETE"
  });
}

export async function revokeSignatureEnvelope(envelopeId: string): Promise<{ ok: true }> {
  return jsonFetch<{ ok: true }>(`/signature-requests/envelopes/${envelopeId}/revoke`, {
    method: "POST"
  });
}

export async function retrySignatureEnvelopeFinalization(
  envelopeId: string
): Promise<{ envelopeId: string; taskId: string }> {
  return jsonFetch<{ envelopeId: string; taskId: string }>(
    `/signature-requests/envelopes/${envelopeId}/retry-finalization`,
    {
      method: "POST"
    }
  );
}

export async function remindSignatureRecipient(
  envelopeId: string,
  recipientId: string
): Promise<{ ok: true }> {
  return jsonFetch<{ ok: true }>(
    `/signature-requests/envelopes/${envelopeId}/recipients/${recipientId}/remind`,
    {
      method: "POST"
    }
  );
}

export async function reassignSignatureRecipient(
  envelopeId: string,
  recipientId: string,
  input: { name?: string; email: string; role?: string }
): Promise<{ ok: true; signingUrl: string }> {
  return jsonFetch<{ ok: true; signingUrl: string }>(
    `/signature-requests/envelopes/${envelopeId}/recipients/${recipientId}/reassign`,
    {
      method: "POST",
      body: JSON.stringify(input)
    }
  );
}

export async function getSignatureRequest(token: string): Promise<SignatureRequestResponse> {
  return jsonFetch<SignatureRequestResponse>(`/signature-requests/${token}`);
}

export async function requestSignatureOtp(token: string): Promise<{ ok: true; expiresAt: string }> {
  return jsonFetch<{ ok: true; expiresAt: string }>(`/signature-requests/${token}/otp/request`, {
    method: "POST"
  });
}

export async function verifySignatureOtp(
  token: string,
  otp: string
): Promise<{ ok: true; verification: SignatureRequestResponse["verification"] }> {
  return jsonFetch<{ ok: true; verification: SignatureRequestResponse["verification"] }>(
    `/signature-requests/${token}/otp/verify`,
    {
      method: "POST",
      body: JSON.stringify({ otp })
    }
  );
}

export async function verifySignaturePasscode(
  token: string,
  passcode: string
): Promise<{ ok: true; verification: SignatureRequestResponse["verification"] }> {
  return jsonFetch<{ ok: true; verification: SignatureRequestResponse["verification"] }>(
    `/signature-requests/${token}/passcode/verify`,
    {
      method: "POST",
      body: JSON.stringify({ passcode })
    }
  );
}

export async function completeSignatureRequest(
  token: string,
  fieldValues: Array<{
    fieldId: string;
    textValue?: string;
    checked?: boolean;
    signatureDataUrl?: string;
  }>
): Promise<{ envelopeId: string; status: string; taskId?: string }> {
  return jsonFetch<{ envelopeId: string; status: string; taskId?: string }>(`/signature-requests/${token}/complete`, {
    method: "POST",
    body: JSON.stringify({ fieldValues })
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
    let eventSource: EventSource | null = new window.EventSource(`${API_BASE_URL}/tasks/${taskId}/events`, {
      withCredentials: true
    });
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

export async function queueImageTool(
  fileId: string,
  operation: ImageToolOperation,
  outputName: string,
  options: Record<string, unknown>
): Promise<{ taskId: string }> {
  return jsonFetch<{ taskId: string }>("/tasks/image-tools", {
    method: "POST",
    body: JSON.stringify({ fileId, operation, outputName, options })
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
