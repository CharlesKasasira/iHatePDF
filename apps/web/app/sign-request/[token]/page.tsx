"use client";

import QRCode from "qrcode";
import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import {
  completeSignatureRequest,
  getSignaturePdfMetadata,
  getSignaturePdfPagePreviewUrl,
  getSignatureRequest,
  pollTask,
  requestSignatureOtp,
  verifySignatureOtp,
  verifySignaturePasscode,
  type PdfFileMetadataResponse,
  type SignatureRequestResponse
} from "../../lib/pdf-api";
import { formatEatDateTime, formatEatTime, todayEatInputValue } from "../../lib/time";
import styles from "../../components/signature-workflow-studio.module.css";

type FieldDraftValue = {
  textValue?: string;
  checked?: boolean;
  signatureDataUrl?: string;
};

type SignatureInputMode = "draw" | "upload" | "mobile";

function todayInputValue(): string {
  return todayEatInputValue();
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Failed to read file."));
    reader.onload = () => resolve(String(reader.result));
    reader.readAsDataURL(file);
  });
}

function SignatureFieldInput({
  value,
  signingUrl,
  onChange
}: {
  value?: string;
  signingUrl: string;
  onChange: (signatureDataUrl?: string) => void;
}): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawingRef = useRef(false);
  const drewRef = useRef(false);
  const [mode, setMode] = useState<SignatureInputMode>("draw");
  const [hasDrawing, setHasDrawing] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState("");

  const prepareCanvas = (): void => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }

    const rect = canvas.getBoundingClientRect();
    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.floor(rect.width * ratio));
    canvas.height = Math.max(1, Math.floor(154 * ratio));
    const context = canvas.getContext("2d");
    if (!context) {
      return;
    }
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.lineCap = "round";
    context.lineJoin = "round";
    context.lineWidth = 2.8;
    context.strokeStyle = "#17324d";
  };

  useEffect(() => {
    if (mode !== "draw") {
      return;
    }
    prepareCanvas();
    window.addEventListener("resize", prepareCanvas);
    return () => window.removeEventListener("resize", prepareCanvas);
  }, [mode]);

  useEffect(() => {
    if (!signingUrl) {
      setQrDataUrl("");
      return;
    }

    let cancelled = false;
    void QRCode.toDataURL(signingUrl, {
      margin: 1,
      scale: 7,
      color: {
        dark: "#17324d",
        light: "#ffffff"
      }
    }).then((dataUrl) => {
      if (!cancelled) {
        setQrDataUrl(dataUrl);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [signingUrl]);

  const pointerPosition = (event: React.PointerEvent<HTMLCanvasElement>): { x: number; y: number } => {
    const canvas = event.currentTarget;
    const rect = canvas.getBoundingClientRect();
    return {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top
    };
  };

  const startDrawing = (event: React.PointerEvent<HTMLCanvasElement>): void => {
    const canvas = event.currentTarget;
    const context = canvas.getContext("2d");
    if (!context) {
      return;
    }

    const point = pointerPosition(event);
    drawingRef.current = true;
    drewRef.current = false;
    canvas.setPointerCapture(event.pointerId);
    context.beginPath();
    context.moveTo(point.x, point.y);
  };

  const draw = (event: React.PointerEvent<HTMLCanvasElement>): void => {
    if (!drawingRef.current) {
      return;
    }

    const context = event.currentTarget.getContext("2d");
    if (!context) {
      return;
    }

    const point = pointerPosition(event);
    context.lineTo(point.x, point.y);
    context.stroke();
    drewRef.current = true;
    setHasDrawing(true);
  };

  const stopDrawing = (event: React.PointerEvent<HTMLCanvasElement>): void => {
    if (!drawingRef.current) {
      return;
    }
    drawingRef.current = false;
    if (drewRef.current) {
      onChange(event.currentTarget.toDataURL("image/png"));
    }
    event.currentTarget.releasePointerCapture(event.pointerId);
  };

  const useDrawnSignature = (): void => {
    const canvas = canvasRef.current;
    if (!canvas || !hasDrawing) {
      return;
    }
    onChange(canvas.toDataURL("image/png"));
  };

  const clearSignature = (): void => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (canvas && context) {
      context.clearRect(0, 0, canvas.width, canvas.height);
    }
    setHasDrawing(false);
    onChange(undefined);
  };

  const copySigningUrl = async (): Promise<void> => {
    if (signingUrl) {
      await navigator.clipboard.writeText(signingUrl);
    }
  };

  return (
    <div className={styles.signatureInput}>
      <div className={styles.signatureModeTabs} role="tablist" aria-label="Signature options">
        <button
          type="button"
          className={mode === "draw" ? styles.signatureModeActive : ""}
          onClick={() => setMode("draw")}
        >
          Open to sign
        </button>
        <button
          type="button"
          className={mode === "upload" ? styles.signatureModeActive : ""}
          onClick={() => setMode("upload")}
        >
          Upload image
        </button>
        <button
          type="button"
          className={mode === "mobile" ? styles.signatureModeActive : ""}
          onClick={() => setMode("mobile")}
        >
          Mobile QR
        </button>
      </div>

      {mode === "draw" ? (
        <div className={styles.signatureDrawPanel}>
          <canvas
            ref={canvasRef}
            className={styles.signatureCanvas}
            aria-label="Draw signature"
            onPointerDown={startDrawing}
            onPointerMove={draw}
            onPointerUp={stopDrawing}
            onPointerCancel={stopDrawing}
          />
          <div className={styles.compactActions}>
            <button type="button" disabled={!hasDrawing} onClick={useDrawnSignature}>
              Use signature
            </button>
            <button type="button" onClick={clearSignature}>
              Clear
            </button>
          </div>
        </div>
      ) : null}

      {mode === "upload" ? (
        <label className={styles.signatureUpload}>
          <span>Signature image</span>
          <input
            type="file"
            accept="image/png,image/jpeg"
            onChange={async (event) => {
              const file = event.target.files?.[0];
              if (!file) {
                return;
              }
              onChange(await fileToDataUrl(file));
            }}
          />
        </label>
      ) : null}

      {mode === "mobile" ? (
        <div className={styles.signatureQrPanel}>
          {qrDataUrl ? <img src={qrDataUrl} alt="QR code for mobile signing" /> : null}
          <div className={styles.compactActions}>
            <a href={signingUrl} target="_blank" rel="noreferrer">
              Open link
            </a>
            <button type="button" onClick={() => void copySigningUrl()}>
              Copy link
            </button>
          </div>
        </div>
      ) : null}

      {value ? (
        <div className={styles.signaturePreview}>
          <span>Current signature</span>
          <img src={value} alt="Signature preview" />
        </div>
      ) : null}
    </div>
  );
}

function buildInitialFieldValues(nextRequest: SignatureRequestResponse): Record<string, FieldDraftValue> {
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

  return initialValues;
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
  const [otp, setOtp] = useState("");
  const [passcode, setPasscode] = useState("");
  const [signingUrl, setSigningUrl] = useState("");

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
        if (nextRequest.verification.identityVerified) {
          const metadata = await getSignaturePdfMetadata(token);
          setPdfMeta(metadata);
        } else {
          setPdfMeta(null);
        }

        setFieldValues(buildInitialFieldValues(nextRequest));
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

  useEffect(() => {
    setSigningUrl(window.location.href);
  }, []);

  const reloadRequest = async (): Promise<void> => {
    if (!token) {
      return;
    }
    const nextRequest = await getSignatureRequest(token);
    setRequest(nextRequest);
    if (nextRequest.verification.identityVerified) {
      setPdfMeta(await getSignaturePdfMetadata(token));
      setFieldValues(buildInitialFieldValues(nextRequest));
      setSelectedFieldId(
        nextRequest.fields.find((field) => field.recipientId === nextRequest.recipient.id)?.id ?? null
      );
    }
  };

  const requestOtp = async (): Promise<void> => {
    if (!token) {
      return;
    }
    try {
      setBusy(true);
      const result = await requestSignatureOtp(token);
      setStatus(`Verification code sent. It expires ${formatEatTime(result.expiresAt)}.`);
      await reloadRequest();
    } catch (error) {
      setStatus(`Could not send code: ${(error as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const verifyOtp = async (): Promise<void> => {
    if (!token) {
      return;
    }
    try {
      setBusy(true);
      await verifySignatureOtp(token, otp);
      setOtp("");
      setStatus("Email verified.");
      await reloadRequest();
    } catch (error) {
      setStatus(`Verification failed: ${(error as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const verifyPasscode = async (): Promise<void> => {
    if (!token) {
      return;
    }
    try {
      setBusy(true);
      await verifySignaturePasscode(token, passcode);
      setPasscode("");
      setStatus("Passcode verified.");
      await reloadRequest();
    } catch (error) {
      setStatus(`Passcode failed: ${(error as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

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
        !request.verification.identityVerified ? (
          <section className={styles.builderGrid}>
            <aside className={styles.sidebar}>
              <article className={styles.panel}>
                <div className={styles.panelHeader}>
                  <span className={styles.eyebrow}>Identity check</span>
                  <strong>{request.recipient.email}</strong>
                </div>
                <p className={styles.panelCopy}>
                  Verify your email before the document is shown. Some workflows also require a signer passcode.
                </p>
                {!request.verification.otpVerified ? (
                  <div className={styles.fieldEditor}>
                    <button className={styles.primaryButton} type="button" disabled={busy} onClick={() => void requestOtp()}>
                      Send email code
                    </button>
                    <label>
                      Email code
                      <input value={otp} onChange={(event) => setOtp(event.target.value)} inputMode="numeric" />
                    </label>
                    <button className={styles.secondaryButton} type="button" disabled={busy || !otp.trim()} onClick={() => void verifyOtp()}>
                      Verify email
                    </button>
                  </div>
                ) : null}
                {request.verification.otpVerified && request.verification.passcodeRequired && !request.verification.passcodeVerified ? (
                  <div className={styles.fieldEditor}>
                    <label>
                      Signer passcode
                      <input value={passcode} onChange={(event) => setPasscode(event.target.value)} type="password" />
                    </label>
                    <button className={styles.secondaryButton} type="button" disabled={busy || !passcode.trim()} onClick={() => void verifyPasscode()}>
                      Verify passcode
                    </button>
                  </div>
                ) : null}
                <p className={styles.note}>{status}</p>
              </article>
              <article className={styles.panel}>
                <div className={styles.panelHeader}>
                  <span className={styles.eyebrow}>Trust</span>
                  <strong>Signature evidence</strong>
                </div>
                <p className={styles.panelCopy}>
                  Email verification, timestamps, IP address, browser details, and signer events are recorded in the audit certificate.
                </p>
                <a href="/legal-validity" target="_blank" rel="noreferrer">Legal validity</a>
                <a href="/signature-levels" target="_blank" rel="noreferrer">Signature levels</a>
              </article>
            </aside>
            <section className={styles.canvasStack}>
              <div className={styles.emptyState}>
                <strong>Verify your identity to open the document.</strong>
                <span>The PDF and assigned fields stay locked until verification is complete.</span>
              </div>
            </section>
          </section>
        ) : (
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
              <p className={styles.panelCopy}>Expires {formatEatDateTime(request.expiresAt)}</p>
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
                      <SignatureFieldInput
                        value={fieldValues[field.id]?.signatureDataUrl}
                        signingUrl={signingUrl}
                        onChange={(signatureDataUrl) =>
                          setFieldValues((current) => ({
                            ...current,
                            [field.id]: {
                              ...current[field.id],
                              signatureDataUrl
                            }
                          }))
                        }
                      />
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
              {request.auditCertificateUrl ? (
                <a className={styles.secondaryButton} href={request.auditCertificateUrl} target="_blank" rel="noreferrer">
                  Download audit certificate
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
        )
      ) : null}
    </main>
  );
}
