"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { SiteHeader } from "./components/site-header";
import { ToolIcon } from "./components/tool-icon";
import { TOOL_GROUPS, TOOLS, toolsForGroup, type ToolGroupId } from "./components/tool-registry";

const FILTERS = ["all", ...TOOL_GROUPS.map((group) => group.id)] as const;
type Filter = (typeof FILTERS)[number];

function filterLabel(filter: Filter): string {
  if (filter === "all") {
    return "All tools";
  }
  return TOOL_GROUPS.find((group) => group.id === filter)?.label ?? filter;
}

export default function HomePage(): React.JSX.Element {
  const [selectedFilter, setSelectedFilter] = useState<Filter>("all");

  const visibleTools = useMemo(
    () => (selectedFilter === "all" ? TOOLS : toolsForGroup(selectedFilter as ToolGroupId)),
    [selectedFilter]
  );

  return (
    <div className="site-shell">
      <SiteHeader active="all-tools" />

      <main className="tools-home">
        <section className="hero-block">
          <h1>Every PDF workflow in one polished workspace</h1>
          <p>
            Self-hosted tools for organizing, optimizing, converting, editing, securing, and signing
            documents with clear progress and deliberate retention controls.
          </p>
        </section>

        <section className="trust-banner" aria-label="Trust and privacy">
          <article>
            <strong>Private by deployment</strong>
            <span>Your files stay on your infrastructure, not a random third-party SaaS.</span>
          </article>
          <article>
            <strong>Operational progress</strong>
            <span>Uploads, queued jobs, failures, and downloads stay visible while work runs.</span>
          </article>
          <article>
            <strong>Precise ordering</strong>
            <span>Drag files, page slots, layers, and signers into the order you need.</span>
          </article>
        </section>

        <section className="filter-row" aria-label="Tool categories">
          {FILTERS.map((filter) => (
            <button
              key={filter}
              type="button"
              className={`filter-chip ${selectedFilter === filter ? "is-selected" : ""}`}
              onClick={() => setSelectedFilter(filter)}
              aria-pressed={selectedFilter === filter}
            >
              {filterLabel(filter)}
            </button>
          ))}
        </section>

        <section className="tool-grid" aria-label="PDF tools">
          {visibleTools.map((tool) => (
            <Link
              href={tool.href}
              key={tool.key}
              className={`tool-card ${tool.featured ? "is-highlighted" : ""}`}
            >
              <div className="tool-icon">
                <ToolIcon name={tool.icon} />
              </div>
              {tool.badge ? <span className="tool-badge">{tool.badge}</span> : null}
              <span className="tool-card__group">{filterLabel(tool.group)}</span>
              <h2>{tool.title}</h2>
              <p>{tool.description}</p>
            </Link>
          ))}
        </section>
      </main>
    </div>
  );
}
