"use client";

import Link from "next/link";
import {
  CheckCircle2,
  Clock3,
  Download,
  FileText,
  FolderClock,
  Gauge,
  HardDrive,
  KeyRound,
  PenLine,
  RefreshCcw,
  TriangleAlert,
  Webhook
} from "lucide-react";
import { useEffect, useState } from "react";
import { SiteHeader } from "../components/site-header";
import { useAuth } from "../components/auth-provider";
import { getAccountActivity, retryTask, type AccountActivityResponse } from "../lib/pdf-api";

function formatDate(value: string | null): string {
  return value ? new Date(value).toLocaleString() : "Not set";
}

function formatBytes(value: string): string {
  const bytes = Number(value);
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0 B";
  }

  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** index).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

function label(value: string): string {
  return value.replaceAll("_", " ").replaceAll("-", " ");
}

function isErrorStatus(value: string): boolean {
  return value === "failed" || value === "finalization_failed" || value === "expired" || value === "revoked";
}

function EmptyActivity({ title, body }: { title: string; body: string }): React.JSX.Element {
  return (
    <div className="account-empty-state">
      <FolderClock aria-hidden="true" size={24} />
      <strong>{title}</strong>
      <span>{body}</span>
    </div>
  );
}

export default function AccountPage(): React.JSX.Element {
  const { user, loading } = useAuth();
  const [activity, setActivity] = useState<AccountActivityResponse | null>(null);
  const [status, setStatus] = useState("Loading account activity...");
  const [retryingTaskId, setRetryingTaskId] = useState<string | null>(null);

  const loadActivity = async (): Promise<void> => {
    setActivity(null);
    setStatus("Loading account activity...");
    setActivity(await getAccountActivity());
    setStatus("");
  };

  useEffect(() => {
    if (loading) {
      return;
    }

    if (!user) {
      setActivity(null);
      setStatus("Sign in to view account activity.");
      return;
    }

    void loadActivity().catch((error) => {
      setStatus((error as Error).message);
    });
  }, [user, loading]);

  const onRetryTask = async (taskId: string): Promise<void> => {
    try {
      setRetryingTaskId(taskId);
      await retryTask(taskId);
      await loadActivity();
    } catch (error) {
      setStatus((error as Error).message);
    } finally {
      setRetryingTaskId(null);
    }
  };

  return (
    <div className="site-shell">
      <SiteHeader />
      <main className="account-page">
        <section className="account-hero">
          <span className="auth-eyebrow">Account tools</span>
          <h1>{user ? user.name || user.email : "Account"}</h1>
          <p>Track file history, storage, API activity, webhook delivery, and task retry state.</p>
          <div className="account-hero-actions">
            {!loading && !user ? <Link className="auth-submit account-login-link" href="/login">Log in</Link> : null}
            {user?.isAdmin ? <Link className="auth-submit account-login-link" href="/admin">Open admin</Link> : null}
          </div>
        </section>

        {status ? <p className="auth-status">{status}</p> : null}

        {activity ? (
          <>
            <section className="account-summary-grid">
              <div className="account-stat">
                <HardDrive aria-hidden="true" size={20} />
                <span>Storage</span>
                <strong>{formatBytes(activity.storageUsage.totalBytes)}</strong>
                <small>{activity.storageUsage.fileCount} files · {activity.storageUsage.expiringSoonCount} expiring soon</small>
              </div>
              <div className="account-stat">
                <Gauge aria-hidden="true" size={20} />
                <span>API usage</span>
                <strong>{activity.apiUsage.eventsLast30Days}</strong>
                <small>{activity.apiUsage.totalEvents} all time · {activity.apiUsage.activeApiKeyCount} active keys</small>
              </div>
              <div className="account-stat">
                <Webhook aria-hidden="true" size={20} />
                <span>Webhooks</span>
                <strong>{activity.webhooks.deliveries.filter((delivery) => delivery.status === "failed").length}</strong>
                <small>{activity.webhooks.activeEndpointCount} active endpoints · failed deliveries shown</small>
              </div>
              <div className="account-stat">
                <RefreshCcw aria-hidden="true" size={20} />
                <span>Retries</span>
                <strong>{activity.retryVisibility.failedTaskCount}</strong>
                <small>{activity.retryVisibility.retriedTaskCount} tasks retried</small>
              </div>
            </section>

            <section className="account-grid account-grid--tools">
              <article className="account-panel">
                <div className="account-panel-heading">
                  <span><FileText aria-hidden="true" size={18} /> File history</span>
                  <strong>{activity.files.length}</strong>
                </div>
                {activity.files.length === 0 ? (
                  <EmptyActivity title="No files yet" body="Signed-in uploads will appear here until their retention period ends." />
                ) : null}
                {activity.files.slice(0, 8).map((file) => (
                  <div className="activity-card" key={file.id}>
                    <div className="activity-card__title">
                      <FileText aria-hidden="true" size={18} />
                      <strong>{file.fileName}</strong>
                    </div>
                    <span>{file.mimeType} · {formatBytes(file.sizeBytes)} · uploaded {formatDate(file.createdAt)}</span>
                    {file.expiresAt ? <small>Expires {formatDate(file.expiresAt)}</small> : <small>No expiration set.</small>}
                    {file.downloadUrl ? (
                      <a className="activity-action" href={file.downloadUrl} target="_blank" rel="noreferrer">
                        <Download aria-hidden="true" size={16} />
                        Download
                      </a>
                    ) : (
                      <small>Download unavailable or expired.</small>
                    )}
                  </div>
                ))}
              </article>

              <article className="account-panel">
                <div className="account-panel-heading">
                  <span><KeyRound aria-hidden="true" size={18} /> API usage</span>
                  <strong>{activity.apiUsage.apiKeyCount}</strong>
                </div>
                {activity.apiUsage.keys.length === 0 ? (
                  <EmptyActivity title="No API keys" body="Create API keys to see request usage by key and route." />
                ) : null}
                {activity.apiUsage.keys.slice(0, 5).map((apiKey) => (
                  <div className="activity-card" key={apiKey.id}>
                    <div className="activity-card__title">
                      <KeyRound aria-hidden="true" size={18} />
                      <strong>{apiKey.name}</strong>
                    </div>
                    <span>{apiKey.keyPrefix} · {apiKey.usageCount} requests · last used {formatDate(apiKey.lastUsedAt)}</span>
                    {apiKey.revokedAt ? <small>Revoked {formatDate(apiKey.revokedAt)}</small> : <small>Expires {formatDate(apiKey.expiresAt)}</small>}
                  </div>
                ))}
                {activity.apiUsage.recentEvents.slice(0, 5).map((event) => (
                  <div className="activity-card" key={event.id}>
                    <span>{event.method} {event.route}</span>
                    <small>{event.apiKeyName || event.apiKeyPrefix || "API key"} · {formatDate(event.createdAt)}</small>
                  </div>
                ))}
              </article>

              <article className="account-panel">
                <div className="account-panel-heading">
                  <span><Webhook aria-hidden="true" size={18} /> Webhook delivery</span>
                  <strong>{activity.webhooks.deliveries.length}</strong>
                </div>
                {activity.webhooks.deliveries.length === 0 ? (
                  <EmptyActivity title="No deliveries" body="Webhook attempts will show endpoint, status, attempts, and response codes." />
                ) : null}
                {activity.webhooks.deliveries.slice(0, 8).map((delivery) => (
                  <div className={`activity-card ${isErrorStatus(delivery.status) ? "is-error" : ""}`} key={delivery.id}>
                    <div className="activity-card__title">
                      {delivery.status === "delivered" ? <CheckCircle2 aria-hidden="true" size={18} /> : <TriangleAlert aria-hidden="true" size={18} />}
                      <strong>{delivery.eventType}</strong>
                    </div>
                    <span>{delivery.status} · attempts {delivery.attemptCount} · HTTP {delivery.responseStatus ?? "n/a"}</span>
                    <small>{delivery.endpointUrl}</small>
                    {delivery.errorMessage ? <p>{delivery.errorMessage}</p> : null}
                  </div>
                ))}
              </article>

              <article className="account-panel">
                <div className="account-panel-heading">
                  <span><RefreshCcw aria-hidden="true" size={18} /> Task retry visibility</span>
                  <strong>{activity.retryVisibility.failedTaskCount}</strong>
                </div>
                {activity.retryVisibility.tasks.length === 0 ? (
                  <EmptyActivity title="No failed tasks" body="Failed tasks that can be retried will appear here." />
                ) : null}
                {activity.retryVisibility.tasks.map((task) => (
                  <div className="activity-card is-error" key={task.id}>
                    <div className="activity-card__title">
                      <TriangleAlert aria-hidden="true" size={18} />
                      <strong>{label(task.type)}</strong>
                    </div>
                    <span>{task.retryHint}</span>
                    <small>{task.retryCount} retries · last retry {formatDate(task.lastRetriedAt)} · failed {formatDate(task.updatedAt)}</small>
                    {task.errorMessage ? <p>{task.errorMessage}</p> : null}
                    {task.canRetry ? (
                      <button
                        className="activity-action-button"
                        type="button"
                        disabled={retryingTaskId === task.id}
                        onClick={() => void onRetryTask(task.id)}
                      >
                        <RefreshCcw aria-hidden="true" size={16} />
                        {retryingTaskId === task.id ? "Retrying" : "Retry task"}
                      </button>
                    ) : null}
                  </div>
                ))}
              </article>

              <article className="account-panel">
                <div className="account-panel-heading">
                  <span><Clock3 aria-hidden="true" size={18} /> Recent tasks</span>
                  <strong>{activity.tasks.length}</strong>
                </div>
                {activity.tasks.length === 0 ? (
                  <EmptyActivity title="No tasks yet" body="Signed-in exports and conversions will appear here." />
                ) : null}
                {activity.tasks.slice(0, 8).map((task) => (
                  <div className={`activity-card ${isErrorStatus(task.status) ? "is-error" : ""}`} key={task.id}>
                    <div className="activity-card__title">
                      {isErrorStatus(task.status) ? (
                        <TriangleAlert aria-hidden="true" size={18} />
                      ) : (
                        <CheckCircle2 aria-hidden="true" size={18} />
                      )}
                      <strong>{label(task.type)}</strong>
                    </div>
                    <span>{label(task.status)} · {task.progressPercent}% · {formatDate(task.createdAt)}</span>
                    {task.progressMessage ? <small>{task.progressMessage}</small> : null}
                    {task.errorMessage ? <p>{task.errorMessage}</p> : null}
                    {task.outputDownloadUrl ? (
                      <a className="activity-action" href={task.outputDownloadUrl} target="_blank" rel="noreferrer">
                        <Download aria-hidden="true" size={16} />
                        Download {task.outputFileName || "output"}
                      </a>
                    ) : (
                      <small>No active download link.</small>
                    )}
                  </div>
                ))}
              </article>

              <article className="account-panel">
                <div className="account-panel-heading">
                  <span><PenLine aria-hidden="true" size={18} /> Signature workflows</span>
                  <strong>{activity.signatureEnvelopes.length}</strong>
                </div>
                {activity.signatureEnvelopes.length === 0 ? (
                  <EmptyActivity title="No signing workflows" body="Sent signature packets will show routing, status, and final downloads." />
                ) : null}
                {activity.signatureEnvelopes.map((workflow) => (
                  <div className={`activity-card ${isErrorStatus(workflow.status) ? "is-error" : ""}`} key={workflow.id}>
                    <div className="activity-card__title">
                      <PenLine aria-hidden="true" size={18} />
                      <strong>{workflow.title || workflow.fileName}</strong>
                    </div>
                    <span>{workflow.status.replace("_", " ")} · expires {formatDate(workflow.expiresAt)}</span>
                    <a className="activity-action" href={workflow.manageUrl}>Manage workflow</a>
                    {workflow.finalDownloadUrl ? (
                      <a className="activity-action" href={workflow.finalDownloadUrl} target="_blank" rel="noreferrer">
                        <Download aria-hidden="true" size={16} />
                        Download final PDF
                      </a>
                    ) : (
                      <small>Final PDF is not ready or the link expired.</small>
                    )}
                  </div>
                ))}
              </article>
            </section>
          </>
        ) : null}
      </main>
    </div>
  );
}
