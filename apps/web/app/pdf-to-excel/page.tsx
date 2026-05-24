"use client";

import { BatchOperationPage } from "../components/batch-operation-page";
import { pdfToExcelGuide } from "../components/conversion-guides";
import { queuePdfToExcel } from "../lib/pdf-api";

function deriveOutputName(file: File): string {
  const baseName = file.name.replace(/\.pdf$/i, "");
  return `${baseName}.xlsx`;
}

export default function PdfToExcelPage(): React.JSX.Element {
  return (
    <BatchOperationPage
      active="pdf-to-excel"
      title="PDF to Excel"
      description="Batch-convert PDFs into XLSX workbooks and keep a precise eye on each file."
      selectLabel="Select PDF files"
      emptyHint="Choose one or more PDF files"
      accept="application/pdf"
      allowedMimeTypes={["application/pdf"]}
      startLabel="Convert Batch to Excel"
      runningLabel="Converting..."
      downloadLabel="Download Excel file"
      helperText="Each spreadsheet is produced independently, so one bad file does not block the whole batch."
      conversionGuide={pdfToExcelGuide}
      deriveOutputName={deriveOutputName}
      queueTask={(fileId, outputName) => queuePdfToExcel(fileId, outputName)}
    />
  );
}
