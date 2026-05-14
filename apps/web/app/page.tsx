"use client";

import Link from "next/link";
import type { Route } from "next";
import { useMemo, useState } from "react";
import { SiteHeader } from "./components/site-header";

const FILTERS = [
  "All",
  "Workflows",
  "Organize PDF",
  "Optimize PDF",
  "Convert PDF",
  "Edit PDF",
  "PDF Security"
] as const;

type Filter = (typeof FILTERS)[number];
type ToolCategory = Exclude<Filter, "All">;

type ToolCard = {
  title: string;
  description: string;
  href: Route;
  icon: string;
  iconClass: string;
  categories: ToolCategory[];
  highlight?: boolean;
  badge?: string;
};

const TOOLS: ToolCard[] = [
  {
    title: "Merge PDF",
    description: "Combine PDFs in the order you want with the easiest PDF merger available.",
    href: "/merge-pdf",
    icon: "↗↘",
    iconClass: "icon-orange",
    categories: ["Workflows", "Organize PDF"],
    highlight: true
  },
  {
    title: "Split PDF",
    description: "Separate one page or a whole set for easy conversion into independent PDF files.",
    href: "/split-pdf",
    icon: "⇱⇲",
    iconClass: "icon-orange",
    categories: ["Workflows", "Organize PDF"]
  },
  {
    title: "Compress PDF",
    description: "Reduce file size while optimizing for maximal PDF quality.",
    href: "/compress-pdf",
    icon: "⤢",
    iconClass: "icon-green",
    categories: ["Workflows", "Optimize PDF"]
  },
  {
    title: "Protect PDF",
    description: "Encrypt your PDF with a password to keep sensitive data confidential.",
    href: "/protect-pdf",
    icon: "🔒",
    iconClass: "icon-purple",
    categories: ["PDF Security"]
  },
  {
    title: "Unlock PDF",
    description: "Remove a known password from a PDF so it can be opened without prompts.",
    href: "/unlock-pdf",
    icon: "🔓",
    iconClass: "icon-green",
    categories: ["PDF Security"]
  },
  {
    title: "PDF to Word",
    description: "Convert PDF files into easy to edit DOC and DOCX documents.",
    href: "/pdf-to-word",
    icon: "W",
    iconClass: "icon-blue",
    categories: ["Convert PDF"]
  },
  {
    title: "PDF to PowerPoint",
    description: "Turn PDF files into easy to edit PPT and PPTX slideshows.",
    href: "/pdf-to-powerpoint",
    icon: "P",
    iconClass: "icon-orange",
    categories: ["Convert PDF"]
  },
  {
    title: "PDF to Excel",
    description: "Pull data straight from PDFs into Excel spreadsheets in seconds.",
    href: "/pdf-to-excel",
    icon: "X",
    iconClass: "icon-green",
    categories: ["Convert PDF"]
  },
  {
    title: "Word to PDF",
    description: "Make DOC and DOCX files easy to read by converting them to PDF.",
    href: "/",
    icon: "W",
    iconClass: "icon-blue",
    categories: ["Convert PDF"]
  },
  {
    title: "PowerPoint to PDF",
    description: "Make PPT and PPTX slideshows easy to view by converting them to PDF.",
    href: "/powerpoint-to-pdf",
    icon: "P",
    iconClass: "icon-orange",
    categories: ["Convert PDF"]
  },
  {
    title: "Excel to PDF",
    description: "Make EXCEL spreadsheets easy to read by converting them to PDF.",
    href: "/excel-to-pdf",
    icon: "X",
    iconClass: "icon-green",
    categories: ["Convert PDF"]
  },
  {
    title: "PDF Editor Studio",
    description: "Place styled text, signatures, highlights, and image layers on multi-page placement stages.",
    href: "/editor-studio",
    icon: "✎",
    iconClass: "icon-purple",
    categories: ["Edit PDF"],
    badge: "Studio"
  }
];

export default function HomePage(): React.JSX.Element {
  const [selectedFilter, setSelectedFilter] = useState<Filter>("All");

  const visibleTools = useMemo(
    () =>
      selectedFilter === "All"
        ? TOOLS
        : TOOLS.filter((tool) => tool.categories.includes(selectedFilter)),
    [selectedFilter]
  );

  return (
    <div className="site-shell">
      <SiteHeader />

      <main className="tools-home">
        <section className="hero-block">
          <h1>Every tool you need to work with PDFs in one place</h1>
          <p>
            Self-hosted PDF workflows with deliberate retention controls. Merge, split, compress,
            convert, secure, and edit documents in a workspace you actually control.
          </p>
        </section>

        <section className="trust-banner" aria-label="Trust and privacy">
          <article>
            <strong>Private by deployment</strong>
            <span>Your files stay on your infrastructure, not a random third-party SaaS.</span>
          </article>
          <article>
            <strong>Explicit retention</strong>
            <span>Studio exports can auto-expire instead of lingering indefinitely.</span>
          </article>
          <article>
            <strong>Serious editor</strong>
            <span>Use the new Editor Studio for layered text, signatures, highlights, and images.</span>
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
              {filter}
            </button>
          ))}
        </section>

        <section className="tool-grid" aria-label="PDF tools">
          {visibleTools.map((tool) => (
            <Link
              href={tool.href}
              key={tool.title}
              className={`tool-card ${tool.highlight ? "is-highlighted" : ""}`}
            >
              <div className={`tool-icon ${tool.iconClass}`}>{tool.icon}</div>
              {tool.badge ? <span className="tool-badge">{tool.badge}</span> : null}
              <h2>{tool.title}</h2>
              <p>{tool.description}</p>
            </Link>
          ))}
        </section>
      </main>
    </div>
  );
}
