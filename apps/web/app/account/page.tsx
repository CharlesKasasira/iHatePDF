"use client";

import Link from "next/link";
import { CheckCircle2, Clock3, Download, FileText, FolderClock, PenLine, TriangleAlert } from "lucide-react";
import { useEffect, useState } from "react";
import { SiteHeader } from "../components/site-header";
import { useAuth } from "../components/auth-provider";
import { getAccountActivity, type AccountActivityResponse } from "../lib/pdf-api";

function formatDate(value: string | null): string {
  return value ? new Date(value).toLocaleString() : "Not set";
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

  useEffect(() => {
    if (loading) {
      return;
    }

    if (!user) {
      setActivity(null);
      setStatus("Sign in to view account activity.");
      return;
    }

    void (async () => {
      try {
        setActivity(null);
        setStatus("Loading account activity...");
        setActivity(await getAccountActivity());
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
          <span className="auth-eyebrow">Signed-in history</span>
          <h1>{user ? user.name || user.email : "Account"}</h1>
          <p>Recover recent uploads, exports, and signing workflows created while signed in.</p>
          {!loading && !user ? <Link className="auth-submit account-login-link" href="/login">Log in</Link> : null}
        </section>

        {status ? <p className="auth-status">{status}</p> : null}

        {activity ? (
          <section className="account-grid">
            <article className="account-panel">
              <div className="account-panel-heading">
                <span><Clock3 aria-hidden="true" size={18} /> Recent tasks</span>
                <strong>{activity.tasks.length}</strong>
              </div>
              {activity.tasks.length === 0 ? (
                <EmptyActivity title="No tasks yet" body="Signed-in exports and conversions will appear here." />
              ) : null}
              {activity.tasks.map((task) => (
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

            <article className="account-panel">
              <div className="account-panel-heading">
                <span><FileText aria-hidden="true" size={18} /> Recent files</span>
                <strong>{activity.files.length}</strong>
              </div>
              {activity.files.length === 0 ? (
                <EmptyActivity title="No files yet" body="Signed-in uploads will appear here until their retention period ends." />
              ) : null}
              {activity.files.map((file) => (
                <div className="activity-card" key={file.id}>
                  <div className="activity-card__title">
                    <FileText aria-hidden="true" size={18} />
                    <strong>{file.fileName}</strong>
                  </div>
                  <span>{file.mimeType} · uploaded {formatDate(file.createdAt)}</span>
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
          </section>
        ) : null}
      </main>
    </div>
  );
}
