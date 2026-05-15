"use client";

import { Activity, Database, FileText, Gauge, HardDrive, RefreshCcw, ServerCog, TriangleAlert, Webhook } from "lucide-react";
import { useEffect, useState } from "react";
import { SiteHeader } from "../components/site-header";
import { useAuth } from "../components/auth-provider";
import { getAdminDashboard, type AdminDashboardResponse } from "../lib/pdf-api";

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

export default function AdminPage(): React.JSX.Element {
  const { user, loading } = useAuth();
  const [dashboard, setDashboard] = useState<AdminDashboardResponse | null>(null);
  const [status, setStatus] = useState("Loading admin tools...");

  useEffect(() => {
    if (loading) {
      return;
    }

    if (!user) {
      setStatus("Sign in with an admin account to continue.");
      setDashboard(null);
      return;
    }

    if (!user.isAdmin) {
      setStatus("Admin access is required.");
      setDashboard(null);
      return;
    }

    void (async () => {
      try {
        setDashboard(await getAdminDashboard());
        setStatus("");
      } catch (error) {
        setStatus((error as Error).message);
      }
    })();
  }, [user, loading]);

  return (
    <div className="site-shell">
      <SiteHeader />
      <main className="account-page">
        <section className="account-hero">
          <span className="auth-eyebrow">Admin tools</span>
          <h1>Operations dashboard</h1>
          <p>Review global file history, storage usage, API usage, webhook delivery status, and failed task retry state.</p>
        </section>

        {status ? <p className="auth-status">{status}</p> : null}

        {dashboard ? (
          <>
            <section className="account-summary-grid">
              <div className="account-stat">
                <Database aria-hidden="true" size={20} />
                <span>Users</span>
                <strong>{dashboard.counts.users}</strong>
                <small>{dashboard.counts.files} files · {dashboard.counts.tasks} tasks</small>
              </div>
              <div className="account-stat">
                <HardDrive aria-hidden="true" size={20} />
                <span>Storage</span>
                <strong>{formatBytes(dashboard.storageUsage.totalBytes)}</strong>
                <small>Across all owners</small>
              </div>
              <div className="account-stat">
                <Gauge aria-hidden="true" size={20} />
                <span>API events</span>
                <strong>{dashboard.apiUsage.eventsLast30Days}</strong>
                <small>{dashboard.apiUsage.totalEvents} all time · {dashboard.counts.apiKeys} keys</small>
              </div>
              <div className="account-stat">
                <Webhook aria-hidden="true" size={20} />
                <span>Webhook deliveries</span>
                <strong>{dashboard.counts.webhookDeliveries}</strong>
                <small>{dashboard.counts.webhookEndpoints} endpoints</small>
              </div>
            </section>

            <section className="account-grid account-grid--tools">
              <article className="account-panel">
                <div className="account-panel-heading">
                  <span><ServerCog aria-hidden="true" size={18} /> Queue status</span>
                  <strong>{dashboard.taskRetryVisibility.queue?.waiting ?? 0}</strong>
                </div>
                {dashboard.taskRetryVisibility.queue ? (
                  <div className="account-meta-list">
                    <span>Active <strong>{dashboard.taskRetryVisibility.queue.active}</strong></span>
                    <span>Waiting <strong>{dashboard.taskRetryVisibility.queue.waiting}</strong></span>
                    <span>Delayed <strong>{dashboard.taskRetryVisibility.queue.delayed}</strong></span>
                    <span>Failed <strong>{dashboard.taskRetryVisibility.queue.failed}</strong></span>
                  </div>
                ) : (
                  <p>Queue status is unavailable.</p>
                )}
                {dashboard.taskRetryVisibility.byStatus.map((statusItem) => (
                  <div className="activity-card" key={statusItem.status}>
                    <span>{label(statusItem.status)}</span>
                    <strong>{statusItem.count}</strong>
                  </div>
                ))}
              </article>

              <article className="account-panel">
                <div className="account-panel-heading">
                  <span><RefreshCcw aria-hidden="true" size={18} /> Failed tasks</span>
                  <strong>{dashboard.taskRetryVisibility.failedTasks.length}</strong>
                </div>
                {dashboard.taskRetryVisibility.failedTasks.map((task) => (
                  <div className="activity-card is-error" key={task.id}>
                    <div className="activity-card__title">
                      <TriangleAlert aria-hidden="true" size={18} />
                      <strong>{label(task.type)}</strong>
                    </div>
                    <span>{task.ownerEmail || "Guest"} · {task.retryCount} retries · {formatDate(task.updatedAt)}</span>
                    {task.errorMessage ? <p>{task.errorMessage}</p> : null}
                  </div>
                ))}
              </article>

              <article className="account-panel">
                <div className="account-panel-heading">
                  <span><Activity aria-hidden="true" size={18} /> API usage</span>
                  <strong>{dashboard.apiUsage.recentEvents.length}</strong>
                </div>
                {dashboard.apiUsage.recentEvents.map((event) => (
                  <div className="activity-card" key={event.id}>
                    <span>{event.method} {event.route}</span>
                    <small>{event.ownerEmail} · {event.apiKeyName || "API key"} · {formatDate(event.createdAt)}</small>
                  </div>
                ))}
              </article>

              <article className="account-panel">
                <div className="account-panel-heading">
                  <span><Webhook aria-hidden="true" size={18} /> Webhook deliveries</span>
                  <strong>{dashboard.webhookDeliveries.length}</strong>
                </div>
                {dashboard.webhookDeliveries.map((delivery) => (
                  <div className={`activity-card ${delivery.status === "failed" ? "is-error" : ""}`} key={delivery.id}>
                    <strong>{delivery.eventType}</strong>
                    <span>{delivery.status} · attempts {delivery.attemptCount} · HTTP {delivery.responseStatus ?? "n/a"}</span>
                    <small>{delivery.endpointUrl} · {formatDate(delivery.createdAt)}</small>
                    {delivery.errorMessage ? <p>{delivery.errorMessage}</p> : null}
                  </div>
                ))}
              </article>

              <article className="account-panel">
                <div className="account-panel-heading">
                  <span><HardDrive aria-hidden="true" size={18} /> Storage by owner</span>
                  <strong>{dashboard.storageUsage.topOwners.length}</strong>
                </div>
                {dashboard.storageUsage.topOwners.map((owner) => (
                  <div className="activity-card" key={owner.ownerId || "guest"}>
                    <strong>{owner.ownerEmail || "Guest uploads"}</strong>
                    <span>{formatBytes(owner.totalBytes)} · {owner.fileCount} files</span>
                  </div>
                ))}
              </article>

              <article className="account-panel">
                <div className="account-panel-heading">
                  <span><FileText aria-hidden="true" size={18} /> File history</span>
                  <strong>{dashboard.fileHistory.length}</strong>
                </div>
                {dashboard.fileHistory.map((file) => (
                  <div className="activity-card" key={file.id}>
                    <strong>{file.fileName}</strong>
                    <span>{file.ownerEmail || "Guest"} · {formatBytes(file.sizeBytes)} · {formatDate(file.createdAt)}</span>
                    <small>{file.mimeType}</small>
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
