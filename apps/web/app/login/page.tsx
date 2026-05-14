"use client";

import Link from "next/link";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { SiteHeader } from "../components/site-header";
import { useAuth } from "../components/auth-provider";

export default function LoginPage(): React.JSX.Element {
  const router = useRouter();
  const { login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    try {
      setBusy(true);
      setStatus("");
      await login({ email, password });
      const nextPath =
        typeof window !== "undefined"
          ? new URLSearchParams(window.location.search).get("next")
          : null;
      const safeNextPath =
        nextPath && nextPath.startsWith("/") && !nextPath.startsWith("//") ? nextPath : "/account";
      router.push(safeNextPath as Route);
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
          <span className="auth-eyebrow">Account access</span>
          <h1>Log in to your PDF workspace</h1>
          <p>Anonymous tools still work. Logging in keeps your task history and signing workflows recoverable.</p>
          <form className="auth-form" onSubmit={(event) => void submit(event)}>
            <label>
              Email
              <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required />
            </label>
            <label>
              Password
              <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} required />
            </label>
            <button className="auth-submit" type="submit" disabled={busy}>
              {busy ? "Logging in..." : "Log in"}
            </button>
          </form>
          {status ? <p className="auth-status error">{status}</p> : null}
          <div className="auth-links">
            <Link href="/forgot-password">Forgot password?</Link>
            <Link href="/signup">Create an account</Link>
          </div>
        </section>
      </main>
    </div>
  );
}
