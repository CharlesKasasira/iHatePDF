"use client";

import { PageRangeOperationPage } from "../components/page-range-operation-page";
import { queueRemovePages } from "../lib/pdf-api";

function stripExtension(fileName: string): string {
  const dotIndex = fileName.lastIndexOf(".");
  return dotIndex > 0 ? fileName.slice(0, dotIndex) : fileName;
}

export default function RemovePagesPage(): React.JSX.Element {
  return (
    <PageRangeOperationPage
      active="remove-pages"
      title="Remove pages from PDF"
      description="Delete selected pages and export a clean PDF with the remaining pages preserved in order."
      rangeLabel="Pages to remove"
      rangePlaceholder="2,4-6"
      outputPlaceholder="pages-removed.pdf"
      helperText="Enter the page ranges you want to delete from the document."
      startLabel="Remove pages"
      runningLabel="Removing..."
      completionLabel="Page removal completed."
      downloadLabel="Download updated PDF"
      deriveOutputName={(file) => `${stripExtension(file.name)}-pages-removed.pdf`}
      queueTask={queueRemovePages}
    />
  );
}
