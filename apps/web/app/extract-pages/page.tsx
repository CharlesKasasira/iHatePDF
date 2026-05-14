"use client";

import { PageRangeOperationPage } from "../components/page-range-operation-page";
import { queueExtractPages } from "../lib/pdf-api";

function stripExtension(fileName: string): string {
  const dotIndex = fileName.lastIndexOf(".");
  return dotIndex > 0 ? fileName.slice(0, dotIndex) : fileName;
}

export default function ExtractPagesPage(): React.JSX.Element {
  return (
    <PageRangeOperationPage
      active="extract-pages"
      title="Extract pages from PDF"
      description="Pull selected pages into a new PDF without splitting every range into separate files."
      rangeLabel="Pages to extract"
      rangePlaceholder="1,3-5"
      outputPlaceholder="extracted-pages.pdf"
      helperText="Enter the page ranges you want to keep in the new PDF."
      startLabel="Extract pages"
      runningLabel="Extracting..."
      completionLabel="Page extraction completed."
      downloadLabel="Download extracted PDF"
      deriveOutputName={(file) => `${stripExtension(file.name)}-extracted.pdf`}
      queueTask={queueExtractPages}
    />
  );
}
