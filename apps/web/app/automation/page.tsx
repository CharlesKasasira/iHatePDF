"use client";

import Link from "next/link";
import { Copy, RefreshCcw, Save, Trash2, Webhook } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { SiteHeader } from "../components/site-header";
import { useAuth } from "../components/auth-provider";
import {
  createWebhook,
  deleteWebhook,
  listWebhookEvents,
  listWebhooks,
  rotateWebhookSecret,
  updateWebhook,
  type CreatedWebhookEndpoint,
  type WebhookEndpointItem
} from "../lib/pdf-api";

type WebhookDraft = {
  url: string;
  description: string;
  events: string[];
  active: boolean;
};

function formatDate(value: string): string {
  return new Date(value).toLocaleString();
}

function eventsFromUnknown(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return ["*"];
  }

  const events = value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
  return events.length > 0 ? events : ["*"];
}

function eventLabel(value: string): string {
  if (value === "*") {
    return "All events";
  }
  return value.replaceAll(".", " ");
}

function normalizedEvents(events: string[]): string[] {
  return events.includes("*") || events.length === 0 ? ["*"] : events;
}

function EventPicker({
  availableEvents,
  selectedEvents,
  onChange
}: {
  availableEvents: string[];
  selectedEvents: string[];
  onChange: (events: string[]) => void;
}): React.JSX.Element {
  const selected = new Set(selectedEvents);

  const toggleEvent = (eventName: string): void => {
    if (eventName === "*") {
      onChange(["*"]);
      return;
    }

    const next = new Set(selectedEvents.filter((item) => item !== "*"));
    if (next.has(eventName)) {
      next.delete(eventName);
    } else {
      next.add(eventName);
    }
    onChange(normalizedEvents([...next]));
  };

  return (
    <div className="event-grid">
      {["*", ...availableEvents].map((eventName) => (
        <label className="event-chip" key={eventName}>
          <input
            type="checkbox"
            checked={selected.has(eventName)}
            onChange={() => toggleEvent(eventName)}
          />
          <span>{eventLabel(eventName)}</span>
        </label>
      ))}
    </div>
  );
}

function WebhookCard({
  endpoint,
  availableEvents,
  onChanged,
  onSecret,
  onStatus
}: {
  endpoint: WebhookEndpointItem;
  availableEvents: string[];
  onChanged: () => Promise<void>;
  onSecret: (secret: CreatedWebhookEndpoint["signingSecret"]) => void;
  onStatus: (message: string) => void;
}): React.JSX.Element {
  const [draft, setDraft] = useState<WebhookDraft>({
    url: endpoint.url,
    description: endpoint.description ?? "",
    events: eventsFromUnknown(endpoint.events),
    active: endpoint.active
  });
  const [busy, setBusy] = useState("");

  const save = async (): Promise<void> => {
    try {
      setBusy("save");
      onStatus("Saving webhook endpoint...");
      await updateWebhook(endpoint.id, {
        url: draft.url.trim(),
        description: draft.description.trim(),
        events: normalizedEvents(draft.events),
        active: draft.active
      });
      await onChanged();
      onStatus("Webhook endpoint saved.");
    } catch (error) {
      onStatus((error as Error).message);
    } finally {
      setBusy("");
    }
  };

  const rotate = async (): Promise<void> => {
    try {
      setBusy("rotate");
      onStatus("Rotating webhook signing secret...");
      const result = await rotateWebhookSecret(endpoint.id);
      onSecret(result.signingSecret);
      onStatus("Webhook signing secret rotated. Copy it now.");
    } catch (error) {
      onStatus((error as Error).message);
    } finally {
      setBusy("");
    }
  };

  const remove = async (): Promise<void> => {
    try {
      setBusy("delete");
      onStatus("Deleting webhook endpoint...");
      await deleteWebhook(endpoint.id);
      await onChanged();
      onStatus("Webhook endpoint deleted.");
    } catch (error) {
      onStatus((error as Error).message);
    } finally {
      setBusy("");
    }
  };

  return (
    <div className="activity-card">
      <div className="activity-card__title">
        <Webhook aria-hidden="true" size={18} />
        <strong>{endpoint.url}</strong>
      </div>
      <span>{endpoint.active ? "Active" : "Paused"} - updated {formatDate(endpoint.updatedAt)}</span>

      <label htmlFor={`webhook-url-${endpoint.id}`}>Endpoint URL</label>
      <input
        id={`webhook-url-${endpoint.id}`}
        value={draft.url}
        onChange={(event) => setDraft((current) => ({ ...current, url: event.target.value }))}
      />

      <label htmlFor={`webhook-description-${endpoint.id}`}>Description</label>
      <input
        id={`webhook-description-${endpoint.id}`}
        value={draft.description}
        onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))}
        placeholder="CRM document status sync"
      />

      <label>Events</label>
      <EventPicker
        availableEvents={availableEvents}
        selectedEvents={draft.events}
        onChange={(events) => setDraft((current) => ({ ...current, events }))}
      />

      <label className="toggle-line">
        <input
          type="checkbox"
          checked={draft.active}
          onChange={(event) => setDraft((current) => ({ ...current, active: event.target.checked }))}
        />
        <span>Deliver events to this endpoint</span>
      </label>

      <div className="management-actions">
        <button className="activity-action-button" type="button" disabled={busy === "save"} onClick={() => void save()}>
          <Save aria-hidden="true" size={16} />
          {busy === "save" ? "Saving..." : "Save"}
        </button>
        <button className="activity-action-button" type="button" disabled={busy === "rotate"} onClick={() => void rotate()}>
          <RefreshCcw aria-hidden="true" size={16} />
          {busy === "rotate" ? "Rotating..." : "Rotate secret"}
        </button>
        <button className="activity-action-button activity-action-button--danger" type="button" disabled={busy === "delete"} onClick={() => void remove()}>
          <Trash2 aria-hidden="true" size={16} />
          {busy === "delete" ? "Deleting..." : "Delete"}
        </button>
      </div>
    </div>
  );
}

