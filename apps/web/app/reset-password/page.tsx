"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { SiteHeader } from "../components/site-header";
import { confirmPasswordReset } from "../lib/pdf-api";

export default function ResetPasswordPage(): React.JSX.Element {
  const [token, setToken] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setToken(new URLSearchParams(window.location.search).get("token") ?? "");
  }, []);

  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    try {
      setBusy(true);
      await confirmPasswordReset({ token, password });
      setStatus("Password reset. You can log in with the new password.");
    } catch (error) {
      setStatus((error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="site-shell">
      <SiteHeader />
      <main className="auth-page">
        <section className="auth-card">
          <span className="auth-eyebrow">New password</span>
          <h1>Choose a new password</h1>
          <p>Reset links are single-use and expire quickly.</p>
          <form className="auth-form" onSubmit={(event) => void submit(event)}>
            <label>
              New password
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                minLength={8}
                required
                disabled={!token}
              />
            </label>
            <button className="auth-submit" type="submit" disabled={busy || !token}>
              {busy ? "Saving..." : "Reset password"}
            </button>
          </form>
          {!token ? <p className="auth-status error">Reset token is missing.</p> : null}
          {status ? <p className="auth-status">{status}</p> : null}
          <div className="auth-links">
            <Link href="/login">Log in</Link>
          </div>
        </section>
      </main>
    </div>
  );
}
