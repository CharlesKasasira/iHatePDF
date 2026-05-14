"use client";

import { BatchOperationPage } from "../components/batch-operation-page";
import { queueUnlock } from "../lib/pdf-api";

function deriveOutputName(file: File): string {
  const baseName = file.name.replace(/\.pdf$/i, "");
  return `${baseName}-unlocked.pdf`;
}

export default function UnlockPage(): React.JSX.Element {
  return (
    <BatchOperationPage
      active="unlock"
      title="Unlock PDF files"
      description="Remove password protection from multiple PDFs in one run when you know the current password."
      selectLabel="Select PDF files"
      emptyHint="Choose one or more PDF files"
      accept="application/pdf"
      allowedMimeTypes={["application/pdf"]}
      startLabel="Unlock Batch"
      runningLabel="Unlocking..."
      downloadLabel="Download unlocked PDF"
      helperText="Use one current password for the current batch. Each file reports its own progress."
      deriveOutputName={deriveOutputName}
      extraInput={{
        id: "unlock-password",
        label: "Current password",
        placeholder: "Enter current password",
        type: "password",
        validate: (value) => (!value ? "Enter the current PDF password." : null)
      }}
      queueTask={(fileId, outputName, password) => queueUnlock(fileId, password, outputName)}
    />
  );
}
