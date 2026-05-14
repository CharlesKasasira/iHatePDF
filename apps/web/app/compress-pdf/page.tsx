"use client";

import { BatchOperationPage } from "../components/batch-operation-page";
import { queueCompress } from "../lib/pdf-api";

function deriveOutputName(file: File): string {
  const baseName = file.name.replace(/\.pdf$/i, "");
  return `${baseName}-compressed.pdf`;
}

export default function CompressPage(): React.JSX.Element {
  return (
    <BatchOperationPage
      active="compress"
      title="Compress PDF files"
      description="Reduce file size while keeping a clear, live view of what each file is doing."
      selectLabel="Select PDF files"
      emptyHint="Choose one or more PDF files"
      accept="application/pdf"
      allowedMimeTypes={["application/pdf"]}
      startLabel="Compress Batch"
      runningLabel="Compressing..."
      downloadLabel="Download compressed PDF"
      helperText="Queue multiple PDFs at once. Each file gets its own live percentage and download link."
      deriveOutputName={deriveOutputName}
      queueTask={(fileId, outputName) => queueCompress(fileId, outputName)}
    />
  );
}
