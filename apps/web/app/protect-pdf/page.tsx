"use client";

import { BatchOperationPage } from "../components/batch-operation-page";
import { queueProtect } from "../lib/pdf-api";

function deriveOutputName(file: File): string {
  const baseName = file.name.replace(/\.pdf$/i, "");
  return `${baseName}-protected.pdf`;
}

export default function ProtectPage(): React.JSX.Element {
  return (
    <BatchOperationPage
      active="protect"
      title="Protect PDF files"
      description="Encrypt one or many PDFs with the same password and watch each file move through the queue."
      selectLabel="Select PDF files"
      emptyHint="Choose one or more PDF files"
      accept="application/pdf"
      allowedMimeTypes={["application/pdf"]}
      startLabel="Protect Batch"
      runningLabel="Protecting..."
      downloadLabel="Download protected PDF"
      helperText="Use one password for the current batch. Each file is encrypted as its own task."
      deriveOutputName={deriveOutputName}
      extraInput={{
        id: "protect-password",
        label: "Password",
        placeholder: "Enter password",
        type: "password",
        validate: (value) =>
          value.length < 4 ? "Set a password with at least 4 characters." : null
      }}
      queueTask={(fileId, outputName, password) => queueProtect(fileId, password, outputName)}
    />
  );
}
