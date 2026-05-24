"use client";

import { BatchOperationPage } from "../components/batch-operation-page";
import { pdfToWordGuide } from "../components/conversion-guides";
import { queuePdfToWord } from "../lib/pdf-api";

function deriveOutputName(file: File): string {
  const baseName = file.name.replace(/\.pdf$/i, "");
  return `${baseName}.docx`;
}

export default function PdfToWordPage(): React.JSX.Element {
  return (
    <BatchOperationPage
      active="pdf-to-word"
      title="PDF to Word"
      description="Convert several PDFs into editable DOCX files and follow each conversion live."
      selectLabel="Select PDF files"
      emptyHint="Choose one or more PDF files"
      accept="application/pdf"
      allowedMimeTypes={["application/pdf"]}
      startLabel="Convert Batch to Word"
      runningLabel="Converting..."
      downloadLabel="Download Word file"
      helperText="Each PDF becomes its own DOCX output so the batch can complete even if one file fails."
      conversionGuide={pdfToWordGuide}
      deriveOutputName={deriveOutputName}
      queueTask={(fileId, outputName) => queuePdfToWord(fileId, outputName)}
    />
  );
}
