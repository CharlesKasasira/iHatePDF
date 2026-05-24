"use client";

import { BatchOperationPage } from "../components/batch-operation-page";
import { pdfToPowerPointGuide } from "../components/conversion-guides";
import { queuePdfToPowerpoint } from "../lib/pdf-api";

function deriveOutputName(file: File): string {
  const baseName = file.name.replace(/\.pdf$/i, "");
  return `${baseName}.pptx`;
}

export default function PdfToPowerpointPage(): React.JSX.Element {
  return (
    <BatchOperationPage
      active="pdf-to-powerpoint"
      title="PDF to PowerPoint"
      description="Turn multiple PDFs into editable PPTX decks with per-file task progress."
      selectLabel="Select PDF files"
      emptyHint="Choose one or more PDF files"
      accept="application/pdf"
      allowedMimeTypes={["application/pdf"]}
      startLabel="Convert Batch to PowerPoint"
      runningLabel="Converting..."
      downloadLabel="Download PowerPoint file"
      helperText="Large PDFs stay visible while the worker renders pages and builds the slide deck."
      conversionGuide={pdfToPowerPointGuide}
      deriveOutputName={deriveOutputName}
      queueTask={(fileId, outputName) => queuePdfToPowerpoint(fileId, outputName)}
    />
  );
}
