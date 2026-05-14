"use client";

import { BatchOperationPage } from "../components/batch-operation-page";
import { queueWordToPdf } from "../lib/pdf-api";

const WORD_MIME_TYPES = [
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
] as const;

function deriveOutputName(file: File): string {
  const baseName = file.name.replace(/\.docx$/i, "");
  return `${baseName}.pdf`;
}

export default function WordToPdfPage(): React.JSX.Element {
  return (
    <BatchOperationPage
      active="word-to-pdf"
      title="Word to PDF"
      description="Convert multiple DOCX files to PDF in one queue with live per-file progress."
      selectLabel="Select Word files"
      emptyHint="Choose one or more .docx files"
      accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
      allowedMimeTypes={WORD_MIME_TYPES}
      startLabel="Convert Batch to PDF"
      runningLabel="Converting..."
      downloadLabel="Download PDF file"
      helperText="Each DOCX file is converted as its own task so one failure does not block the rest of the batch."
      deriveOutputName={deriveOutputName}
      queueTask={(fileId, outputName) => queueWordToPdf(fileId, outputName)}
    />
  );
}
