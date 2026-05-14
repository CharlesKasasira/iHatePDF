"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import {
  completeSignatureRequest,
  getSignaturePdfMetadata,
  getSignaturePdfPagePreviewUrl,
  getSignatureRequest,
  pollTask,
  type PdfFileMetadataResponse,
  type SignatureRequestResponse
} from "../../lib/pdf-api";
import styles from "../../components/signature-workflow-studio.module.css";

type FieldDraftValue = {
  textValue?: string;
  checked?: boolean;
  signatureDataUrl?: string;
};

function todayInputValue(): string {
  return new Date().toISOString().slice(0, 10);
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Failed to read file."));
    reader.onload = () => resolve(String(reader.result));
    reader.readAsDataURL(file);
  });
}

export default function SignRequestPage(): React.JSX.Element {
  const params = useParams<{ token: string }>();
  const token = params.token;
  const [request, setRequest] = useState<SignatureRequestResponse | null>(null);
  const [pdfMeta, setPdfMeta] = useState<PdfFileMetadataResponse | null>(null);
  const [fieldValues, setFieldValues] = useState<Record<string, FieldDraftValue>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [downloadUrl, setDownloadUrl] = useState("");
  const [selectedFieldId, setSelectedFieldId] = useState<string | null>(null);

  useEffect(() => {
    if (!token) {
      return;
    }

    const load = async (): Promise<void> => {
      try {
        setLoading(true);
        setError("");
        setStatus("");
        const nextRequest = await getSignatureRequest(token);
        setRequest(nextRequest);
        const metadata = await getSignaturePdfMetadata(token);
        setPdfMeta(metadata);

        const initialValues: Record<string, FieldDraftValue> = {};
        nextRequest.fields
          .filter((field) => field.recipientId === nextRequest.recipient.id)
          .forEach((field) => {
            if (field.type === "checkbox") {
              initialValues[field.id] = { checked: Boolean(field.value?.checked) };
              return;
            }
            if (field.type === "signature") {
              initialValues[field.id] = {
                signatureDataUrl:
                  typeof field.value?.signatureDataUrl === "string"
                    ? String(field.value.signatureDataUrl)
                    : ""
              };
              return;
            }

            const fallbackText =
              field.type === "date"
                ? todayInputValue()
                : field.type === "name"
                  ? nextRequest.recipient.name || ""
                  : "";

            initialValues[field.id] = {
              textValue:
                typeof field.value?.text === "string"
                  ? String(field.value.text)
                  : fallbackText
            };
          });

        setFieldValues(initialValues);
        setSelectedFieldId(
          nextRequest.fields.find((field) => field.recipientId === nextRequest.recipient.id)?.id ?? null
        );
      } catch (loadError) {
        setError((loadError as Error).message);
      } finally {
        setLoading(false);
      }
    };

    void load();
  }, [token]);

  const assignedFields = useMemo(
    () =>
      request
        ? request.fields.filter((field) => field.recipientId === request.recipient.id)
        : [],
    [request]
  );

  const submitFields = async (): Promise<void> => {
    if (!token || !request) {
      return;
    }

    try {
      setBusy(true);
      setStatus("Submitting your fields...");
      setDownloadUrl("");
      const payload = assignedFields.map((field) => ({
        fieldId: field.id,
        textValue: fieldValues[field.id]?.textValue,
        checked: fieldValues[field.id]?.checked,
        signatureDataUrl: fieldValues[field.id]?.signatureDataUrl
      }));
      const result = await completeSignatureRequest(token, payload);

      if (result.taskId) {
        setStatus("Final signer complete. Rendering the signed document...");
        const task = await pollTask(result.taskId);
        if (task.status === "completed" && task.outputDownloadUrl) {
          setDownloadUrl(task.outputDownloadUrl);
          setStatus("All fields are complete. The final signed PDF is ready.");
        } else {
          setStatus(`Final rendering failed: ${task.errorMessage ?? "unknown error"}`);
        }
      } else {
        setStatus("Your fields were submitted. The workflow is moving to the next signer.");
      }

      setRequest(await getSignatureRequest(token));
    } catch (submitError) {
      setStatus(`Submission failed: ${(submitError as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className={styles.shell}>
      <section className={styles.hero}>
        <div>
          <span className={styles.eyebrow}>Signer Session</span>
          <h1>{request?.title || request?.fileName || "Open signing request"}</h1>
          <p>
            Complete only the fields assigned to you. Routing, reminders, expiration, and final output
            locking are managed by the sender workflow.
          </p>
        </div>
        {request ? <span className={styles.statusPill}>{request.status.replace("_", " ")}</span> : null}
      </section>

      {loading ? <p className={styles.note}>Loading signing session...</p> : null}
      {error ? <p className={styles.note}>{error}</p> : null}

      {request ? (
        <section className={styles.builderGrid}>
          <aside className={styles.sidebar}>
            <article className={styles.panel}>
              <div className={styles.panelHeader}>
                <span className={styles.eyebrow}>Your turn</span>
                <strong>{request.recipient.name || request.recipient.email}</strong>
              </div>
              <p className={styles.panelCopy}>
                {request.recipient.role || "Signer"} · order {request.recipient.routingOrder}
              </p>
              <p className={styles.panelCopy}>Expires {new Date(request.expiresAt).toLocaleString()}</p>
              {request.message ? <p className={styles.panelCopy}>{request.message}</p> : null}
              {!request.canSubmit ? (
                <p className={styles.note}>
                  {request.status === "completed"
                    ? "This workflow is complete."
                    : request.status === "expired"
                      ? "This workflow has expired."
                      : "Your turn is not active yet, or the workflow is already locked."}
                </p>
              ) : null}
            </article>

            <article className={styles.panel}>
              <div className={styles.panelHeader}>
                <span className={styles.eyebrow}>Assigned fields</span>
                <strong>{assignedFields.length}</strong>
              </div>
              <div className={styles.fieldEditor}>
                {assignedFields.map((field) => (
                  <div key={field.id} className={styles.recipientCard}>
                    <button type="button" className={styles.recipientSelect} onClick={() => setSelectedFieldId(field.id)}>
                      <strong>{field.label || field.type}</strong>
                      <span>Page {field.page}</span>
                    </button>

                    {field.type === "signature" ? (
                      <div className={styles.fieldEditor}>
                        <input
                          type="file"
                          accept="image/png,image/jpeg"
                          onChange={async (event) => {
                            const file = event.target.files?.[0];
                            if (!file) {
                              return;
                            }
                            const signatureDataUrl = await fileToDataUrl(file);
                            setFieldValues((current) => ({
                              ...current,
                              [field.id]: {
                                ...current[field.id],
                                signatureDataUrl
                              }
                            }));
                          }}
                        />
                        {fieldValues[field.id]?.signatureDataUrl ? (
                          <img
                            src={fieldValues[field.id]?.signatureDataUrl}
                            alt="Signature preview"
                            style={{ maxWidth: "100%", borderRadius: 12 }}
                          />
                        ) : null}
                      </div>
                    ) : null}

                    {field.type === "checkbox" ? (
                      <label>
                        <span>Checked</span>
                        <input
                          type="checkbox"
                          checked={Boolean(fieldValues[field.id]?.checked)}
                          onChange={(event) =>
                            setFieldValues((current) => ({
                              ...current,
                              [field.id]: {
                                ...current[field.id],
                                checked: event.target.checked
                              }
                            }))
                          }
                        />
                      </label>
                    ) : null}

                    {field.type !== "signature" && field.type !== "checkbox" ? (
                      <label>
                        <span>{field.placeholder || "Value"}</span>
                        <input
                          type={field.type === "date" ? "date" : "text"}
                          value={fieldValues[field.id]?.textValue ?? ""}
                          onChange={(event) =>
                            setFieldValues((current) => ({
                              ...current,
                              [field.id]: {
                                ...current[field.id],
                                textValue: event.target.value
                              }
                            }))
                          }
                        />
                      </label>
                    ) : null}
                  </div>
                ))}
              </div>
            </article>

            <article className={styles.panel}>
              <button
                className={styles.primaryButton}
                type="button"
                disabled={busy || !request.canSubmit}
                onClick={() => void submitFields()}
              >
                {busy ? "Submitting..." : "Submit assigned fields"}
              </button>
              <p className={styles.note}>{status}</p>
              {downloadUrl ? (
                <a className={styles.primaryButton} href={downloadUrl} target="_blank" rel="noreferrer">
                  Download final signed PDF
                </a>
              ) : null}
            </article>
          </aside>

          <section className={styles.canvasStack}>
            {pdfMeta?.pages.map((page) => (
              <article key={page.pageNumber} className={styles.pageCard}>
                <div className={styles.pageMeta}>
                  <span>Page {page.pageNumber}</span>
                  <span>Field map</span>
                </div>
                <div className={styles.pageSurface} style={{ aspectRatio: `${page.width} / ${page.height}` }}>
                  <img
                    className={styles.pagePreview}
                    src={getSignaturePdfPagePreviewUrl(token, page.pageNumber)}
                    alt={`${request.fileName} page ${page.pageNumber}`}
                    draggable={false}
                  />
                  {request.fields
                    .filter((field) => field.page === page.pageNumber)
                    .map((field) => (
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
                        onClick={() => setSelectedFieldId(field.id)}
                      >
                        <strong>{field.label || field.type}</strong>
                        <span>
                          {field.recipientId === request.recipient.id
                            ? "Assigned to you"
                            : field.recipientName || "Other signer"}
                        </span>
                      </button>
                    ))}
                </div>
              </article>
            ))}
          </section>
        </section>
      ) : null}
    </main>
  );
}
