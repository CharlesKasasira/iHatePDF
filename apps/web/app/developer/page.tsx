"use client";

import Link from "next/link";
import { AlertTriangle, BarChart3, BookOpen, Code2, Copy, KeyRound, Play, Plus, Terminal, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { SiteHeader } from "../components/site-header";
import { useAuth } from "../components/auth-provider";
import {
  API_BASE_URL,
  createApiKey,
  listApiKeys,
  revokeApiKey,
  type ApiKeyItem,
  type CreatedApiKey
} from "../lib/pdf-api";
import { dateTimeLocalToEatIso, formatEatDateTime } from "../lib/time";

type ExpirationPreset = "7" | "30" | "90" | "none" | "custom";

const expirationPresets: Array<{ value: ExpirationPreset; label: string }> = [
  { value: "7", label: "7 days" },
  { value: "30", label: "30 days" },
  { value: "90", label: "90 days" },
  { value: "none", label: "No expiry" },
  { value: "custom", label: "Custom" }
];

const sdkExamples = {
  node: `const apiKey = process.env.IHATEPDF_API_KEY;
const baseUrl = process.env.IHATEPDF_API_URL ?? "${API_BASE_URL}";

const upload = await fetch(\`\${baseUrl}/v1/files\`, {
  method: "POST",
  headers: { Authorization: \`Bearer \${apiKey}\` },
  body: formData
});

const queued = await fetch(\`\${baseUrl}/v1/tasks/compress\`, {
  method: "POST",
  headers: {
    Authorization: \`Bearer \${apiKey}\`,
    "Content-Type": "application/json"
  },
  body: JSON.stringify({ fileId, outputName: "compressed.pdf" })
});`,
  python: `import os, requests

base_url = os.getenv("IHATEPDF_API_URL", "${API_BASE_URL}")
headers = {"Authorization": f"Bearer {os.environ['IHATEPDF_API_KEY']}"}

with open("contract.pdf", "rb") as source:
    upload = requests.post(
        f"{base_url}/v1/files",
        headers=headers,
        files={"file": source},
        data={"retentionHours": "24"},
    )
upload.raise_for_status()`
};

function formatDate(value: string | null): string {
  return formatEatDateTime(value);
}

function toIsoDateTime(value: string): string | undefined {
  return dateTimeLocalToEatIso(value);
}

function addDaysIso(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString();
}

export default function DeveloperPage(): React.JSX.Element {
  const { user, loading } = useAuth();
  const [keys, setKeys] = useState<ApiKeyItem[]>([]);
  const [name, setName] = useState("");
  const [expirationPreset, setExpirationPreset] = useState<ExpirationPreset>("30");
  const [expiresAt, setExpiresAt] = useState("");
  const [createdKey, setCreatedKey] = useState<CreatedApiKey | null>(null);
  const [status, setStatus] = useState("Loading developer tools...");
  const [busyKeyId, setBusyKeyId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [tryApiKey, setTryApiKey] = useState("");
  const [tryMethod, setTryMethod] = useState<"GET" | "POST">("GET");
  const [tryPath, setTryPath] = useState("/v1/queue/status");
  const [tryBody, setTryBody] = useState('{\n  "fileId": "file_...",\n  "outputName": "compressed.pdf"\n}');
  const [tryResponse, setTryResponse] = useState("");
  const [tryingRequest, setTryingRequest] = useState(false);

  const activeKeys = useMemo(() => keys.filter((key) => !key.revokedAt), [keys]);

  const loadKeys = async (): Promise<void> => {
    setKeys(await listApiKeys());
    setStatus("");
  };

  useEffect(() => {
    if (loading) {
      return;
    }

    if (!user) {
      setKeys([]);
      setStatus("Sign in to create API keys.");
      return;
    }

    void loadKeys().catch((error) => setStatus((error as Error).message));
  }, [user, loading]);

  const onCreate = async (): Promise<void> => {
    if (!name.trim()) {
      setStatus("Name the API key first.");
      return;
    }

    if (expirationPreset === "custom" && !expiresAt) {
      setStatus("Choose a custom expiration date or select a preset.");
      return;
    }

    const nextExpiresAt =
      expirationPreset === "none"
        ? undefined
        : expirationPreset === "custom"
          ? toIsoDateTime(expiresAt)
          : addDaysIso(Number(expirationPreset));

    try {
      setCreating(true);
      setStatus("Creating API key...");
      const key = await createApiKey({
        name: name.trim(),
        expiresAt: nextExpiresAt
      });
      setCreatedKey(key);
      setName("");
      setExpirationPreset("30");
      setExpiresAt("");
      await loadKeys();
      setStatus("API key created. Copy it now; it will not be shown again.");
    } catch (error) {
      setStatus((error as Error).message);
    } finally {
      setCreating(false);
    }
  };

  const onRevoke = async (keyId: string): Promise<void> => {
    try {
      setBusyKeyId(keyId);
      setStatus("Revoking API key...");
      await revokeApiKey(keyId);
      await loadKeys();
      setStatus("API key revoked.");
    } catch (error) {
      setStatus((error as Error).message);
    } finally {
      setBusyKeyId(null);
    }
  };

  const copyText = async (value: string, message: string): Promise<void> => {
    await navigator.clipboard.writeText(value);
    setStatus(message);
  };

  const sendTryRequest = async (): Promise<void> => {
    if (!tryApiKey.trim()) {
      setStatus("Paste an API key before trying the request.");
      return;
    }

    try {
      setTryingRequest(true);
      setTryResponse("Sending request...");
      const response = await fetch(`${API_BASE_URL}${tryPath}`, {
        method: tryMethod,
        headers: {
          Authorization: `Bearer ${tryApiKey.trim()}`,
          ...(tryMethod === "POST" ? { "Content-Type": "application/json" } : {})
        },
        body: tryMethod === "POST" ? tryBody : undefined
      });
      const text = await response.text();
      try {
        setTryResponse(JSON.stringify(JSON.parse(text), null, 2));
      } catch {
        setTryResponse(text || `HTTP ${response.status}`);
      }
      setStatus(`Try request completed with HTTP ${response.status}.`);
    } catch (error) {
      setTryResponse((error as Error).message);
      setStatus("Try request failed.");
    } finally {
      setTryingRequest(false);
    }
  };

  const curlExample = `curl -X POST "${API_BASE_URL}/v1/files" \\
  -H "Authorization: Bearer $IHATEPDF_API_KEY" \\
  -F "file=@contract.pdf"`;

  return (
    <div className="site-shell">
      <SiteHeader />
      <main className="account-page">
        <section className="account-hero">
          <span className="auth-eyebrow">Developer</span>
          <h1>API keys and automation access</h1>
          <p>Create scoped API keys for scripts, integrations, batch jobs, and internal document pipelines.</p>
          <div className="account-hero-actions">
            {!loading && !user ? <Link className="auth-submit account-login-link" href="/login">Log in</Link> : null}
            <Link className="auth-submit account-login-link" href="/automation">Manage webhooks</Link>
          </div>
        </section>

        {status ? <p className="auth-status">{status}</p> : null}

        {createdKey ? (
          <section className="developer-secret-panel">
            <div>
              <strong>New API key</strong>
              <span>Store this secret now. The server only keeps a hash after creation.</span>
            </div>
            <code>{createdKey.key}</code>
            <button
              className="activity-action-button"
              type="button"
              onClick={() => void copyText(createdKey.key, "API key copied.")}
            >
              <Copy aria-hidden="true" size={16} />
              Copy key
            </button>
          </section>
        ) : null}

        {user ? (
          <section className="account-grid account-grid--tools">
            <article className="account-panel">
              <div className="account-panel-heading">
                <span><Plus aria-hidden="true" size={18} /> Create API key</span>
                <strong>{activeKeys.length}</strong>
              </div>
              <label htmlFor="api-key-name">Key name</label>
              <input
                id="api-key-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Nightly document job"
              />

              <fieldset className="token-expiry-fieldset">
                <legend>Expiration</legend>
                <div className="token-expiry-options">
                  {expirationPresets.map((preset) => (
                    <label
                      className={`token-expiry-option ${expirationPreset === preset.value ? "is-selected" : ""}`}
                      key={preset.value}
                    >
                      <input
                        checked={expirationPreset === preset.value}
                        name="api-key-expiration"
                        onChange={() => setExpirationPreset(preset.value)}
                        type="radio"
                        value={preset.value}
                      />
                      <span>{preset.label}</span>
                    </label>
                  ))}
                </div>
              </fieldset>

              {expirationPreset === "custom" ? (
                <>
                  <label htmlFor="api-key-expiry">Custom expiration</label>
                  <input
                    id="api-key-expiry"
                    type="datetime-local"
                    value={expiresAt}
                    onChange={(event) => setExpiresAt(event.target.value)}
                  />
                </>
              ) : null}

              <button className="start-process-btn" type="button" disabled={creating} onClick={() => void onCreate()}>
                {creating ? "Creating..." : "Create API key"}
              </button>
            </article>

            <article className="account-panel">
              <div className="account-panel-heading">
                <span><Terminal aria-hidden="true" size={18} /> Quick request</span>
                <strong>v1</strong>
              </div>
              <p>Use API keys with the stable versioned endpoints under <code>/api/v1</code>.</p>
              <pre className="developer-code"><code>{curlExample}</code></pre>
              <button
                className="activity-action-button"
                type="button"
                onClick={() => void copyText(curlExample, "Upload example copied.")}
              >
                <Copy aria-hidden="true" size={16} />
                Copy example
              </button>
            </article>

            <article className="account-panel">
              <div className="account-panel-heading">
                <span><BookOpen aria-hidden="true" size={18} /> OpenAPI docs</span>
                <strong>3.1</strong>
              </div>
              <p>Use the machine-readable schema for generated clients, Postman imports, and endpoint discovery.</p>
              <div className="management-actions">
                <a className="activity-action-button" href={`${API_BASE_URL}/v1/openapi.json`} target="_blank" rel="noreferrer">
                  <BookOpen aria-hidden="true" size={16} />
                  Open schema
                </a>
                <button className="activity-action-button" type="button" onClick={() => void copyText("docs/API.md", "Docs path copied.")}>
                  <Code2 aria-hidden="true" size={16} />
                  API guide
                </button>
              </div>
            </article>

            <article className="account-panel account-panel--wide">
              <div className="account-panel-heading">
                <span><Play aria-hidden="true" size={18} /> Try this request</span>
                <strong>{tryMethod}</strong>
              </div>
              <div className="developer-try-grid">
                <label>
                  API key
                  <input
                    value={tryApiKey}
                    onChange={(event) => setTryApiKey(event.target.value)}
                    placeholder="ihp_..."
                    type="password"
                  />
                </label>
                <label>
                  Method
                  <select value={tryMethod} onChange={(event) => setTryMethod(event.target.value as "GET" | "POST")}>
                    <option value="GET">GET</option>
                    <option value="POST">POST</option>
                  </select>
                </label>
                <label>
                  Path
                  <select
                    value={tryPath}
                    onChange={(event) => {
                      setTryPath(event.target.value);
                      setTryMethod(event.target.value.includes("/tasks/") ? "POST" : "GET");
                    }}
                  >
                    <option value="/v1/queue/status">/v1/queue/status</option>
                    <option value="/v1/tasks/compress">/v1/tasks/compress</option>
                    <option value="/v1/tasks/merge">/v1/tasks/merge</option>
                  </select>
                </label>
              </div>
              {tryMethod === "POST" ? (
                <>
                  <label htmlFor="try-request-body">JSON body</label>
                  <textarea
                    id="try-request-body"
                    className="developer-try-body"
                    value={tryBody}
                    onChange={(event) => setTryBody(event.target.value)}
                  />
                </>
              ) : null}
              <button className="start-process-btn" type="button" disabled={tryingRequest} onClick={() => void sendTryRequest()}>
                {tryingRequest ? "Sending..." : "Send request"}
              </button>
              <pre className="developer-code"><code>{tryResponse || "Response appears here."}</code></pre>
            </article>

            <article className="account-panel account-panel--wide">
              <div className="account-panel-heading">
                <span><Code2 aria-hidden="true" size={18} /> SDK examples</span>
                <strong>Node + Python</strong>
              </div>
              <div className="developer-sdk-grid">
                <div>
                  <strong>Node.js</strong>
                  <pre className="developer-code"><code>{sdkExamples.node}</code></pre>
                </div>
                <div>
                  <strong>Python</strong>
                  <pre className="developer-code"><code>{sdkExamples.python}</code></pre>
                </div>
              </div>
            </article>

            <article className="account-panel account-panel--wide">
              <div className="account-panel-heading">
                <span><AlertTriangle aria-hidden="true" size={18} /> Error codes</span>
                <strong>Predictable</strong>
              </div>
              <div className="developer-error-grid">
                <span><strong>400</strong> Invalid payload, unsupported file type, or missing task fields.</span>
                <span><strong>401</strong> Missing, expired, revoked, or invalid API key.</span>
                <span><strong>404</strong> File, task, signature workflow, or webhook delivery was not found for this owner.</span>
                <span><strong>410</strong> File retention window expired.</span>
                <span><strong>429</strong> Rate limit exceeded. Retry after slowing the caller.</span>
                <span><strong>500</strong> Unexpected processing failure. Check task status and retry safely.</span>
              </div>
            </article>

            <article className="account-panel account-panel--wide">
              <div className="account-panel-heading">
                <span><KeyRound aria-hidden="true" size={18} /> API keys</span>
                <strong>{keys.length}</strong>
              </div>
              {keys.length === 0 ? (
                <div className="account-empty-state">
                  <KeyRound aria-hidden="true" size={24} />
                  <strong>No API keys yet</strong>
                  <span>Create a key to start using upload, queue, status, and signing endpoints from scripts.</span>
                </div>
              ) : null}
              {keys.map((key) => (
                <div className={`activity-card ${key.revokedAt ? "is-error" : ""}`} key={key.id}>
                  <div className="activity-card__title">
                    <KeyRound aria-hidden="true" size={18} />
                    <strong>{key.name}</strong>
                  </div>
                  <span>{key.keyPrefix} - created {formatDate(key.createdAt)}</span>
                  <small>Last used {formatDate(key.lastUsedAt)} - expires {formatDate(key.expiresAt)}</small>
                  <div className="developer-usage-grid">
                    <span><BarChart3 aria-hidden="true" size={15} /> {key.usage.total} total calls</span>
                    <span>{key.usage.last30Days} calls in 30 days</span>
                  </div>
                  {key.usage.byRoute.length > 0 ? (
                    <div className="developer-route-list">
                      {key.usage.byRoute.map((route) => (
                        <small key={`${key.id}-${route.method}-${route.route}`}>
                          {route.method} {route.route} - {route.count} calls
                        </small>
                      ))}
                    </div>
                  ) : null}
                  {key.revokedAt ? (
                    <small>Revoked {formatDate(key.revokedAt)}</small>
                  ) : (
                    <button
                      className="activity-action-button"
                      type="button"
                      disabled={busyKeyId === key.id}
                      onClick={() => void onRevoke(key.id)}
                    >
                      <Trash2 aria-hidden="true" size={16} />
                      {busyKeyId === key.id ? "Revoking..." : "Revoke"}
                    </button>
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
