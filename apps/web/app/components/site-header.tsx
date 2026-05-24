"use client";

import Link from "next/link";
import { ChevronDown, Code2, Download, FileCheck2, Layers3, LogOut, Menu, ShieldCheck, UserRound, X } from "lucide-react";
import { useState } from "react";
import { useAuth } from "./auth-provider";
import { ToolIcon } from "./tool-icon";
import {
  isToolActive,
  TOOL_GROUPS,
  TOOLS,
  toolsForGroup,
  type ActiveKey,
  type ToolGroupId
} from "./tool-registry";

type SiteHeaderProps = {
  active?: ActiveKey | "all-tools" | "image-tools" | null;
};

const DESKTOP_TOOL_GROUPS = TOOL_GROUPS.filter((group) => group.id !== "sign");

function activeGroup(active: SiteHeaderProps["active"]): ToolGroupId | null {
  if (!active || active === "all-tools" || active === "image-tools") {
    return null;
  }

  const tool = TOOLS.find((item) => isToolActive(item, active));
  return tool?.group ?? null;
}

export function SiteHeader({ active = null }: SiteHeaderProps): React.JSX.Element {
  const { user, loading, logout } = useAuth();
  const [openGroup, setOpenGroup] = useState<ToolGroupId | null>(null);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const activeTool = active && active !== "all-tools" && active !== "image-tools" ? active : null;
  const currentGroup = activeGroup(active);
  const selectedGroup = openGroup ?? currentGroup ?? "organize";
  const selectedTools = toolsForGroup(selectedGroup);

  const handleLogout = async (): Promise<void> => {
    if (loggingOut) {
      return;
    }

    try {
      setLoggingOut(true);
      setOpenGroup(null);
      setAccountMenuOpen(false);
      setMobileOpen(false);
      await logout();
    } catch {
      // Keep the current user visible if the server-side logout did not complete.
    } finally {
      setLoggingOut(false);
    }
  };

  return (
    <header className="site-header">
      <div className="header-inner">
        <Link href="/" className="logo" aria-label="iHatePDF home">
          <span className="logo-word">I</span>
          <span className="logo-heart">❤</span>
          <span className="logo-word">PDF</span>
        </Link>

        <nav className="top-nav top-nav--desktop" aria-label="Primary tools">
          <Link href="/" className={`top-nav-link top-nav-home ${active === "all-tools" ? "is-active" : ""}`}>
            All tools
          </Link>
          <Link
            href="/image-tools"
            className={`top-nav-link top-nav-home ${active === "image-tools" ? "is-active" : ""}`}
          >
            Image tools
          </Link>
          <Link href="/desktop" className="top-nav-link top-nav-home">
            Desktop
          </Link>
          {DESKTOP_TOOL_GROUPS.map((group) => {
            const isActive = group.id === currentGroup;
            const isOpen = openGroup === group.id;

            return (
              <button
                key={group.id}
                type="button"
                className={`top-nav-link nav-group-trigger ${isActive ? "is-active" : ""} ${isOpen ? "is-open" : ""}`}
                onMouseEnter={() => setOpenGroup(group.id)}
                onFocus={() => setOpenGroup(group.id)}
                onClick={() => setOpenGroup(isOpen && openGroup ? null : group.id)}
                aria-expanded={isOpen}
              >
                {group.label}
                <ChevronDown aria-hidden="true" size={14} />
              </button>
            );
          })}
        </nav>

        <button
          type="button"
          className="mobile-menu-button"
          onClick={() => setMobileOpen((current) => !current)}
          aria-expanded={mobileOpen}
          aria-label="Toggle navigation"
        >
          {mobileOpen ? <X aria-hidden="true" size={20} /> : <Menu aria-hidden="true" size={20} />}
        </button>

        <div className="auth-actions">
          {!loading && user ? (
            <div
              className="account-menu-wrap"
              onBlur={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget)) {
                  setAccountMenuOpen(false);
                }
              }}
            >
              <button
                className={`auth-link auth-link-user account-menu-trigger ${accountMenuOpen ? "is-open" : ""}`}
                type="button"
                onClick={() => setAccountMenuOpen((current) => !current)}
                aria-expanded={accountMenuOpen}
                aria-haspopup="menu"
              >
                <UserRound aria-hidden="true" size={16} />
                <span>{user.name || user.email}</span>
                <ChevronDown aria-hidden="true" size={14} />
              </button>

              {accountMenuOpen ? (
                <div className="account-menu" role="menu">
                  <Link href="/account" className="account-menu__item account-menu__item--identity" role="menuitem">
                    <UserRound aria-hidden="true" size={17} />
                    <span>
                      <strong>{user.name || "Account"}</strong>
                      <small>{user.email}</small>
                    </span>
                  </Link>
                  <Link href="/developer" className="account-menu__item" role="menuitem">
                    <Code2 aria-hidden="true" size={17} />
                    <span>Developer</span>
                  </Link>
                  <Link href="/legal-validity" className="account-menu__item" role="menuitem">
                    <FileCheck2 aria-hidden="true" size={17} />
                    <span>Validity</span>
                  </Link>
                  <Link href="/signature-levels" className="account-menu__item" role="menuitem">
                    <Layers3 aria-hidden="true" size={17} />
                    <span>Levels</span>
                  </Link>
                  {user.isAdmin ? (
                    <Link href="/admin" className="account-menu__item" role="menuitem">
                      <ShieldCheck aria-hidden="true" size={17} />
                      <span>Admin</span>
                    </Link>
                  ) : null}
                  <button
                    className="account-menu__item account-menu__button"
                    type="button"
                    disabled={loggingOut}
                    onClick={() => void handleLogout()}
                    role="menuitem"
                  >
                    <LogOut aria-hidden="true" size={17} />
                    <span>{loggingOut ? "Logging out..." : "Log out"}</span>
                  </button>
                </div>
              ) : null}
            </div>
          ) : null}
          {!loading && !user ? (
            <div className="guest-actions">
              <Link href="/developer" className="auth-link">
                Developer
              </Link>
              <Link href="/desktop" className="auth-link">
                Desktop
              </Link>
              <Link href="/login" className="auth-link auth-link-strong">
                Log in
              </Link>
            </div>
          ) : null}
          <Link
            href="/editor-studio"
            className={`signup-btn ${active === "edit" || active === "sign-pdf" ? "is-active" : ""}`}
          >
            <ToolIcon name="edit" className="button-icon" />
            Open Studio
          </Link>
        </div>
      </div>

      {openGroup ? (
        <div
          className="mega-menu top-nav--desktop"
          onMouseLeave={() => setOpenGroup(null)}
          onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget)) {
              setOpenGroup(null);
            }
          }}
        >
          <div className="mega-menu__intro">
            <strong>{TOOL_GROUPS.find((group) => group.id === selectedGroup)?.label}</strong>
            <span>{TOOL_GROUPS.find((group) => group.id === selectedGroup)?.description}</span>
          </div>
          <div className="mega-menu__tools">
            {selectedTools.map((tool) => (
              <Link
                key={tool.key}
                href={tool.href}
                className={`mega-menu__tool ${isToolActive(tool, activeTool) ? "is-active" : ""}`}
              >
                <span className="mega-menu__icon">
                  <ToolIcon name={tool.icon} />
                </span>
                <span>
                  <strong>{tool.title}</strong>
                  <small>{tool.description}</small>
                </span>
              </Link>
            ))}
          </div>
        </div>
      ) : null}

      {mobileOpen ? (
        <nav className="mobile-tool-menu" aria-label="Mobile tools">
          <Link
            href="/"
            className={`mobile-tool-menu__item mobile-tool-menu__item--home ${
              active === "all-tools" ? "is-active" : ""
            }`}
            onClick={() => setMobileOpen(false)}
          >
            <span>All tools</span>
          </Link>
          <Link
            href="/desktop"
            className="mobile-tool-menu__item mobile-tool-menu__item--home"
            onClick={() => setMobileOpen(false)}
          >
            <Download aria-hidden="true" size={17} />
            <span>Desktop app</span>
          </Link>
          <Link
            href="/image-tools"
            className={`mobile-tool-menu__item mobile-tool-menu__item--home ${
              active === "image-tools" ? "is-active" : ""
            }`}
            onClick={() => setMobileOpen(false)}
          >
            <span>Image tools</span>
          </Link>
          {TOOL_GROUPS.map((group) => (
            <section key={group.id} className="mobile-tool-menu__group">
              <h2>{group.label}</h2>
              <div>
                {toolsForGroup(group.id).map((tool) => (
                  <Link
                    key={tool.key}
                    href={tool.href}
                    className={`mobile-tool-menu__item ${isToolActive(tool, activeTool) ? "is-active" : ""}`}
                    onClick={() => setMobileOpen(false)}
                  >
                    <ToolIcon name={tool.icon} />
                    <span>{tool.shortTitle}</span>
                  </Link>
                ))}
              </div>
            </section>
          ))}
        </nav>
      ) : null}
    </header>
  );
}