export default function AutomationPage(): React.JSX.Element {
  const { user, loading } = useAuth();
  const [events, setEvents] = useState<string[]>([]);
  const [webhooks, setWebhooks] = useState<WebhookEndpointItem[]>([]);
  const [url, setUrl] = useState("");
  const [description, setDescription] = useState("");
  const [selectedEvents, setSelectedEvents] = useState<string[]>(["*"]);
  const [newSecret, setNewSecret] = useState("");
  const [status, setStatus] = useState("Loading automation tools...");
  const [creating, setCreating] = useState(false);

  const activeCount = useMemo(() => webhooks.filter((endpoint) => endpoint.active).length, [webhooks]);

  const loadAutomation = async (): Promise<void> => {
    const [eventResult, webhookResult] = await Promise.all([listWebhookEvents(), listWebhooks()]);
    setEvents(eventResult.events);
    setWebhooks(webhookResult);
    setStatus("");
  };

  useEffect(() => {
    if (loading) {
      return;
    }

    if (!user) {
      setEvents([]);
      setWebhooks([]);
      setStatus("Sign in to create webhook endpoints.");
      return;
    }

    void loadAutomation().catch((error) => setStatus((error as Error).message));
  }, [user, loading]);

  const onCreate = async (): Promise<void> => {
    if (!url.trim()) {
      setStatus("Enter a webhook URL first.");
      return;
    }

    try {
      setCreating(true);
      setStatus("Creating webhook endpoint...");
      const endpoint = await createWebhook({
        url: url.trim(),
        description: description.trim(),
        events: normalizedEvents(selectedEvents)
      });
      setNewSecret(endpoint.signingSecret);
      setUrl("");
      setDescription("");
      setSelectedEvents(["*"]);
      await loadAutomation();
      setStatus("Webhook endpoint created. Copy the signing secret now.");
    } catch (error) {
      setStatus((error as Error).message);
    } finally {
      setCreating(false);
    }
  };

  const copySecret = async (): Promise<void> => {
    await navigator.clipboard.writeText(newSecret);
    setStatus("Webhook signing secret copied.");
  };

  return (
    <div className="site-shell">
      <SiteHeader />
      <main className="account-page">
        <section className="account-hero">
          <span className="auth-eyebrow">Automation</span>
          <h1>Webhook endpoints</h1>
          <p>Send task and signing events to internal systems, approval tools, CRMs, and document workflows.</p>
          <div className="account-hero-actions">
            {!loading && !user ? <Link className="auth-submit account-login-link" href="/login">Log in</Link> : null}
            <Link className="auth-submit account-login-link" href="/developer">Manage API keys</Link>
          </div>
        </section>

        {status ? <p className="auth-status">{status}</p> : null}

        {newSecret ? (
          <section className="developer-secret-panel">
            <div>
              <strong>Webhook signing secret</strong>
              <span>Use this secret to verify the X-IHatePDF-Signature header.</span>
            </div>
            <code>{newSecret}</code>
            <button className="activity-action-button" type="button" onClick={() => void copySecret()}>
              <Copy aria-hidden="true" size={16} />
              Copy secret
            </button>
          </section>
        ) : null}

        {user ? (
          <section className="account-grid account-grid--tools">
            <article className="account-panel">
              <div className="account-panel-heading">
                <span><Webhook aria-hidden="true" size={18} /> Create webhook</span>
                <strong>{activeCount}</strong>
              </div>
              <label htmlFor="new-webhook-url">Endpoint URL</label>
              <input
                id="new-webhook-url"
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                placeholder="https://example.com/ihatepdf/webhooks"
              />

              <label htmlFor="new-webhook-description">Description</label>
              <input
                id="new-webhook-description"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="Contract automation receiver"
              />

              <label>Events</label>
              <EventPicker availableEvents={events} selectedEvents={selectedEvents} onChange={setSelectedEvents} />

              <button className="start-process-btn" type="button" disabled={creating} onClick={() => void onCreate()}>
                {creating ? "Creating..." : "Create webhook"}
              </button>
            </article>

            <article className="account-panel">
              <div className="account-panel-heading">
                <span><RefreshCcw aria-hidden="true" size={18} /> Delivery contract</span>
                <strong>HMAC</strong>
              </div>
              <p>Each delivery includes event, timestamp, delivery id, and an HMAC-SHA256 signature.</p>
              <pre className="developer-code"><code>{`X-IHatePDF-Event: task.completed
X-IHatePDF-Timestamp: 1778841600
X-IHatePDF-Signature: v1=...`}</code></pre>
            </article>

            <article className="account-panel account-panel--wide">
              <div className="account-panel-heading">
                <span><Webhook aria-hidden="true" size={18} /> Webhook endpoints</span>
                <strong>{webhooks.length}</strong>
              </div>
              {webhooks.length === 0 ? (
                <div className="account-empty-state">
                  <Webhook aria-hidden="true" size={24} />
                  <strong>No webhook endpoints yet</strong>
                  <span>Create an endpoint to receive task completion, task failure, and signing workflow events.</span>
                </div>
              ) : null}
              {webhooks.map((endpoint) => (
                <WebhookCard
                  key={endpoint.id}
                  endpoint={endpoint}
                  availableEvents={events}
                  onChanged={loadAutomation}
                  onSecret={setNewSecret}
                  onStatus={setStatus}
                />
              ))}
            </article>
          </section>
        ) : null}
      </main>
    </div>
  );
}
