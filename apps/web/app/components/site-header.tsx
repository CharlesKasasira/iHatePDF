"use client";

import Link from "next/link";
import { ChevronDown, LogOut, Menu, UserRound, X } from "lucide-react";
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
  active?: ActiveKey | null;
};

function activeGroup(active: ActiveKey | null): ToolGroupId {
  const tool = TOOLS.find((item) => isToolActive(item, active));
  return tool?.group ?? "organize";
}

export function SiteHeader({ active = null }: SiteHeaderProps): React.JSX.Element {
  const { user, loading, logout } = useAuth();
  const [openGroup, setOpenGroup] = useState<ToolGroupId | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const selectedGroup = openGroup ?? activeGroup(active);
  const selectedTools = toolsForGroup(selectedGroup);

  const handleLogout = async (): Promise<void> => {
    if (loggingOut) {
      return;
    }

    try {
      setLoggingOut(true);
      setOpenGroup(null);
      setMobileOpen(false);
      await logout();
    } catch {
      // The auth provider clears local session state optimistically; server revocation is best effort here.
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
          {TOOL_GROUPS.map((group) => {
            const isActive = group.id === activeGroup(active);
            const isOpen = selectedGroup === group.id;

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
          <Link href="/legal-validity" className="auth-link">
            Validity
          </Link>
          <Link href="/signature-levels" className="auth-link">
            Levels
          </Link>
          {!loading && user ? (
            <>
              {user.isAdmin ? (
                <Link href="/admin" className="auth-link">
                  Admin
                </Link>
              ) : null}
              <Link href="/account" className="auth-link auth-link-user">
                <UserRound aria-hidden="true" size={16} />
                <span>{user.name || user.email}</span>
              </Link>
              <button
                className="auth-link auth-link-button"
                type="button"
                disabled={loggingOut}
                onClick={() => void handleLogout()}
              >
                <LogOut aria-hidden="true" size={15} />
                <span>{loggingOut ? "Logging out..." : "Log out"}</span>
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
                className={`mega-menu__tool ${isToolActive(tool, active) ? "is-active" : ""}`}
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
          {TOOL_GROUPS.map((group) => (
            <section key={group.id} className="mobile-tool-menu__group">
              <h2>{group.label}</h2>
              <div>
                {toolsForGroup(group.id).map((tool) => (
                  <Link
                    key={tool.key}
                    href={tool.href}
                    className={`mobile-tool-menu__item ${isToolActive(tool, active) ? "is-active" : ""}`}
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
