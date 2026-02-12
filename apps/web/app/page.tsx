import Link from "next/link";
import type { Route } from "next";
import { SiteHeader } from "./components/site-header";

type ToolCard = {
  title: string;
  description: string;
  href: Route;
  icon: string;
  iconClass: string;
  highlight?: boolean;
  badge?: string;
};

const FILTERS = [
  "All",
  "Workflows",
  "Organize PDF",
  "Optimize PDF",
  "Convert PDF",
  "Edit PDF",
  "PDF Security"
];

const TOOLS: ToolCard[] = [
  {
    title: "Merge PDF",
    description: "Combine PDFs in the order you want with the easiest PDF merger available.",
    href: "/merge-pdf",
    icon: "↗↘",
    iconClass: "icon-orange",
    highlight: true
  },
  {
    title: "Split PDF",
    description: "Separate one page or a whole set for easy conversion into independent PDF files.",
    href: "/split-pdf",
    icon: "⇱⇲",
    iconClass: "icon-orange"
  },
  {
    title: "Compress PDF",
    description: "Reduce file size while optimizing for maximal PDF quality.",
    href: "/",
    icon: "⤢",
    iconClass: "icon-green"
  },
  {
    title: "PDF to Word",
    description: "Convert PDF files into easy to edit DOC and DOCX documents.",
    href: "/",
    icon: "W",
    iconClass: "icon-blue"
  },
  {
    title: "PDF to PowerPoint",
    description: "Turn PDF files into easy to edit PPT and PPTX slideshows.",
    href: "/",
    icon: "P",
    iconClass: "icon-orange"
  },
  {
    title: "PDF to Excel",
    description: "Pull data straight from PDFs into Excel spreadsheets in seconds.",
    href: "/",
    icon: "X",
    iconClass: "icon-green"
  },
  {
    title: "Word to PDF",
    description: "Make DOC and DOCX files easy to read by converting them to PDF.",
    href: "/",
    icon: "W",
    iconClass: "icon-blue"
  },
  {
    title: "PowerPoint to PDF",
    description: "Make PPT and PPTX slideshows easy to view by converting them to PDF.",
    href: "/",
    icon: "P",
    iconClass: "icon-orange"
  },
  {
    title: "Excel to PDF",
    description: "Make EXCEL spreadsheets easy to read by converting them to PDF.",
    href: "/",
    icon: "X",
    iconClass: "icon-green"
  },
  {
    title: "Edit PDF",
    description: "Add text, images, shapes or freehand annotations to a PDF document.",
    href: "/",
    icon: "✎",
    iconClass: "icon-purple",
    badge: "New!"
  }
];

export default function HomePage(): React.JSX.Element {
  return (
    <div className="site-shell">
      <SiteHeader />

      <main className="tools-home">
        <section className="hero-block">
          <h1>Every tool you need to work with PDFs in one place</h1>
          <p>
            Every tool you need to use PDFs, at your fingertips. Merge, split, compress, convert,
            rotate, unlock and watermark PDFs with just a few clicks.
          </p>
        </section>

        <section className="filter-row" aria-label="Tool categories">
          {FILTERS.map((filter, index) => (
            <button
              key={filter}
              type="button"
              className={`filter-chip ${index === 0 ? "is-selected" : ""}`}
            >
              {filter}
            </button>
          ))}
        </section>

        <section className="tool-grid" aria-label="PDF tools">
          {TOOLS.map((tool) => (
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
