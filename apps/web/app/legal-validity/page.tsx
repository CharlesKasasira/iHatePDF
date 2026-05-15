import { SiteHeader } from "../components/site-header";

export default function LegalValidityPage(): React.JSX.Element {
  return (
    <div className="site-shell">
      <SiteHeader />
      <main className="tools-home">
        <section className="hero-block">
          <h1>Legal validity for iHatePDF signatures</h1>
          <p>
            iHatePDF records signer intent, identity checks, timestamps, IP address, browser details,
            document references, and a complete event log for each completed signing workflow.
          </p>
        </section>

        <section className="tool-grid">
          <article className="tool-card">
            <h2>What is captured</h2>
            <p>
              Each signed envelope receives an audit certificate with the requester, signer emails,
              verification events, completion times, field completion details, and final PDF hash.
            </p>
          </article>
          <article className="tool-card">
            <h2>How to use it</h2>
            <p>
              Keep the final signed PDF together with its audit certificate. The certificate is designed
              to help demonstrate who signed, when they signed, and which document was finalized.
            </p>
          </article>
          <article className="tool-card">
            <h2>Important note</h2>
            <p>
              This page is product information, not legal advice. Signature enforceability depends on
              document type, jurisdiction, parties, consent, and applicable law.
            </p>
          </article>
        </section>
      </main>
    </div>
  );
}
