"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { SiteHeader } from "../components/site-header";
import { useAuth } from "../components/auth-provider";

export default function SignupPage(): React.JSX.Element {
  const router = useRouter();
  const { signup } = useAuth();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    try {
      setBusy(true);
      setStatus("");
      await signup({ email, password, name: name.trim() || undefined });
      router.push("/account");
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
          <span className="auth-eyebrow">Optional account</span>
          <h1>Create your iHatePDF account</h1>
          <p>Use the PDF tools without signing up, or create an account to keep sessions and history.</p>
          <form className="auth-form" onSubmit={(event) => void submit(event)}>
            <label>
              Name
              <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Optional" />
            </label>
            <label>
              Email
              <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required />
            </label>
            <label>
              Password
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                minLength={8}
                required
              />
            </label>
            <button className="auth-submit" type="submit" disabled={busy}>
              {busy ? "Creating account..." : "Sign up"}
            </button>
          </form>
          {status ? <p className="auth-status error">{status}</p> : null}
          <div className="auth-links">
            <Link href="/login">Already have an account?</Link>
          </div>
        </section>
      </main>
    </div>
  );
}
