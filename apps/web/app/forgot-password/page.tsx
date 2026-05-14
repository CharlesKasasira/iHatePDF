"use client";

import Link from "next/link";
import { useState } from "react";
import { SiteHeader } from "../components/site-header";
import { requestPasswordReset } from "../lib/pdf-api";

export default function ForgotPasswordPage(): React.JSX.Element {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    try {
      setBusy(true);
      await requestPasswordReset(email);
      setStatus("If an account exists for that email, a reset link has been sent.");
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
          <span className="auth-eyebrow">Password recovery</span>
          <h1>Reset your password</h1>
          <p>Enter your account email and we will send a short-lived reset link.</p>
          <form className="auth-form" onSubmit={(event) => void submit(event)}>
            <label>
              Email
              <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required />
            </label>
            <button className="auth-submit" type="submit" disabled={busy}>
              {busy ? "Sending..." : "Send reset link"}
            </button>
          </form>
          {status ? <p className="auth-status">{status}</p> : null}
          <div className="auth-links">
            <Link href="/login">Back to login</Link>
          </div>
        </section>
      </main>
    </div>
  );
}
