import { SiteHeader } from "../components/site-header";

export default function SignatureLevelsPage(): React.JSX.Element {
  return (
    <div className="site-shell">
      <SiteHeader />
      <main className="tools-home">
        <section className="hero-block">
          <h1>iHatePDF signature evidence levels</h1>
          <p>
            Signing workflows can combine email verification, optional passcodes, field-level capture,
            and audit certificates to match the trust level needed for routine document approvals.
          </p>
        </section>

        <section className="tool-grid">
          <article className="tool-card">
            <h2>Simple electronic signature</h2>
            <p>
              A signer completes assigned fields and confirms intent. This is useful for low-risk
              acknowledgements where sender and signer already have a trusted relationship.
            </p>
          </article>
          <article className="tool-card">
            <h2>Email-verified signature</h2>
            <p>
              iHatePDF requires an emailed one-time code before the signer can view or complete the
              document. The verification event is included in the audit certificate.
            </p>
          </article>
          <article className="tool-card">
            <h2>Passcode-enhanced signature</h2>
            <p>
              Senders can add a signer passcode for workflows that need a second shared-secret check
              after email verification.
            </p>
          </article>
        </section>
      </main>
    </div>
  );
}
