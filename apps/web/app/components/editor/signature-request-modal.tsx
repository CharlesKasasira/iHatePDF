"use client";

import type { EditorRectangleLayer, EditorSignatureRequestState, SignatureFlowStep } from "./types";

export function SignatureRequestModal({
  signatureFlowStep,
  signatureRequest,
  selectedSignatureBox,
  busy,
  onClose,
  onOnlyMe,
  onChooseSeveralPeople,
  onBack,
  onSignatureRequestChange,
  onSendSignatureRequest
}: {
  signatureFlowStep: SignatureFlowStep;
  signatureRequest: EditorSignatureRequestState;
  selectedSignatureBox: EditorRectangleLayer | null;
  busy: boolean;
  onClose: () => void;
  onOnlyMe: () => void;
  onChooseSeveralPeople: () => void;
  onBack: () => void;
  onSignatureRequestChange: (patch: Partial<EditorSignatureRequestState>) => void;
  onSendSignatureRequest: () => Promise<void>;
}): React.JSX.Element | null {
  if (signatureFlowStep === "closed") {
    return null;
  }

  return (
    <div className="studio-modal-backdrop" onClick={onClose}>
      <div
        className="studio-modal"
        onClick={(event) => {
          event.stopPropagation();
        }}
      >
        {signatureFlowStep === "choose" ? (
          <>
            <div className="studio-modal__header">
              <div>
                <span className="studio-panel__eyebrow">Sign PDF</span>
                <h2>Who will sign this document?</h2>
              </div>
              <button type="button" className="studio-modal__close" onClick={onClose}>
                Close
              </button>
            </div>

            <div className="studio-sign-choice-grid">
              <button type="button" className="studio-sign-choice" onClick={onOnlyMe}>
                <strong>Only me</strong>
                <span>Sign this document yourself with a local signature image.</span>
              </button>

              <button
                type="button"
                className="studio-sign-choice is-highlighted"
                onClick={onChooseSeveralPeople}
              >
                <strong>Several people</strong>
                <span>Invite another signer with a secure link for the selected box.</span>
              </button>
            </div>
          </>
        ) : null}

        {signatureFlowStep === "request" ? (
          <>
            <div className="studio-modal__header">
              <div>
                <span className="studio-panel__eyebrow">Signature Request</span>
                <h2>Create your signature request</h2>
              </div>
              <button type="button" className="studio-modal__close" onClick={onClose}>
                Close
              </button>
            </div>

            <div className="studio-modal__body">
              <section className="studio-modal__section">
                <h3>Who will receive your document?</h3>
                <div className="studio-request-recipient">
                  <input
                    value={signatureRequest.signerName}
                    onChange={(event) => onSignatureRequestChange({ signerName: event.target.value })}
                    placeholder="Name"
                  />
                  <input
                    type="email"
                    value={signatureRequest.signerEmail}
                    onChange={(event) => onSignatureRequestChange({ signerEmail: event.target.value })}
                    placeholder="Email"
                  />
                  <select
                    value={signatureRequest.signerRole}
                    onChange={(event) => onSignatureRequestChange({ signerRole: event.target.value })}
                  >
                    <option value="Signer">Signer</option>
                    <option value="Approver">Approver</option>
                    <option value="Viewer">Viewer</option>
                  </select>
                </div>
              </section>

              <section className="studio-modal__section">
                <h3>Request details</h3>
                <div className="studio-form-grid">
                  <label>
                    Your email
                    <input
                      type="email"
                      value={signatureRequest.requesterEmail}
                      onChange={(event) =>
                        onSignatureRequestChange({ requesterEmail: event.target.value })
                      }
                      placeholder="you@example.com"
                    />
                  </label>
                  <label>
                    Signed output name
                    <input
                      value={signatureRequest.outputName}
                      onChange={(event) => onSignatureRequestChange({ outputName: event.target.value })}
                      placeholder="signed-request.pdf"
                    />
                  </label>
                  <label>
                    Signature box
                    <input
                      value={
                        selectedSignatureBox
                          ? `Page ${selectedSignatureBox.page} · ${Math.round(selectedSignatureBox.width)} x ${Math.round(selectedSignatureBox.height)}`
                          : "Select a rectangle layer"
                      }
                      readOnly
                    />
                  </label>
                  <label>
                    Message
                    <textarea
                      value={signatureRequest.message}
                      onChange={(event) => onSignatureRequestChange({ message: event.target.value })}
                      placeholder="Please sign this document."
                    />
                  </label>
                </div>
              </section>

              <section className="studio-modal__section">
                <h3>Settings</h3>
                <div className="studio-request-settings">
                  <div className="studio-request-setting">
                    <strong>Expiration</strong>
                    <span>Requests currently expire according to the server signing policy.</span>
                  </div>
                  <div className="studio-request-setting">
                    <strong>Email notifications</strong>
                    <span>
                      The signer receives the secure link by email, and completion can be tracked from
                      the returned document task.
                    </span>
                  </div>
                </div>
              </section>
            </div>

            <div className="studio-modal__footer">
              <p
                className={
                  signatureRequest.status.toLowerCase().includes("failed") ? "error" : "small"
                }
              >
                {signatureRequest.status || "Complete the signer details and apply the request."}
              </p>
              {signatureRequest.link ? (
                <a
                  className="studio-secondary-button"
                  href={signatureRequest.link}
                  target="_blank"
                  rel="noreferrer"
                >
                  Open link
                </a>
              ) : null}
              <button type="button" className="studio-secondary-button" onClick={onBack}>
                Back
              </button>
              <button
                type="button"
                className="studio-primary-button"
                onClick={() => void onSendSignatureRequest()}
                disabled={busy}
              >
                {busy ? "Sending request..." : "Apply"}
              </button>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
