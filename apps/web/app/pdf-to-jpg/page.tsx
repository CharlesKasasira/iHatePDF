"use client";

import { BatchOperationPage } from "../components/batch-operation-page";
import { pdfToJpgGuide } from "../components/conversion-guides";
import { queuePdfToJpg } from "../lib/pdf-api";

function deriveOutputName(file: File): string {
  const baseName = file.name.replace(/\.pdf$/i, "");
  return `${baseName}.jpg`;
}

export default function PdfToJpgPage(): React.JSX.Element {
  return (
    <BatchOperationPage
      active="pdf-to-jpg"
      title="PDF to JPG"
      description="Convert PDFs into JPG images with one task per file and live worker progress."
      selectLabel="Select PDF files"
      emptyHint="Choose one or more PDF files"
      accept="application/pdf"
      allowedMimeTypes={["application/pdf"]}
      startLabel="Convert Batch to JPG"
      runningLabel="Converting..."
      downloadLabel="Download JPG or ZIP"
      helperText="Single-page PDFs download as one JPG. Multi-page PDFs download as a ZIP of page images."
      conversionGuide={pdfToJpgGuide}
      deriveOutputName={deriveOutputName}
      queueTask={(fileId, outputName) => queuePdfToJpg(fileId, outputName)}
    />
  );
}
