"use client";

import { BatchOperationPage } from "../components/batch-operation-page";
import { powerpointToPdfGuide } from "../components/conversion-guides";
import { queuePowerpointToPdf } from "../lib/pdf-api";

const POWERPOINT_MIME_TYPES = [
  "application/vnd.openxmlformats-officedocument.presentationml.presentation"
] as const;

function deriveOutputName(file: File): string {
  const baseName = file.name.replace(/\.pptx$/i, "");
  return `${baseName}.pdf`;
}

export default function PowerpointToPdfPage(): React.JSX.Element {
  return (
    <BatchOperationPage
      active="powerpoint-to-pdf"
      title="PowerPoint to PDF"
      description="Convert multiple presentations to PDF and track the status of every deck in real time."
      selectLabel="Select PowerPoint files"
      emptyHint="Choose one or more .pptx files"
      accept=".pptx,application/vnd.openxmlformats-officedocument.presentationml.presentation"
      allowedMimeTypes={POWERPOINT_MIME_TYPES}
      startLabel="Convert Batch to PDF"
      runningLabel="Converting..."
      downloadLabel="Download PDF file"
      helperText="Each presentation is handled as its own task, with separate progress and retry visibility."
      conversionGuide={powerpointToPdfGuide}
      deriveOutputName={deriveOutputName}
      queueTask={(fileId, outputName) => queuePowerpointToPdf(fileId, outputName)}
    />
  );
}
