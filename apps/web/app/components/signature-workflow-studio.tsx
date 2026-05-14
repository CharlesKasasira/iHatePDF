"use client";

import { type ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  createSignatureRequest,
  getPdfMetadata,
  getPdfPagePreviewUrl,
  getSignatureEnvelope,
  remindSignatureRecipient,
  reassignSignatureRecipient,
  revokeSignatureEnvelope,
  retrySignatureEnvelopeFinalization,
  type PdfFileMetadataResponse,
  type SignatureEnvelopeResponse,
  uploadPdfWithRetention
} from "../lib/pdf-api";
import { useAuth } from "./auth-provider";
import { SiteHeader } from "./site-header";
import styles from "./signature-workflow-studio.module.css";

type SignFieldType = "signature" | "initials" | "name" | "date" | "checkbox" | "text";
type SigningRouting = "sequential" | "parallel";

type DraftRecipient = {
  key: string;
  name: string;
  email: string;
  role: string;
};

type DraftField = {
  id: string;
  recipientKey: string;
  type: SignFieldType;
  label: string;
  placeholder: string;
  required: boolean;
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
};

const RETENTION_HOURS = 168;

const FIELD_LIBRARY: Array<{
  type: SignFieldType;
  label: string;
  width: number;
  height: number;
}> = [
  { type: "signature", label: "Signature", width: 168, height: 56 },
  { type: "initials", label: "Initials", width: 92, height: 34 },
  { type: "name", label: "Name", width: 172, height: 34 },
  { type: "date", label: "Date", width: 132, height: 34 },
  { type: "checkbox", label: "Checkbox", width: 28, height: 28 },
  { type: "text", label: "Text field", width: 220, height: 40 }
];

function nextId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

function buildSignedName(fileName: string): string {
  const stripped = fileName.toLowerCase().endsWith(".pdf") ? fileName.slice(0, -4) : fileName;
  return `${stripped || "document"}-signed.pdf`;
}

