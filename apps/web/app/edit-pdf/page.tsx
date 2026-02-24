"use client";

import { useRef, useState } from "react";
import { SiteHeader } from "../components/site-header";
import {
  type EditImageInput,
  type EditRectangleInput,
  type EditTextInput,
  pollTask,
  queueEditPdf,
  uploadPdf
} from "../lib/pdf-api";

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Failed to read image file."));
    reader.onload = () => resolve(String(reader.result));
    reader.readAsDataURL(file);
  });
}

export default function EditPdfPage(): React.JSX.Element {
  const inputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);

  const [file, setFile] = useState<File | null>(null);
  const [outputName, setOutputName] = useState("edited.pdf");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [downloadUrl, setDownloadUrl] = useState("");

  const [enableText, setEnableText] = useState(true);
  const [text, setText] = useState("Approved");
  const [textPage, setTextPage] = useState(1);
  const [textX, setTextX] = useState(72);
  const [textY, setTextY] = useState(72);
  const [fontSize, setFontSize] = useState(16);
  const [textColor, setTextColor] = useState("#d32f2f");

  const [enableRectangle, setEnableRectangle] = useState(false);
  const [rectPage, setRectPage] = useState(1);
  const [rectX, setRectX] = useState(60);
  const [rectY, setRectY] = useState(60);
  const [rectWidth, setRectWidth] = useState(200);
  const [rectHeight, setRectHeight] = useState(40);
  const [rectColor, setRectColor] = useState("#fdd835");
  const [rectOpacity, setRectOpacity] = useState(0.25);

  const [enableImage, setEnableImage] = useState(false);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePage, setImagePage] = useState(1);
  const [imageX, setImageX] = useState(72);
  const [imageY, setImageY] = useState(120);
  const [imageWidth, setImageWidth] = useState(160);
  const [imageHeight, setImageHeight] = useState(80);

  const onEdit = async (): Promise<void> => {
    if (!file) {
      setStatus("Select a PDF file first.");
      return;
    }

    if (!outputName.trim()) {
      setStatus("Set an output filename.");
      return;
    }

    const textEdits: EditTextInput[] = [];
    const rectangleEdits: EditRectangleInput[] = [];
    const imageEdits: EditImageInput[] = [];

    if (enableText) {
      const trimmedText = text.trim();
      if (!trimmedText) {
        setStatus("Enter text for the text edit.");
        return;
      }

      textEdits.push({
        page: textPage,
        x: textX,
        y: textY,
        text: trimmedText,
        fontSize,
        color: textColor
      });
    }

    if (enableRectangle) {
      rectangleEdits.push({
        page: rectPage,
        x: rectX,
        y: rectY,
        width: rectWidth,
        height: rectHeight,
        color: rectColor,
        opacity: rectOpacity
      });
    }

    if (enableImage) {
      if (!imageFile) {
        setStatus("Choose an image to place in the PDF.");
        return;
      }

      const imageDataUrl = await fileToDataUrl(imageFile);
      imageEdits.push({
        page: imagePage,
        x: imageX,
        y: imageY,
        width: imageWidth,
        height: imageHeight,
        dataUrl: imageDataUrl
      });
    }

    if (textEdits.length + rectangleEdits.length + imageEdits.length === 0) {
      setStatus("Enable at least one edit operation.");
      return;
    }

    try {
      setBusy(true);
      setDownloadUrl("");
      setStatus("Uploading file...");
      const uploaded = await uploadPdf(file);

      setStatus("Queueing PDF edits...");
      const { taskId } = await queueEditPdf(uploaded.fileId, outputName.trim(), {
        textEdits,
        rectangleEdits,
        imageEdits
      });

      setStatus("Applying edits...");
      const done = await pollTask(taskId);

      if (done.status === "completed" && done.outputDownloadUrl) {
        setStatus("PDF edits completed.");
        setDownloadUrl(done.outputDownloadUrl);
      } else {
        setStatus(`Edit failed: ${done.errorMessage ?? "unknown error"}`);
      }
    } catch (error) {
      setStatus(`Edit failed: ${(error as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="site-shell">
      <SiteHeader active="edit" />

      <main className="feature-page">
        <section className="feature-hero">
          <h1>Edit PDF</h1>
          <p>Add text, shapes, and images directly onto your PDF.</p>

          <div className="upload-center compact">
            <button
              type="button"
              className="select-files-btn"
              onClick={() => inputRef.current?.click()}
              disabled={busy}
            >
              Select PDF file
            </button>
            <input
              ref={inputRef}
              type="file"
              hidden
              accept="application/pdf"
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            />
          </div>

          <p className="drop-hint">{file ? `Selected: ${file.name}` : "Choose one PDF file"}</p>
        </section>

        <section className="merge-workbench">
          <h2>Edit options</h2>

          <label htmlFor="edit-output">Output filename</label>
          <input
            id="edit-output"
            value={outputName}
            onChange={(event) => setOutputName(event.target.value)}
            placeholder="edited.pdf"
          />

          <label className="toggle-line">
            <input
              type="checkbox"
              checked={enableText}
              onChange={(event) => setEnableText(event.target.checked)}
            />
            Add text
          </label>
          {enableText ? (
            <div className="grid two">
              <input value={text} onChange={(event) => setText(event.target.value)} placeholder="Text" />
              <input
                type="number"
                value={textPage}
                min={1}
                onChange={(event) => setTextPage(Number(event.target.value))}
                placeholder="Page"
              />
              <input type="number" value={textX} min={0} onChange={(event) => setTextX(Number(event.target.value))} placeholder="X" />
              <input type="number" value={textY} min={0} onChange={(event) => setTextY(Number(event.target.value))} placeholder="Y" />
              <input
                type="number"
                value={fontSize}
                min={4}
                onChange={(event) => setFontSize(Number(event.target.value))}
                placeholder="Font size"
              />
              <input value={textColor} onChange={(event) => setTextColor(event.target.value)} placeholder="#d32f2f" />
            </div>
          ) : null}

          <label className="toggle-line">
            <input
              type="checkbox"
              checked={enableRectangle}
              onChange={(event) => setEnableRectangle(event.target.checked)}
            />
            Add rectangle
          </label>
          {enableRectangle ? (
            <div className="grid two">
              <input
                type="number"
                value={rectPage}
                min={1}
                onChange={(event) => setRectPage(Number(event.target.value))}
                placeholder="Page"
              />
              <input type="number" value={rectX} min={0} onChange={(event) => setRectX(Number(event.target.value))} placeholder="X" />
              <input type="number" value={rectY} min={0} onChange={(event) => setRectY(Number(event.target.value))} placeholder="Y" />
              <input
                type="number"
                value={rectWidth}
                min={1}
                onChange={(event) => setRectWidth(Number(event.target.value))}
                placeholder="Width"
              />
              <input
                type="number"
                value={rectHeight}
                min={1}
                onChange={(event) => setRectHeight(Number(event.target.value))}
                placeholder="Height"
              />
              <input
                value={rectColor}
                onChange={(event) => setRectColor(event.target.value)}
                placeholder="#fdd835"
              />
              <input
                type="number"
                value={rectOpacity}
                min={0}
                max={1}
                step={0.05}
                onChange={(event) => setRectOpacity(Number(event.target.value))}
                placeholder="Opacity"
              />
            </div>
          ) : null}

          <label className="toggle-line">
            <input
              type="checkbox"
              checked={enableImage}
              onChange={(event) => setEnableImage(event.target.checked)}
            />
            Add image
          </label>
          {enableImage ? (
            <div className="grid two">
              <button
                type="button"
                onClick={() => imageInputRef.current?.click()}
                className="row-actions-button"
                disabled={busy}
              >
                {imageFile ? `Image: ${imageFile.name}` : "Choose image"}
              </button>
              <input
                ref={imageInputRef}
                type="file"
                hidden
                accept="image/png,image/jpeg"
                onChange={(event) => setImageFile(event.target.files?.[0] ?? null)}
              />
              <input
                type="number"
                value={imagePage}
                min={1}
                onChange={(event) => setImagePage(Number(event.target.value))}
                placeholder="Page"
              />
              <input type="number" value={imageX} min={0} onChange={(event) => setImageX(Number(event.target.value))} placeholder="X" />
              <input type="number" value={imageY} min={0} onChange={(event) => setImageY(Number(event.target.value))} placeholder="Y" />
              <input
                type="number"
                value={imageWidth}
                min={1}
                onChange={(event) => setImageWidth(Number(event.target.value))}
                placeholder="Width"
              />
              <input
                type="number"
                value={imageHeight}
                min={1}
                onChange={(event) => setImageHeight(Number(event.target.value))}
                placeholder="Height"
              />
            </div>
          ) : null}

          <button type="button" className="start-process-btn" disabled={busy} onClick={onEdit}>
            {busy ? "Editing..." : "Apply PDF edits"}
          </button>

          <p className={status.toLowerCase().includes("failed") ? "error" : "small"}>{status}</p>
          {downloadUrl ? (
            <a className="download" href={downloadUrl} target="_blank" rel="noreferrer">
              Download edited PDF
            </a>
          ) : null}
        </section>
      </main>
    </div>
  );
}
