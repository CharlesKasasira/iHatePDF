import Link from "next/link";
import type { Route } from "next";

type SiteHeaderProps = {
  active?: "merge" | "split" | null;
};

const NAV_ITEMS: Array<{ label: string; href: Route; key?: "merge" | "split" }> = [
  { label: "MERGE PDF", href: "/merge-pdf", key: "merge" },
  { label: "SPLIT PDF", href: "/split-pdf", key: "split" },
  { label: "COMPRESS PDF", href: "/" },
  { label: "CONVERT PDF", href: "/" },
  { label: "ALL PDF TOOLS", href: "/" }
];

export function SiteHeader({ active = null }: SiteHeaderProps): React.JSX.Element {
  return (
    <header className="site-header">
      <div className="header-inner">
        <Link href="/" className="logo" aria-label="iHatePDF home">
          <span className="logo-word">I</span>
          <span className="logo-heart">❤</span>
          <span className="logo-word">PDF</span>
        </Link>

        <nav className="top-nav" aria-label="Primary">
          {NAV_ITEMS.map((item) => (
            <Link
              key={item.label}
              href={item.href}
              className={`top-nav-link ${item.key && active === item.key ? "is-active" : ""}`}
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="auth-actions">
          <button type="button" className="login-link">Login</button>
          <button type="button" className="signup-btn">Sign up</button>
          <button type="button" className="menu-dot-btn" aria-label="Open menu">
            ⋮
          </button>
        </div>
      </div>
    </header>
  );
}