function tomorrowIsoDate(): string {
  const date = new Date();
  date.setDate(date.getDate() + 3);
  return date.toISOString().slice(0, 10);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function SignatureWorkflowStudio({
  initialEnvelopeId = null
}: {
  initialEnvelopeId?: string | null;
}): React.JSX.Element {
  const { user } = useAuth();
  const pdfInputRef = useRef<HTMLInputElement>(null);

  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [fileId, setFileId] = useState<string | null>(null);
  const [pdfMeta, setPdfMeta] = useState<PdfFileMetadataResponse | null>(null);
  const [pages, setPages] = useState<PdfFileMetadataResponse["pages"]>([]);
  const [uploading, setUploading] = useState(false);

  const [title, setTitle] = useState("");
  const [requesterEmail, setRequesterEmail] = useState("");
  const [message, setMessage] = useState("Please review and complete your assigned fields.");
  const [outputName, setOutputName] = useState("signed-document.pdf");
  const [routing, setRouting] = useState<SigningRouting>("sequential");
  const [expiresAt, setExpiresAt] = useState(tomorrowIsoDate());

  const [recipients, setRecipients] = useState<DraftRecipient[]>([
    {
      key: nextId("signer"),
      name: "Primary signer",
      email: "",
      role: "Signer"
    }
  ]);
  const [selectedRecipientKey, setSelectedRecipientKey] = useState<string>("");
  const [activeFieldType, setActiveFieldType] = useState<SignFieldType>("signature");
  const [fields, setFields] = useState<DraftField[]>([]);
  const [selectedFieldId, setSelectedFieldId] = useState<string | null>(null);

  const [workflowStatus, setWorkflowStatus] = useState("Upload a PDF and place the first signer field.");
  const [busy, setBusy] = useState(false);

  const [envelopeId, setEnvelopeId] = useState<string | null>(initialEnvelopeId);
  const [envelope, setEnvelope] = useState<SignatureEnvelopeResponse | null>(null);
  const [manageStatus, setManageStatus] = useState("");

  const selectedField = useMemo(
    () => fields.find((field) => field.id === selectedFieldId) ?? null,
    [fields, selectedFieldId]
  );

  const selectedRecipient = useMemo(
    () =>
      recipients.find((recipient) => recipient.key === selectedRecipientKey) ??
      recipients[0] ??
      null,
    [recipients, selectedRecipientKey]
  );

  useEffect(() => {
    if (!selectedRecipientKey && recipients[0]) {
      setSelectedRecipientKey(recipients[0].key);
    }
  }, [recipients, selectedRecipientKey]);

  useEffect(() => {
    if (user?.email && !requesterEmail.trim()) {
      setRequesterEmail(user.email);
    }
  }, [user?.email, requesterEmail]);

  useEffect(() => {
    if (!envelopeId) {
      return;
    }

    void loadEnvelope(envelopeId);
  }, [envelopeId]);

  const loadEnvelope = async (id: string): Promise<void> => {
    try {
      setManageStatus("Loading workflow status...");
      const nextEnvelope = await getSignatureEnvelope(id);
      setEnvelope(nextEnvelope);
      setManageStatus("");
    } catch (error) {
      setManageStatus((error as Error).message);
    }
  };

  const onPdfSelect = async (event: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = event.target.files?.[0] ?? null;
    setPdfFile(file);
    setFileId(null);
    setPdfMeta(null);
    setPages([]);
    setFields([]);
    setSelectedFieldId(null);
    setEnvelope(null);
    setEnvelopeId(null);
    setManageStatus("");
    setWorkflowStatus(file ? `Uploading ${file.name} for signing setup...` : "Upload a PDF to begin.");
    if (file) {
      setOutputName(buildSignedName(file.name));
    }
    event.target.value = "";

    if (!file) {
      return;
    }

    try {
      setUploading(true);
      const uploaded = await uploadPdfWithRetention(file, RETENTION_HOURS);
      const metadata = await getPdfMetadata(uploaded.fileId);
      setFileId(uploaded.fileId);
      setPdfMeta(metadata);
      setPages(metadata.pages);
      setWorkflowStatus(
        `${metadata.fileName} loaded. Assign recipients, choose a field type, then click a page to place it.`
      );
    } catch (error) {
      setWorkflowStatus(`PDF setup failed: ${(error as Error).message}`);
    } finally {
      setUploading(false);
    }
  };

  const addRecipient = (): void => {
    const nextRecipient: DraftRecipient = {
      key: nextId("signer"),
      name: `Signer ${recipients.length + 1}`,
      email: "",
      role: "Signer"
    };
    setRecipients((current) => [...current, nextRecipient]);
    setSelectedRecipientKey(nextRecipient.key);
  };

  const removeRecipient = (key: string): void => {
    if (recipients.length === 1) {
      return;
    }

    setRecipients((current) => current.filter((recipient) => recipient.key !== key));
    setFields((current) => current.filter((field) => field.recipientKey !== key));
    if (selectedRecipientKey === key) {
      const fallback = recipients.find((recipient) => recipient.key !== key);
      setSelectedRecipientKey(fallback?.key ?? "");
    }
  };

  const moveRecipient = (key: string, direction: -1 | 1): void => {
    setRecipients((current) => {
      const index = current.findIndex((item) => item.key === key);
      const nextIndex = index + direction;
      if (index < 0 || nextIndex < 0 || nextIndex >= current.length) {
        return current;
      }
      const copy = [...current];
      const [item] = copy.splice(index, 1);
      copy.splice(nextIndex, 0, item);
      return copy;
    });
  };

  const placeField = (pageNumber: number, pageWidth: number, pageHeight: number, x: number, y: number): void => {
    if (!selectedRecipient) {
      setWorkflowStatus("Add and select a signer first.");
      return;
    }

    const preset = FIELD_LIBRARY.find((item) => item.type === activeFieldType);
    if (!preset) {
      return;
    }

    const width = preset.width;
    const height = preset.height;
    const nextField: DraftField = {
      id: nextId("field"),
      recipientKey: selectedRecipient.key,
      type: activeFieldType,
      label: preset.label,
      placeholder: activeFieldType === "text" ? "Enter value" : "",
      required: true,
      page: pageNumber,
      x: clamp(x, 0, Math.max(0, pageWidth - width)),
      y: clamp(y, 0, Math.max(0, pageHeight - height)),
      width,
      height
    };

    setFields((current) => [...current, nextField]);
    setSelectedFieldId(nextField.id);
    setWorkflowStatus(`${preset.label} field assigned to ${selectedRecipient.name || selectedRecipient.email || "signer"}.`);
  };

  const createWorkflow = async (): Promise<void> => {
    if (!fileId || !pdfMeta) {
      setWorkflowStatus("Upload a PDF first.");
      return;
    }

    if (!requesterEmail.trim()) {
      setWorkflowStatus("Enter the sender email.");
      return;
    }

    if (recipients.some((recipient) => !recipient.email.trim())) {
      setWorkflowStatus("Every signer needs an email address.");
      return;
    }

    if (fields.length === 0) {
      setWorkflowStatus("Add at least one signing field.");
      return;
    }

    try {
      setBusy(true);
      setWorkflowStatus("Creating signing workflow...");
      const result = await createSignatureRequest({
        fileId,
        requesterEmail: requesterEmail.trim(),
        title: title.trim() || undefined,
        message: message.trim() || undefined,
        outputName: outputName.trim(),
        routing,
        expiresAt: new Date(`${expiresAt}T23:59:59`).toISOString(),
        recipients: recipients.map((recipient, index) => ({
          key: recipient.key,
          name: recipient.name.trim() || undefined,
          email: recipient.email.trim(),
          role: recipient.role.trim() || undefined,
          routingOrder: index + 1
        })),
        fields: fields.map((field) => ({
          recipientKey: field.recipientKey,
          type: field.type,
          label: field.label.trim() || undefined,
          placeholder: field.placeholder.trim() || undefined,
          required: field.required,
          page: field.page,
          x: field.x,
          y: field.y,
          width: field.width,
          height: field.height
        }))
      });

      if (!("signerLinks" in result)) {
        throw new Error("The signing workflow API returned an unexpected response shape.");
      }

      setEnvelopeId(result.id);
      setWorkflowStatus(`Workflow created. ${result.signerLinks.length} signer link(s) are ready.`);
      await loadEnvelope(result.id);
    } catch (error) {
      setWorkflowStatus(`Workflow creation failed: ${(error as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const resetStudio = (): void => {
    setEnvelopeId(null);
    setEnvelope(null);
    setManageStatus("");
    setWorkflowStatus("Signing workspace reset. Upload a PDF to start another workflow.");
  };

  if (envelope) {
    return (
      <div className="site-shell">
        <SiteHeader active="sign-pdf" />
        <main className={styles.shell}>
          <section className={styles.hero}>
            <div>
              <span className={styles.eyebrow}>Signing Control Room</span>
              <h1>{envelope.title || envelope.fileName}</h1>
              <p>
                Signing is now a managed workflow: ordered recipients, immutable field layout, reminders,
                reassignment, revocation, and a locked final output once rendering completes.
              </p>
            </div>
            <div className={styles.heroActions}>
              <span className={styles.statusPill}>{envelope.status.replace("_", " ")}</span>
              <button className={styles.secondaryButton} type="button" onClick={resetStudio}>
                New workflow
              </button>
            </div>
          </section>

          <section className={styles.dashboardGrid}>
            <article className={styles.panel}>
              <div className={styles.panelHeader}>
                <span className={styles.eyebrow}>Workflow</span>
                <strong>{envelope.routing === "sequential" ? "Ordered routing" : "Parallel routing"}</strong>
              </div>
              <p className={styles.panelCopy}>
                Expires {new Date(envelope.expiresAt).toLocaleString()}. Output file: {envelope.outputName}.
              </p>
              <p className={styles.panelCopy}>Requester: {envelope.requesterEmail}</p>
              {envelope.finalDownloadUrl ? (
                <a className={styles.primaryButton} href={envelope.finalDownloadUrl} target="_blank" rel="noreferrer">
                  Download final signed PDF
                </a>
              ) : null}
              {envelope.status === "finalization_failed" ? (
                <button
                  className={styles.primaryButton}
                  type="button"
                  onClick={async () => {
                    try {
                      setManageStatus("Retrying final signed PDF rendering...");
                      await retrySignatureEnvelopeFinalization(envelope.id);
                      await loadEnvelope(envelope.id);
                      setManageStatus("Finalization retry queued.");
                    } catch (error) {
                      setManageStatus((error as Error).message);
                    }
                  }}
                >
                  Retry finalization
                </button>
              ) : null}
              <button
                className={styles.dangerButton}
                type="button"
                onClick={async () => {
                  try {
                    setManageStatus("Revoking workflow...");
                    await revokeSignatureEnvelope(envelope.id);
                    await loadEnvelope(envelope.id);
                    setManageStatus("Workflow revoked.");
                  } catch (error) {
                    setManageStatus((error as Error).message);
                  }
                }}
                disabled={
                  busy ||
                  (envelope.status !== "sent" && envelope.status !== "in_progress")
                }
              >
                Revoke workflow
              </button>
              {manageStatus ? <p className={styles.note}>{manageStatus}</p> : null}
            </article>

            <article className={styles.panel}>
              <div className={styles.panelHeader}>
                <span className={styles.eyebrow}>Signers</span>
                <strong>{envelope.recipients.length} recipients</strong>
              </div>
              <div className={styles.recipientList}>
                {envelope.recipients.map((recipient) => (
                  <div key={recipient.id} className={styles.recipientCard}>
                    <div>
                      <strong>{recipient.name || recipient.email}</strong>
                      <p>{recipient.role || "Signer"}</p>
                      <p>
                        Order {recipient.routingOrder} · {recipient.status}
                      </p>
                    </div>
                    <div className={styles.recipientActions}>
                      <a href={recipient.signingUrl} target="_blank" rel="noreferrer">
                        Link
                      </a>
                      <button
                        type="button"
                        onClick={async () => {
                          try {
                            setManageStatus(`Sending reminder to ${recipient.email}...`);
                            await remindSignatureRecipient(envelope.id, recipient.id);
                            await loadEnvelope(envelope.id);
                            setManageStatus(`Reminder sent to ${recipient.email}.`);
                          } catch (error) {
                            setManageStatus((error as Error).message);
                          }
                        }}
                        disabled={recipient.status === "completed" || envelope.status !== "sent" && envelope.status !== "in_progress"}
                      >
                        Remind
                      </button>
                      <button
                        type="button"
                        onClick={async () => {
                          const email = window.prompt("Reassign to email", recipient.email);
                          if (!email) {
                            return;
                          }
                          const name = window.prompt("Signer name", recipient.name ?? "") ?? recipient.name ?? "";
                          const role = window.prompt("Role", recipient.role ?? "Signer") ?? recipient.role ?? "Signer";
                          try {
                            setManageStatus(`Reassigning ${recipient.email}...`);
                            await reassignSignatureRecipient(envelope.id, recipient.id, {
                              email,
                              name,
                              role
                            });
                            await loadEnvelope(envelope.id);
                            setManageStatus(`Recipient reassigned to ${email}.`);
                          } catch (error) {
                            setManageStatus((error as Error).message);
                          }
                        }}
                        disabled={recipient.status === "completed" || envelope.status !== "sent" && envelope.status !== "in_progress"}
                      >
                        Reassign
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </article>

            <article className={styles.panel}>
              <div className={styles.panelHeader}>
                <span className={styles.eyebrow}>Audit trail</span>
                <strong>{envelope.auditTrail.length} events</strong>
              </div>
              <div className={styles.auditList}>
                {envelope.auditTrail.map((event) => (
                  <div key={event.id} className={styles.auditItem}>
                    <strong>{event.description}</strong>
                    <span>
                      {new Date(event.createdAt).toLocaleString()}
                      {event.actorEmail ? ` · ${event.actorEmail}` : ""}
                    </span>
                  </div>
                ))}
              </div>
            </article>
          </section>
        </main>
      </div>
    );
  }

  return (
    <div className="site-shell">
      <SiteHeader active="sign-pdf" />
      <main className={styles.shell}>
        <section className={styles.hero}>
          <div>
            <span className={styles.eyebrow}>Dedicated Signing Workflow</span>
            <h1>Turn PDF signing into an operational workflow</h1>
            <p>
              Define recipients, route them in sequence or parallel, place every field on the document,
              and send a signing packet that can be reminded, reassigned, revoked, and finalized into an
              immutable signed PDF.
            </p>
          </div>
          <div className={styles.heroActions}>
            <button className={styles.primaryButton} type="button" onClick={() => pdfInputRef.current?.click()}>
              {pdfFile ? "Replace PDF" : "Upload PDF"}
            </button>
            <input ref={pdfInputRef} type="file" hidden accept="application/pdf" onChange={(event) => void onPdfSelect(event)} />
          </div>
        </section>

        <section className={styles.builderGrid}>
          <aside className={styles.sidebar}>
            <article className={styles.panel}>
              <div className={styles.panelHeader}>
                <span className={styles.eyebrow}>Document</span>
                <strong>{pdfMeta?.fileName || "No PDF loaded"}</strong>
              </div>
              <p className={styles.panelCopy}>
                {uploading
                  ? "Uploading and reading page geometry..."
                  : pdfMeta
                    ? `${pdfMeta.pageCount} page(s) ready for field placement.`
                    : "Upload the PDF packet you want to send for signature."}
              </p>
              <label>
                Workflow title
                <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Board approval packet" />
              </label>
              <label>
                Sender email
                <input type="email" value={requesterEmail} onChange={(event) => setRequesterEmail(event.target.value)} placeholder="you@example.com" />
              </label>
              <label>
                Final output name
                <input value={outputName} onChange={(event) => setOutputName(event.target.value)} placeholder="signed-document.pdf" />
              </label>
              <label>
                Recipient message
                <textarea value={message} onChange={(event) => setMessage(event.target.value)} />
              </label>
              <div className={styles.inlineGrid}>
                <label>
                  Routing
                  <select value={routing} onChange={(event) => setRouting(event.target.value as SigningRouting)}>
                    <option value="sequential">Sequential</option>
                    <option value="parallel">Parallel</option>
                  </select>
                </label>
                <label>
                  Expires
                  <input type="date" value={expiresAt} onChange={(event) => setExpiresAt(event.target.value)} />
                </label>
              </div>
            </article>

            <article className={styles.panel}>
              <div className={styles.panelHeader}>
                <span className={styles.eyebrow}>Signers</span>
                <button type="button" className={styles.secondaryButton} onClick={addRecipient}>
                  Add signer
                </button>
              </div>
              <div className={styles.recipientList}>
                {recipients.map((recipient, index) => (
                  <div
                    key={recipient.key}
                    className={`${styles.recipientCard} ${selectedRecipientKey === recipient.key ? styles.recipientCardActive : ""}`}
                  >
                    <button type="button" className={styles.recipientSelect} onClick={() => setSelectedRecipientKey(recipient.key)}>
                      <strong>{recipient.name || `Signer ${index + 1}`}</strong>
                      <span>Order {index + 1}</span>
                    </button>
                    <div className={styles.recipientEditor}>
                      <input
                        value={recipient.name}
                        onChange={(event) =>
                          setRecipients((current) =>
                            current.map((item) => item.key === recipient.key ? { ...item, name: event.target.value } : item)
                          )
                        }
                        placeholder="Name"
                      />
                      <input
                        type="email"
                        value={recipient.email}
                        onChange={(event) =>
                          setRecipients((current) =>
                            current.map((item) => item.key === recipient.key ? { ...item, email: event.target.value } : item)
                          )
                        }
                        placeholder="Email"
                      />
                      <input
                        value={recipient.role}
                        onChange={(event) =>
                          setRecipients((current) =>
                            current.map((item) => item.key === recipient.key ? { ...item, role: event.target.value } : item)
                          )
                        }
                        placeholder="Role"
                      />
                      <div className={styles.compactActions}>
                        <button type="button" onClick={() => moveRecipient(recipient.key, -1)}>Up</button>
                        <button type="button" onClick={() => moveRecipient(recipient.key, 1)}>Down</button>
                        <button type="button" onClick={() => removeRecipient(recipient.key)}>Remove</button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </article>

            <article className={styles.panel}>
              <div className={styles.panelHeader}>
                <span className={styles.eyebrow}>Field palette</span>
                <strong>{selectedRecipient?.name || selectedRecipient?.email || "Select signer"}</strong>
              </div>
              <div className={styles.fieldLibrary}>
                {FIELD_LIBRARY.map((item) => (
                  <button
                    key={item.type}
                    type="button"
                    className={`${styles.fieldChip} ${activeFieldType === item.type ? styles.fieldChipActive : ""}`}
                    onClick={() => setActiveFieldType(item.type)}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
              <p className={styles.note}>Choose a field type, then click directly on any page to place it for the selected signer.</p>
            </article>

            <article className={styles.panel}>
              <div className={styles.panelHeader}>
                <span className={styles.eyebrow}>Selected field</span>
                <strong>{selectedField ? selectedField.label : "None selected"}</strong>
              </div>
              {selectedField ? (
                <div className={styles.fieldEditor}>
                  <label>
                    Assigned signer
                    <select
                      value={selectedField.recipientKey}
                      onChange={(event) =>
                        setFields((current) =>
                          current.map((field) =>
                            field.id === selectedField.id ? { ...field, recipientKey: event.target.value } : field
                          )
                        )
                      }
                    >
                      {recipients.map((recipient) => (
                        <option key={recipient.key} value={recipient.key}>
                          {recipient.name || recipient.email || "Unnamed signer"}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Label
                    <input
                      value={selectedField.label}
                      onChange={(event) =>
                        setFields((current) =>
                          current.map((field) => field.id === selectedField.id ? { ...field, label: event.target.value } : field)
                        )
                      }
                    />
                  </label>
                  <label>
                    Placeholder
                    <input
                      value={selectedField.placeholder}
                      onChange={(event) =>
                        setFields((current) =>
                          current.map((field) => field.id === selectedField.id ? { ...field, placeholder: event.target.value } : field)
                        )
                      }
                    />
                  </label>
                  <div className={styles.inlineGrid}>
                    <label>
                      Page
                      <input
                        type="number"
                        min={1}
                        max={Math.max(1, pages.length)}
                        value={selectedField.page}
                        onChange={(event) =>
                          setFields((current) =>
                            current.map((field) =>
                              field.id === selectedField.id ? { ...field, page: Number(event.target.value) || field.page } : field
                            )
                          )
                        }
                      />
                    </label>
                    <label>
                      Required
                      <select
                        value={selectedField.required ? "yes" : "no"}
                        onChange={(event) =>
                          setFields((current) =>
                            current.map((field) =>
                              field.id === selectedField.id ? { ...field, required: event.target.value === "yes" } : field
                            )
                          )
                        }
                      >
                        <option value="yes">Required</option>
                        <option value="no">Optional</option>
                      </select>
                    </label>
                  </div>
                  <div className={styles.inlineGrid}>
                    <label>
                      X
                      <input
                        type="number"
                        min={0}
                        value={Math.round(selectedField.x)}
                        onChange={(event) =>
                          setFields((current) =>
                            current.map((field) =>
                              field.id === selectedField.id ? { ...field, x: Number(event.target.value) || 0 } : field
                            )
                          )
                        }
                      />
                    </label>
                    <label>
                      Y
                      <input
                        type="number"
                        min={0}
                        value={Math.round(selectedField.y)}
                        onChange={(event) =>
                          setFields((current) =>
                            current.map((field) =>
                              field.id === selectedField.id ? { ...field, y: Number(event.target.value) || 0 } : field
                            )
                          )
                        }
                      />
                    </label>
                  </div>
                  <div className={styles.inlineGrid}>
                    <label>
                      Width
                      <input
                        type="number"
                        min={18}
                        value={Math.round(selectedField.width)}
                        onChange={(event) =>
                          setFields((current) =>
                            current.map((field) =>
                              field.id === selectedField.id ? { ...field, width: Number(event.target.value) || field.width } : field
                            )
                          )
                        }
                      />
                    </label>
                    <label>
                      Height
                      <input
                        type="number"
                        min={18}
                        value={Math.round(selectedField.height)}
                        onChange={(event) =>
                          setFields((current) =>
                            current.map((field) =>
                              field.id === selectedField.id ? { ...field, height: Number(event.target.value) || field.height } : field
                            )
                          )
                        }
                      />
                    </label>
                  </div>
                  <button
                    className={styles.dangerButton}
                    type="button"
                    onClick={() => {
                      setFields((current) => current.filter((field) => field.id !== selectedField.id));
                      setSelectedFieldId(null);
                    }}
                  >
                    Remove field
                  </button>
                </div>
              ) : (
                <p className={styles.note}>Click a placed field to refine its assignee, size, or page position.</p>
              )}
            </article>

            <article className={styles.panel}>
              <button className={styles.primaryButton} type="button" onClick={() => void createWorkflow()} disabled={busy || uploading}>
                {busy ? "Creating workflow..." : "Send signing workflow"}
              </button>
              <p className={styles.note}>{workflowStatus}</p>
            </article>
          </aside>

          <section className={styles.canvasStack}>
            {!pdfMeta ? (
              <div className={styles.emptyState}>
                <strong>Upload a PDF to map the workflow.</strong>
                <span>Each page becomes a signing surface where you can assign fields to specific recipients.</span>
              </div>
            ) : (
              pages.map((page) => (
                <SigningCanvasPage
                  key={page.pageNumber}
                  fileId={fileId}
                  fileName={pdfMeta.fileName}
                  page={page}
                  fields={fields.filter((field) => field.page === page.pageNumber)}
                  selectedFieldId={selectedFieldId}
                  recipients={recipients}
                  onSelectField={setSelectedFieldId}
                  onPlaceField={(x, y) => placeField(page.pageNumber, page.width, page.height, x, y)}
                />
              ))
            )}
          </section>
        </section>
      </main>
    </div>
  );
}

function SigningCanvasPage({
  fileId,
  fileName,
  page,
  fields,
  selectedFieldId,
  recipients,
  onSelectField,
  onPlaceField
}: {
  fileId: string | null;
  fileName: string;
  page: PdfFileMetadataResponse["pages"][number];
  fields: DraftField[];
  selectedFieldId: string | null;
  recipients: DraftRecipient[];
  onSelectField: (id: string) => void;
  onPlaceField: (x: number, y: number) => void;
}): React.JSX.Element {
  const pageRef = useRef<HTMLDivElement>(null);

  return (
    <article className={styles.pageCard}>
      <div className={styles.pageMeta}>
        <span>Page {page.pageNumber}</span>
        <span>{Math.round(page.width)} × {Math.round(page.height)}</span>
      </div>
      <div
        ref={pageRef}
        className={styles.pageSurface}
        style={{ aspectRatio: `${page.width} / ${page.height}` }}
        onClick={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          const clickX = ((event.clientX - rect.left) / rect.width) * page.width;
          const clickYTop = ((event.clientY - rect.top) / rect.height) * page.height;
          onPlaceField(clickX, page.height - clickYTop - 24);
        }}
      >
        {fileId ? (
          <img
            className={styles.pagePreview}
            src={getPdfPagePreviewUrl(fileId, page.pageNumber)}
            alt={`${fileName} page ${page.pageNumber}`}
            draggable={false}
          />
        ) : null}
        {fields.map((field) => {
          const recipient = recipients.find((item) => item.key === field.recipientKey);
          return (
            <button
              key={field.id}
              type="button"
              className={`${styles.fieldBox} ${selectedFieldId === field.id ? styles.fieldBoxActive : ""}`}
              style={{
                left: `${(field.x / page.width) * 100}%`,
                top: `${((page.height - (field.y + field.height)) / page.height) * 100}%`,
                width: `${(field.width / page.width) * 100}%`,
                height: `${(field.height / page.height) * 100}%`
              }}
              onClick={(event) => {
                event.stopPropagation();
                onSelectField(field.id);
              }}
            >
              <strong>{field.label || field.type}</strong>
              <span>{recipient?.name || recipient?.email || "Unassigned"}</span>
            </button>
          );
        })}
      </div>
    </article>
  );
}
