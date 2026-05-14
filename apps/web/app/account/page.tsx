"use client";

import Link from "next/link";
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

export default function AccountPage(): React.JSX.Element {
  const { user, loading } = useAuth();
  const [activity, setActivity] = useState<AccountActivityResponse | null>(null);
  const [status, setStatus] = useState("Loading account activity...");

  useEffect(() => {
    if (loading) {
      return;
    }

    if (!user) {
      setStatus("Sign in to view account activity.");
      return;
    }

    void (async () => {
      try {
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
              <h2>Recent tasks</h2>
              {activity.tasks.length === 0 ? <p>No signed-in tasks yet.</p> : null}
              {activity.tasks.map((task) => (
                <div className="activity-card" key={task.id}>
                  <strong>{label(task.type)}</strong>
                  <span>{task.status} · {task.progressPercent}% · {formatDate(task.createdAt)}</span>
                  {task.errorMessage ? <p>{task.errorMessage}</p> : null}
                  {task.outputDownloadUrl ? (
                    <a href={task.outputDownloadUrl} target="_blank" rel="noreferrer">
                      Download {task.outputFileName || "output"}
                    </a>
                  ) : (
                    <small>No active download link.</small>
                  )}
                </div>
              ))}
            </article>

            <article className="account-panel">
              <h2>Signature workflows</h2>
              {activity.signatureEnvelopes.length === 0 ? <p>No signed-in signature workflows yet.</p> : null}
              {activity.signatureEnvelopes.map((workflow) => (
                <div className="activity-card" key={workflow.id}>
                  <strong>{workflow.title || workflow.fileName}</strong>
                  <span>{workflow.status.replace("_", " ")} · expires {formatDate(workflow.expiresAt)}</span>
                  <a href={workflow.manageUrl}>Manage workflow</a>
                  {workflow.finalDownloadUrl ? (
                    <a href={workflow.finalDownloadUrl} target="_blank" rel="noreferrer">
                      Download final PDF
                    </a>
                  ) : (
                    <small>Final PDF is not ready or the link expired.</small>
                  )}
                </div>
              ))}
            </article>

            <article className="account-panel">
              <h2>Recent files</h2>
              {activity.files.length === 0 ? <p>No signed-in files yet.</p> : null}
              {activity.files.map((file) => (
                <div className="activity-card" key={file.id}>
                  <strong>{file.fileName}</strong>
                  <span>{file.mimeType} · uploaded {formatDate(file.createdAt)}</span>
                  {file.expiresAt ? <small>Expires {formatDate(file.expiresAt)}</small> : <small>No expiration set.</small>}
                  {file.downloadUrl ? (
                    <a href={file.downloadUrl} target="_blank" rel="noreferrer">Download</a>
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
