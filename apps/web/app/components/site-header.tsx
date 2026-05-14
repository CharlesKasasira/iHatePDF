"use client";

import Link from "next/link";
import type { Route } from "next";
import { useAuth } from "./auth-provider";

type ActiveKey =
  | "merge"
  | "split"
  | "remove-pages"
  | "extract-pages"
  | "organize-pdf"
  | "compress"
  | "sign-pdf"
  | "protect"
  | "unlock"
  | "jpg-to-pdf"
  | "pdf-to-word"
  | "pdf-to-jpg"
  | "pdf-to-powerpoint"
  | "pdf-to-excel"
  | "word-to-pdf"
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
  {
    label: "Organize",
    href: "/organize-pdf",
    match: ["remove-pages", "extract-pages", "organize-pdf"]
  },
  { label: "Compress", href: "/compress-pdf", match: ["compress"] },
  { label: "All tools", href: "/" }
];

export function SiteHeader({ active = null }: SiteHeaderProps): React.JSX.Element {
  const { user, loading, logout } = useAuth();

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
          {!loading && user ? (
            <>
              <Link href="/account" className="auth-link">
                {user.name || user.email}
              </Link>
              <button className="auth-link auth-link-button" type="button" onClick={() => void logout()}>
                Log out
              </button>
            </>
          ) : null}
          {!loading && !user ? (
            <>
              <Link href="/login" className="auth-link">
                Log in
              </Link>
              <Link href="/signup" className="auth-link auth-link-strong">
                Sign up
              </Link>
            </>
          ) : null}
          <Link
            href="/editor-studio"
            className={`signup-btn ${active === "edit" || active === "sign-pdf" ? "is-active" : ""}`}
          >
            Open Studio
          </Link>
        </div>
      </div>
    </header>
  );
}
