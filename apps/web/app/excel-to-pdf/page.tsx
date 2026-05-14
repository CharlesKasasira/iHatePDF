"use client";

import { BatchOperationPage } from "../components/batch-operation-page";
import { queueExcelToPdf } from "../lib/pdf-api";

const EXCEL_MIME_TYPES = ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"] as const;

function deriveOutputName(file: File): string {
  const baseName = file.name.replace(/\.xlsx$/i, "");
  return `${baseName}.pdf`;
}

export default function ExcelToPdfPage(): React.JSX.Element {
  return (
    <BatchOperationPage
      active="excel-to-pdf"
      title="Excel to PDF"
      description="Convert multiple spreadsheets to PDF in one queue with live per-file progress."
      selectLabel="Select Excel files"
      emptyHint="Choose one or more .xlsx files"
      accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      allowedMimeTypes={EXCEL_MIME_TYPES}
      startLabel="Convert Batch to PDF"
      runningLabel="Converting..."
      downloadLabel="Download PDF file"
      helperText="Spreadsheet conversions run in a controlled batch so you can monitor every file separately."
      deriveOutputName={deriveOutputName}
      queueTask={(fileId, outputName) => queueExcelToPdf(fileId, outputName)}
    />
  );
}
