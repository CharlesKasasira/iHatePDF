import Link from "next/link";
import { Download, Laptop, Monitor, Settings, ShieldCheck } from "lucide-react";
import { SiteHeader } from "../components/site-header";

const DOWNLOAD_BASE_URL =
  process.env.NEXT_PUBLIC_DESKTOP_DOWNLOAD_BASE_URL ??
  "https://github.com/CharlesKasasira/iHatePDF/releases/latest/download";

const DOWNLOADS = [
  {
    os: "macOS",
    format: "ZIP",
    href: `${DOWNLOAD_BASE_URL}/ihatepdf-desktop-macos.zip`,
    detail: "Apple silicon developer preview. Ad-hoc signed and not notarized.",
    command: "pnpm build:desktop"
  }
];

export default function DesktopDownloadsPage(): React.JSX.Element {
  return (
    <div className="site-shell">
      <SiteHeader active={null} />

      <main className="desktop-download-page">
        <section className="desktop-download-hero">
          <div>
            <span className="desktop-download-eyebrow">
              <Laptop aria-hidden="true" size={18} />
              Desktop app
            </span>
            <h1>Run iHatePDF from your desktop</h1>
            <p>
              Use native file picking, a remembered output folder, secure device keys, and the same
              self-hosted processing API that powers the web app.
            </p>
          </div>
          <div className="desktop-download-summary" aria-label="Desktop app highlights">
            <article>
              <Monitor aria-hidden="true" size={20} />
              <strong>Release assets</strong>
              <span>Verified binaries and checksums are published on GitHub Releases.</span>
            </article>
            <article>
              <ShieldCheck aria-hidden="true" size={20} />
              <strong>Secure device key</strong>
              <span>The app stores its API key in the OS keychain.</span>
            </article>
            <article>
              <Settings aria-hidden="true" size={20} />
              <strong>API-powered</strong>
              <span>Connects to your configured iHatePDF API server.</span>
            </article>
          </div>
        </section>

        <section className="desktop-download-grid" aria-label="Desktop downloads">
          {DOWNLOADS.map((item) => (
            <article className="desktop-download-card" key={`${item.os}-${item.format}`}>
              <div>
                <span>{item.format}</span>
                <h2>{item.os}</h2>
                <p>{item.detail}</p>
              </div>
              <a className="desktop-download-link" href={item.href} download>
                <Download aria-hidden="true" size={18} />
                Download {item.format}
              </a>
            </article>
          ))}
        </section>

        <section className="desktop-run-panel" aria-label="Run from source">
          <div>
            <h2>Run from source</h2>
            <p>
              Developers can run the desktop app from the monorepo while the API and worker are running.
            </p>
          </div>
          <pre>
            <code>{`pnpm install
pnpm dev
pnpm dev:desktop`}</code>
          </pre>
          <Link href="/developer" className="desktop-doc-link">
            API and developer settings
          </Link>
        </section>
      </main>
    </div>
  );
}
