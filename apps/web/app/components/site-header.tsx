import Link from "next/link";
import type { Route } from "next";

type ActiveKey =
  | "merge"
  | "split"
  | "compress"
  | "protect"
  | "unlock"
  | "pdf-to-word"
  | "pdf-to-powerpoint"
  | "pdf-to-excel"
  | "excel-to-pdf"
  | "powerpoint-to-pdf"
  | "edit";

type SiteHeaderProps = {
  active?: ActiveKey | null;
};

const NAV_ITEMS: Array<{
  label: string;
  href: Route;
  match?: ActiveKey[];
}> = [
  { label: "Merge", href: "/merge-pdf", match: ["merge"] },
  { label: "Split", href: "/split-pdf", match: ["split"] },
  { label: "Compress", href: "/compress-pdf", match: ["compress"] },
  {
    label: "Convert",
    href: "/pdf-to-word",
    match: [
      "pdf-to-word",
      "pdf-to-powerpoint",
      "pdf-to-excel",
      "excel-to-pdf",
      "powerpoint-to-pdf"
    ]
  },
  { label: "All tools", href: "/" }
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
          {NAV_ITEMS.map((item) => {
            const isActive = item.match ? (active !== null && item.match.includes(active)) : active === null;

            return (
              <Link
                key={item.label}
                href={item.href}
                className={`top-nav-link ${isActive ? "is-active" : ""}`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="auth-actions">
          <Link
            href="/editor-studio"
            className={`signup-btn ${active === "edit" ? "is-active" : ""}`}
          >
            Open Studio
          </Link>
        </div>
      </div>
    </header>
  );
}
