"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  CalendarDays,
  CheckSquare,
  LoaderCircle,
  PenLine,
  Type,
  UserRound,
  type LucideIcon
} from "lucide-react";
import {
  createSignatureRequest,
  createSignatureTemplate,
  createSignatureTemplateFromEnvelope,
  getPdfMetadata,
  getPdfPagePreviewUrl,
  getSignatureEnvelope,
  listSignatureTemplates,
  remindSignatureRecipient,
  reassignSignatureRecipient,
  revokeSignatureEnvelope,
  retrySignatureEnvelopeFinalization,
  type PdfFileMetadataResponse,
  type SignatureEnvelopeResponse,
  type SignatureEnvelopeTemplate,
  uploadPdfWithRetention
} from "../lib/pdf-api";
import { useAuth } from "./auth-provider";
import { ReorderableList, ReorderHandle } from "./reorderable-list";
import { SiteHeader } from "./site-header";
import { UploadDropzone } from "./upload-dropzone";
import styles from "./signature-workflow-studio.module.css";

type SignFieldType = "signature" | "initials" | "name" | "date" | "checkbox" | "text";
type SigningRouting = "sequential" | "parallel";

type DraftRecipient = {
  key: string;
  name: string;
  email: string;
  role: string;
  passcode: string;
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
  icon: LucideIcon;
}> = [
  { type: "signature", label: "Signature", width: 168, height: 56, icon: PenLine },
  { type: "initials", label: "Initials", width: 92, height: 34, icon: PenLine },
  { type: "name", label: "Full name", width: 172, height: 34, icon: UserRound },
  { type: "date", label: "Sign date", width: 132, height: 34, icon: CalendarDays },
  { type: "checkbox", label: "Checkbox", width: 28, height: 28, icon: CheckSquare },
  { type: "text", label: "Text field", width: 220, height: 40, icon: Type }
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
      role: "Signer",
      passcode: ""
    }
  ]);
  const [selectedRecipientKey, setSelectedRecipientKey] = useState<string>("");
  const [activeFieldType, setActiveFieldType] = useState<SignFieldType>("signature");
  const [fields, setFields] = useState<DraftField[]>([]);
  const [selectedFieldId, setSelectedFieldId] = useState<string | null>(null);

  const [workflowStatus, setWorkflowStatus] = useState("Upload a PDF and place the first signer field.");
  const [busy, setBusy] = useState(false);
  const [templates, setTemplates] = useState<SignatureEnvelopeTemplate[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState("");

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
    if (!user) {
      setTemplates([]);
      return;
    }

    listSignatureTemplates()
      .then(setTemplates)
      .catch(() => setTemplates([]));
  }, [user]);

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

  const onPdfSelect = async (file: File | null): Promise<void> => {
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
      role: "Signer",
      passcode: ""
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
          routingOrder: index + 1,
          passcode: recipient.passcode.trim() || undefined
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

  const saveCurrentTemplate = async (): Promise<void> => {
    if (!user) {
      setWorkflowStatus("Sign in to save envelope templates.");
      return;
    }
    if (recipients.some((recipient) => !recipient.email.trim())) {
      setWorkflowStatus("Add signer emails before saving a reusable template.");
      return;
    }
    if (fields.length === 0) {
      setWorkflowStatus("Add fields before saving a reusable template.");
      return;
    }

    const name = window.prompt("Template name", title.trim() || "Signing workflow");
    if (!name) {
      return;
    }

    try {
      setBusy(true);
      const template = await createSignatureTemplate({
        name,
        title: title.trim() || undefined,
        requesterEmail: requesterEmail.trim() || undefined,
        message: message.trim() || undefined,
        outputName: outputName.trim(),
        routing,
        recipients: recipients.map((recipient, index) => ({
          key: recipient.key,
          name: recipient.name.trim() || undefined,
          email: recipient.email.trim() || undefined,
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
      setTemplates((current) => [template, ...current]);
      setWorkflowStatus(`Template "${template.name}" saved.`);
    } catch (error) {
      setWorkflowStatus(`Template save failed: ${(error as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const applyTemplate = (templateId: string): void => {
    const template = templates.find((item) => item.id === templateId);
    setSelectedTemplateId(templateId);
    if (!template) {
      return;
    }

    const nextRecipients = template.recipients.map((recipient) => ({
      key: recipient.key,
      name: recipient.name ?? "",
      email: recipient.email ?? "",
      role: recipient.role ?? "Signer",
      passcode: ""
    }));
    setTitle(template.title ?? "");
    setRequesterEmail(template.requesterEmail ?? user?.email ?? "");
    setMessage(template.message ?? "");
    setOutputName(template.outputName);
    setRouting(template.routing);
    setRecipients(nextRecipients);
    setSelectedRecipientKey(nextRecipients[0]?.key ?? "");
    setFields(
      template.fields.map((field) => ({
        id: nextId("field"),
        recipientKey: field.recipientKey,
        type: field.type,
        label: field.label ?? "",
        placeholder: field.placeholder ?? "",
        required: field.required,
        page: field.page,
        x: field.x,
        y: field.y,
        width: field.width,
        height: field.height
      }))
    );
    setWorkflowStatus(`Template "${template.name}" applied. Upload or verify the PDF page layout before sending.`);
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
              {envelope.auditCertificateUrl ? (
                <a className={styles.secondaryButton} href={envelope.auditCertificateUrl} target="_blank" rel="noreferrer">
                  Download audit certificate
                </a>
              ) : null}
              {user ? (
                <button
                  className={styles.secondaryButton}
                  type="button"
                  onClick={async () => {
                    const name = window.prompt("Template name", envelope.title || envelope.fileName);
                    if (!name) {
                      return;
                    }
                    try {
                      setManageStatus("Saving template...");
                      const template = await createSignatureTemplateFromEnvelope(envelope.id, name);
                      setTemplates((current) => [template, ...current]);
                      setManageStatus(`Template "${template.name}" saved.`);
                    } catch (error) {
                      setManageStatus((error as Error).message);
                    }
                  }}
                >
                  Save as template
                </button>
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
                      {event.ipAddress ? ` · ${event.ipAddress}` : ""}
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
            <p>
              Define recipients, route them in sequence or parallel, place every field on the document,
              and send a signing packet that can be reminded, reassigned, revoked, and finalized into an
              immutable signed PDF.
            </p>
          </div>
          <div className={styles.heroActions}>
            <UploadDropzone
              label={uploading ? "Preparing PDF..." : pdfFile ? "Replace PDF" : "Upload PDF"}
              hint={uploading && pdfFile ? `Uploading ${pdfFile.name}` : pdfFile ? pdfFile.name : "Drop a PDF here to start"}
              accept="application/pdf"
              compact
              disabled={uploading || busy}
              onFiles={(files) => void onPdfSelect(files?.[0] ?? null)}
            />
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
              {templates.length > 0 ? (
                <label>
                  Template
                  <select value={selectedTemplateId} onChange={(event) => applyTemplate(event.target.value)}>
                    <option value="">Choose a saved template</option>
                    {templates.map((template) => (
                      <option key={template.id} value={template.id}>
                        {template.name}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
            </article>

            <article className={styles.panel}>
              <div className={styles.panelHeader}>
                <span className={styles.eyebrow}>Signers</span>
                <button type="button" className={styles.secondaryButton} onClick={addRecipient}>
                  Add signer
                </button>
              </div>
              <ReorderableList
                items={recipients}
                onReorder={(nextRecipients) => {
                  setRecipients(nextRecipients);
                  setWorkflowStatus("Signer routing order updated.");
                }}
                className={styles.recipientList}
                disabled={busy || uploading}
                keyForItem={(recipient) => recipient.key}
                renderItem={(recipient, index) => (
                  <div className={`${styles.recipientCard} ${selectedRecipientKey === recipient.key ? styles.recipientCardActive : ""}`}>
                    <ReorderHandle label="Drag signer to reorder routing" />
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
                      <input
                        value={recipient.passcode}
                        onChange={(event) =>
                          setRecipients((current) =>
                            current.map((item) => item.key === recipient.key ? { ...item, passcode: event.target.value } : item)
                          )
                        }
                        placeholder="Optional passcode"
                        type="password"
                      />
                      <div className={styles.compactActions}>
                        <button type="button" onClick={() => moveRecipient(recipient.key, -1)}>Up</button>
                        <button type="button" onClick={() => moveRecipient(recipient.key, 1)}>Down</button>
                        <button type="button" onClick={() => removeRecipient(recipient.key)}>Remove</button>
                      </div>
                    </div>
                  </div>
                )}
              />
            </article>
          </aside>

          <section className={styles.canvasStack}>
            {!pdfMeta ? (
              <div className={`${styles.emptyState} ${uploading ? styles.loadingState : ""}`} role={uploading ? "status" : undefined} aria-live="polite">
                {uploading ? (
                  <>
                    <LoaderCircle className={styles.loadingIcon} aria-hidden="true" />
                    <strong>Preparing PDF for field mapping...</strong>
                    <span>Uploading the file and reading page layout. Large PDFs can take a moment.</span>
                  </>
                ) : (
                  <>
                    <strong>Upload a PDF to map the workflow.</strong>
                    <span>Each page becomes a signing surface where you can assign fields to specific recipients.</span>
                  </>
                )}
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
                  onMoveField={(fieldId, x, y) => {
                    setFields((current) =>
                      current.map((field) =>
                        field.id === fieldId
                          ? {
                              ...field,
                              x: clamp(x, 0, Math.max(0, page.width - field.width)),
                              y: clamp(y, 0, Math.max(0, page.height - field.height))
                            }
                          : field
                      )
                    );
                  }}
                  onPlaceField={(x, y) => placeField(page.pageNumber, page.width, page.height, x, y)}
                />
              ))
            )}
          </section>

          <aside className={`${styles.sidebar} ${styles.rightSidebar}`}>
            <article className={styles.panel}>
              <div className={styles.panelHeader}>
                <span className={styles.eyebrow}>Field palette</span>
                <strong>{selectedRecipient?.name || selectedRecipient?.email || "Select signer"}</strong>
              </div>
              <div className={styles.fieldLibrary}>
                {FIELD_LIBRARY.map((item) => {
                  const Icon = item.icon;
                  return (
                  <button
                    key={`${item.type}-${item.label}`}
                    type="button"
                    className={`${styles.fieldChip} ${activeFieldType === item.type ? styles.fieldChipActive : ""}`}
                    onClick={() => setActiveFieldType(item.type)}
                  >
                    <span className={styles.gripDots} aria-hidden="true" />
                    <span>{item.label}</span>
                    <span className={styles.fieldChipIcon}>
                      <Icon aria-hidden="true" />
                    </span>
                  </button>
                  );
                })}
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
              <button className={styles.secondaryButton} type="button" onClick={() => void saveCurrentTemplate()} disabled={busy || fields.length === 0}>
                Save as template
              </button>
              <button className={styles.primaryButton} type="button" onClick={() => void createWorkflow()} disabled={busy || uploading}>
                {busy ? "Creating workflow..." : "Send signing workflow"}
              </button>
              <p className={styles.note}>{workflowStatus}</p>
            </article>
          </aside>
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
  onMoveField,
  onPlaceField
}: {
  fileId: string | null;
  fileName: string;
  page: PdfFileMetadataResponse["pages"][number];
  fields: DraftField[];
  selectedFieldId: string | null;
  recipients: DraftRecipient[];
  onSelectField: (id: string) => void;
  onMoveField: (id: string, x: number, y: number) => void;
  onPlaceField: (x: number, y: number) => void;
}): React.JSX.Element {
  const pageRef = useRef<HTMLDivElement>(null);
  const [previewLoaded, setPreviewLoaded] = useState(false);

  useEffect(() => {
    setPreviewLoaded(false);
  }, [fileId, page.pageNumber]);

  const startMoveField = (event: React.PointerEvent<HTMLButtonElement>, field: DraftField): void => {
    event.preventDefault();
    event.stopPropagation();
    onSelectField(field.id);
    const surface = pageRef.current;
    if (!surface) {
      return;
    }

    const startRect = surface.getBoundingClientRect();
    const startX = event.clientX;
    const startY = event.clientY;
    const originalX = field.x;
    const originalY = field.y;

    const handleMove = (moveEvent: PointerEvent): void => {
      const deltaX = ((moveEvent.clientX - startX) / startRect.width) * page.width;
      const deltaY = ((moveEvent.clientY - startY) / startRect.height) * page.height;
      onMoveField(field.id, originalX + deltaX, originalY - deltaY);
    };

    const stopMove = (): void => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", stopMove);
      window.removeEventListener("pointercancel", stopMove);
    };

    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", stopMove);
    window.addEventListener("pointercancel", stopMove);
  };

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
            onLoad={() => setPreviewLoaded(true)}
            onError={() => setPreviewLoaded(true)}
          />
        ) : null}
        {fileId && !previewLoaded ? (
          <div className={styles.pagePreviewLoading} role="status" aria-live="polite">
            <LoaderCircle className={styles.loadingIcon} aria-hidden="true" />
            <span>Loading page preview...</span>
          </div>
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
              onPointerDown={(event) => startMoveField(event, field)}
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
