"use client";

import { useRef, useState } from "react";
import { UtilityIcons } from "./tool-icon";

export function UploadDropzone({
  label,
  hint,
  accept,
  multiple = false,
  disabled = false,
  compact = false,
  onFiles
}: {
  label: string;
  hint: string;
  accept: string;
  multiple?: boolean;
  disabled?: boolean;
  compact?: boolean;
  onFiles: (files: FileList | null) => void;
}): React.JSX.Element {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDropActive, setIsDropActive] = useState(false);
  const UploadIcon = UtilityIcons.UploadCloud;

  return (
    <div
      className={`upload-dropzone ${compact ? "is-compact" : ""} ${isDropActive ? "is-drop-active" : ""}`}
      onDragOver={(event) => {
        event.preventDefault();
        if (!disabled) {
          setIsDropActive(true);
        }
      }}
      onDragLeave={() => setIsDropActive(false)}
      onDrop={(event) => {
        event.preventDefault();
        setIsDropActive(false);
        if (!disabled) {
          onFiles(event.dataTransfer.files);
        }
      }}
    >
      <button
        type="button"
        className="select-files-btn upload-dropzone__button"
        onClick={() => inputRef.current?.click()}
        disabled={disabled}
      >
        <UploadIcon aria-hidden="true" size={22} />
        <span>{label}</span>
      </button>
      <span className="upload-dropzone__hint">{hint}</span>
      <input
        ref={inputRef}
        type="file"
        hidden
        multiple={multiple}
        accept={accept}
        onChange={(event) => {
          onFiles(event.target.files);
          event.target.value = "";
        }}
      />
    </div>
  );
}
