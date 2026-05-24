import Link from "next/link";
import { Download, Laptop, Monitor, Settings, ShieldCheck } from "lucide-react";
import { SiteHeader } from "../components/site-header";

const DOWNLOAD_BASE_URL = process.env.NEXT_PUBLIC_DESKTOP_DOWNLOAD_BASE_URL ?? "/downloads/desktop";

const DOWNLOADS = [
  {
    os: "macOS",
    format: "DMG",
    href: `${DOWNLOAD_BASE_URL}/ihatepdf-desktop-macos.dmg`,
    detail: "For Apple silicon and Intel Macs.",
    command: "pnpm build:desktop"
  },
  {
    os: "Windows",
    format: "MSI",
    href: `${DOWNLOAD_BASE_URL}/ihatepdf-desktop-windows.msi`,
    detail: "For Windows 10 and Windows 11.",
    command: "pnpm build:desktop"
  },
  {
    os: "Linux",
    format: "AppImage",
    href: `${DOWNLOAD_BASE_URL}/ihatepdf-desktop-linux.AppImage`,
    detail: "Portable Linux build for common desktop distributions.",
    command: "pnpm build:desktop"
  },
  {
    os: "Linux",
    format: "DEB",
    href: `${DOWNLOAD_BASE_URL}/ihatepdf-desktop-linux.deb`,
    detail: "Debian and Ubuntu package.",
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
              <strong>macOS, Windows, Linux</strong>
              <span>Installers are published per operating system.</span>
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
