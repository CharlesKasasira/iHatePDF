"use client";

import { type ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  createSignatureRequest,
  type EditImageInput,
  type EditPageNumbersInput,
  type EditPageRotationInput,
  type EditRectangleInput,
  type EditTextInput,
  type EditWatermarkInput,
  getPdfMetadata,
  getPdfPagePreviewUrl,
  pollTask,
  queueEditPdf,
  uploadPdfWithRetention
} from "../lib/pdf-api";
import { SiteHeader } from "./site-header";

type EditorTool = "select" | "text" | "highlight" | "shape" | "sign" | "image";
type FontFamily = EditTextInput["fontFamily"];
type SignatureFlowStep = "closed" | "choose" | "request";

type StudioPageMeta = {
  pageNumber: number;
  width: number;
  height: number;
};

type StudioTextLayer = EditTextInput & {
  id: string;
  kind: "text";
};

type StudioRectangleLayer = EditRectangleInput & {
  id: string;
  kind: "rectangle";
  variant: "highlight" | "shape";
};

type StudioImageLayer = EditImageInput & {
  id: string;
  kind: "image";
  variant: "sign" | "image";
  fileName: string;
};

type StudioLayer = StudioTextLayer | StudioRectangleLayer | StudioImageLayer;

type AssetState = {
  dataUrl: string;
  fileName: string;
} | null;

const TOOL_ITEMS: Array<{ id: EditorTool; label: string; hint: string }> = [
  { id: "select", label: "Select", hint: "Inspect and refine layers" },
  { id: "text", label: "Text", hint: "Place styled type onto the page" },
  { id: "highlight", label: "Highlight", hint: "Lay down translucent emphasis bars" },
  { id: "shape", label: "Shapes", hint: "Frame sections with clean blocks" },
  { id: "sign", label: "Sign", hint: "Stamp a handwritten signature image" },
  { id: "image", label: "Image", hint: "Insert logos, seals, or graphics" }
];

const RETENTION_OPTIONS = [
  { value: 1, label: "1 hour" },
  { value: 24, label: "24 hours" },
  { value: 72, label: "3 days" },
  { value: 168, label: "7 days" },
  { value: 720, label: "30 days" }
] as const;

const PAGE_NUMBER_POSITIONS: Array<{
  value: EditPageNumbersInput["position"];
  label: string;
}> = [
  { value: "top-left", label: "Top left" },
  { value: "top-center", label: "Top center" },
  { value: "top-right", label: "Top right" },
  { value: "bottom-left", label: "Bottom left" },
  { value: "bottom-center", label: "Bottom center" },
  { value: "bottom-right", label: "Bottom right" }
];

function nextLayerId(): string {
  return `layer-${crypto.randomUUID()}`;
}

function buildEditedName(fileName: string): string {
  const stripped = fileName.toLowerCase().endsWith(".pdf") ? fileName.slice(0, -4) : fileName;
  return `${stripped || "document"}-studio.pdf`;
}

function buildSignedName(fileName: string): string {
  const stripped = fileName.toLowerCase().endsWith(".pdf") ? fileName.slice(0, -4) : fileName;
  return `${stripped || "document"}-signed.pdf`;
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Failed to read asset."));
    reader.onload = () => resolve(String(reader.result));
    reader.readAsDataURL(file);
  });
}

function fontFamilyLabel(fontFamily: FontFamily): string {
  if (fontFamily === "serif") {
    return "Editorial Serif";
  }
  if (fontFamily === "mono") {
    return "Mono";
  }
  return "Studio Sans";
}

function cssFontFamily(fontFamily: FontFamily): string {
  if (fontFamily === "serif") {
    return "\"Iowan Old Style\", \"Palatino Linotype\", serif";
  }
  if (fontFamily === "mono") {
    return "\"IBM Plex Mono\", \"SFMono-Regular\", monospace";
  }
  return "\"Avenir Next\", \"Nunito Sans\", sans-serif";
}

function layerSummary(layer: StudioLayer): string {
  if (layer.kind === "text") {
    return layer.text;
  }
  if (layer.kind === "rectangle") {
    return layer.variant === "highlight" ? "Highlight band" : "Shape block";
  }
  return layer.variant === "sign" ? "Signature" : layer.fileName;
}

function retentionLabel(retentionHours: number): string {
  return RETENTION_OPTIONS.find((option) => option.value === retentionHours)?.label ?? `${retentionHours}h`;
}

function normalizeNumber(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

function previewPageNumber(pageNumber: number, config: EditPageNumbersInput): string {
  return `${config.prefix ?? ""}${config.startAt + pageNumber - 1}`;
}

export function PdfEditorStudio({
  mode = "edit"
}: {
  mode?: "edit" | "sign";
} = {}): React.JSX.Element {
  const pdfInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const signatureInputRef = useRef<HTMLInputElement>(null);
  const previewLoadIdRef = useRef(0);

  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [sourceFileId, setSourceFileId] = useState<string | null>(null);
  const [sourceRetentionHours, setSourceRetentionHours] = useState<number | null>(null);
  const [pages, setPages] = useState<StudioPageMeta[]>([
    {
      pageNumber: 1,
      width: 612,
      height: 792
    }
  ]);
  const [isLoadingPreview, setIsLoadingPreview] = useState(false);

  const [tool, setTool] = useState<EditorTool>("select");
  const [layers, setLayers] = useState<StudioLayer[]>([]);
  const [selectedLayerId, setSelectedLayerId] = useState<string | null>(null);

  const [status, setStatus] = useState(
    "Upload a PDF to begin a controlled studio editing session."
  );
  const [busy, setBusy] = useState(false);
  const [downloadUrl, setDownloadUrl] = useState("");
  const [outputName, setOutputName] = useState("studio-export.pdf");
  const [retentionHours, setRetentionHours] = useState<number>(24);

  const [draftText, setDraftText] = useState("Approved");
  const [draftFontFamily, setDraftFontFamily] = useState<FontFamily>("sans");
  const [draftFontSize, setDraftFontSize] = useState(20);
  const [draftColor, setDraftColor] = useState("#19334d");
  const [draftBold, setDraftBold] = useState(true);
  const [draftItalic, setDraftItalic] = useState(false);
  const [draftUnderline, setDraftUnderline] = useState(false);

  const [draftBoxWidth, setDraftBoxWidth] = useState(220);
  const [draftBoxHeight, setDraftBoxHeight] = useState(54);
  const [draftBoxColor, setDraftBoxColor] = useState("#ffd166");
  const [draftBoxOpacity, setDraftBoxOpacity] = useState(0.22);

  const [draftImageWidth, setDraftImageWidth] = useState(180);
  const [draftImageHeight, setDraftImageHeight] = useState(88);
  const [draftSignatureWidth, setDraftSignatureWidth] = useState(190);
  const [draftSignatureHeight, setDraftSignatureHeight] = useState(72);

  const [imageAsset, setImageAsset] = useState<AssetState>(null);
  const [signatureAsset, setSignatureAsset] = useState<AssetState>(null);
  const [pageRotations, setPageRotations] = useState<EditPageRotationInput[]>([]);
  const [rotationPage, setRotationPage] = useState(1);
  const [rotationDegrees, setRotationDegrees] = useState<EditPageRotationInput["degrees"]>(90);
  const [pageNumbersEnabled, setPageNumbersEnabled] = useState(false);
  const [pageNumberStartAt, setPageNumberStartAt] = useState(1);
  const [pageNumberFontSize, setPageNumberFontSize] = useState(12);
  const [pageNumberColor, setPageNumberColor] = useState("#19334d");
  const [pageNumberPosition, setPageNumberPosition] =
    useState<EditPageNumbersInput["position"]>("bottom-center");
  const [pageNumberMargin, setPageNumberMargin] = useState(24);
  const [pageNumberPrefix, setPageNumberPrefix] = useState("");
  const [watermarkEnabled, setWatermarkEnabled] = useState(false);
  const [watermarkText, setWatermarkText] = useState("Confidential");
  const [watermarkFontSize, setWatermarkFontSize] = useState(64);
  const [watermarkColor, setWatermarkColor] = useState("#19334d");
  const [watermarkOpacity, setWatermarkOpacity] = useState(0.14);
  const [watermarkRotation, setWatermarkRotation] = useState(-32);
  const [requesterEmail, setRequesterEmail] = useState("");
  const [signerName, setSignerName] = useState("");
  const [signerEmail, setSignerEmail] = useState("");
  const [signerRole, setSignerRole] = useState("Signer");
  const [signatureRequestMessage, setSignatureRequestMessage] = useState("");
  const [signatureRequestOutputName, setSignatureRequestOutputName] = useState("signed-request.pdf");
  const [signatureRequestStatus, setSignatureRequestStatus] = useState("");
  const [signatureRequestLink, setSignatureRequestLink] = useState("");
  const [signatureFlowStep, setSignatureFlowStep] = useState<SignatureFlowStep>("closed");

  const selectedLayer = useMemo(
    () => layers.find((layer) => layer.id === selectedLayerId) ?? null,
    [layers, selectedLayerId]
  );

  const selectedSignatureBox = useMemo(
    () => (selectedLayer?.kind === "rectangle" ? selectedLayer : null),
    [selectedLayer]
  );

  const pageRotationMap = useMemo(
    () => new Map(pageRotations.map((item) => [item.page, item.degrees])),
    [pageRotations]
  );

  const pageNumberConfig = useMemo<EditPageNumbersInput | null>(
    () =>
      pageNumbersEnabled
        ? {
            startAt: pageNumberStartAt,
            fontSize: pageNumberFontSize,
            color: pageNumberColor,
            position: pageNumberPosition,
            margin: pageNumberMargin,
            prefix: pageNumberPrefix.trim() || undefined
          }
        : null,
    [
      pageNumberColor,
      pageNumberFontSize,
      pageNumberMargin,
      pageNumberPosition,
      pageNumberPrefix,
      pageNumberStartAt,
      pageNumbersEnabled
    ]
  );

  const watermarkConfig = useMemo<EditWatermarkInput | null>(
    () =>
      watermarkEnabled
        ? {
            text: watermarkText.trim(),
            fontSize: watermarkFontSize,
            color: watermarkColor,
            opacity: watermarkOpacity,
            rotation: watermarkRotation
          }
        : null,
    [
      watermarkColor,
      watermarkEnabled,
      watermarkFontSize,
      watermarkOpacity,
      watermarkRotation,
      watermarkText
    ]
  );

  useEffect(() => {
    if (!pdfFile) {
      previewLoadIdRef.current += 1;
      setSourceFileId(null);
      setSourceRetentionHours(null);
      setPages([
        {
          pageNumber: 1,
          width: 612,
          height: 792
        }
      ]);
      setIsLoadingPreview(false);
      return;
    }

    const loadId = previewLoadIdRef.current + 1;
    previewLoadIdRef.current = loadId;
    setIsLoadingPreview(true);
    setSourceFileId(null);
    setPages([
      {
        pageNumber: 1,
        width: 612,
        height: 792
      }
    ]);
    setStatus(`Loading ${pdfFile.name} for preview...`);

    void (async () => {
      try {
        const uploaded = await uploadPdfWithRetention(pdfFile, retentionHours);
        const metadata = await getPdfMetadata(uploaded.fileId);

        if (previewLoadIdRef.current !== loadId) {
          return;
        }

        setSourceFileId(uploaded.fileId);
        setSourceRetentionHours(retentionHours);
        setPages(
          metadata.pages.length > 0
            ? metadata.pages
            : [
                {
                  pageNumber: 1,
                  width: 612,
                  height: 792
                }
              ]
        );
        setRotationPage((current) => Math.min(Math.max(1, current), Math.max(1, metadata.pageCount)));
        setStatus(`${pdfFile.name} loaded. ${metadata.pageCount} page${metadata.pageCount === 1 ? "" : "s"} ready for editing.`);
      } catch (error) {
        if (previewLoadIdRef.current !== loadId) {
          return;
        }

        setSourceFileId(null);
        setSourceRetentionHours(null);
        setPages([
          {
            pageNumber: 1,
            width: 612,
            height: 792
          }
        ]);
        setStatus(`PDF preview metadata failed: ${(error as Error).message}`);
      } finally {
        if (previewLoadIdRef.current === loadId) {
          setIsLoadingPreview(false);
        }
      }
    })();
  }, [pdfFile]);

  const applyLayerUpdate = (
    layerId: string,
    updater: (layer: StudioLayer) => StudioLayer
  ): void => {
    setLayers((current) => current.map((layer) => (layer.id === layerId ? updater(layer) : layer)));
  };

  const hasAnyEdits =
    layers.length > 0 || pageRotations.length > 0 || pageNumberConfig !== null || watermarkConfig !== null;

  const queuePageRotation = (): void => {
    setPageRotations((current) => {
      const next = current.filter((item) => item.page !== rotationPage);
      next.push({ page: rotationPage, degrees: rotationDegrees });
      return next.sort((left, right) => left.page - right.page);
    });
    setStatus(`Queued a ${rotationDegrees}° rotation for page ${rotationPage}.`);
  };

  const createLayerAt = async (pageNumber: number, x: number, y: number): Promise<void> => {
    if (tool === "select") {
      setSelectedLayerId(null);
      return;
    }

    if (tool === "text") {
      const text = draftText.trim();
      if (!text) {
        setStatus("Add some draft text before placing a text layer.");
        return;
      }

      const layer: StudioTextLayer = {
        id: nextLayerId(),
        kind: "text",
        page: pageNumber,
        x,
        y,
        text,
        fontSize: draftFontSize,
        fontFamily: draftFontFamily,
        bold: draftBold,
        italic: draftItalic,
        underline: draftUnderline,
        color: draftColor
      };

      setLayers((current) => [...current, layer]);
      setSelectedLayerId(layer.id);
      setStatus(`Placed a text layer on page ${pageNumber}.`);
      return;
    }

    if (tool === "highlight" || tool === "shape") {
      const layer: StudioRectangleLayer = {
        id: nextLayerId(),
        kind: "rectangle",
        variant: tool,
        page: pageNumber,
        x,
        y,
        width: draftBoxWidth,
        height: draftBoxHeight,
        color: tool === "highlight" ? "#ffe082" : draftBoxColor,
        opacity: tool === "highlight" ? 0.26 : draftBoxOpacity
      };

      setLayers((current) => [...current, layer]);
      setSelectedLayerId(layer.id);
      setStatus(`Placed a ${tool === "highlight" ? "highlight" : "shape"} layer on page ${pageNumber}.`);
      return;
    }

    const asset = tool === "sign" ? signatureAsset : imageAsset;
    if (!asset) {
      setStatus(
        tool === "sign"
          ? "Upload a signature image first, then click the page to place it."
          : "Upload an image asset first, then click the page to place it."
      );
      return;
    }

    const layer: StudioImageLayer = {
      id: nextLayerId(),
      kind: "image",
      variant: tool,
      page: pageNumber,
      x,
      y,
      width: tool === "sign" ? draftSignatureWidth : draftImageWidth,
      height: tool === "sign" ? draftSignatureHeight : draftImageHeight,
      dataUrl: asset.dataUrl,
      fileName: asset.fileName
    };

    setLayers((current) => [...current, layer]);
    setSelectedLayerId(layer.id);
    setStatus(`Placed ${tool === "sign" ? "a signature" : "an image"} on page ${pageNumber}.`);
  };

  const handleAssetSelect = async (
    event: ChangeEvent<HTMLInputElement>,
    kind: "image" | "sign"
  ): Promise<void> => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    try {
      const dataUrl = await fileToDataUrl(file);
      const asset = { dataUrl, fileName: file.name };
      if (kind === "image") {
        setImageAsset(asset);
        setTool("image");
        setStatus(`Image asset ${file.name} is ready. Click a page to place it.`);
      } else {
        setSignatureAsset(asset);
        setTool("sign");
        setStatus(`Signature asset ${file.name} is ready. Click a page to stamp it.`);
      }
    } catch (error) {
      setStatus((error as Error).message);
    } finally {
      event.target.value = "";
    }
  };

  const processDocument = async (): Promise<void> => {
    if (!pdfFile) {
      setStatus("Upload a PDF document first.");
      return;
    }

    if (!outputName.trim()) {
      setStatus("Name the edited PDF before exporting.");
      return;
    }

    if (!hasAnyEdits) {
      setStatus("Add at least one layer or document operation before exporting.");
      return;
    }

    if (watermarkConfig && !watermarkConfig.text) {
      setStatus("Enter watermark text before exporting.");
      return;
    }

    const textEdits: EditTextInput[] = [];
    const rectangleEdits: EditRectangleInput[] = [];
    const imageEdits: EditImageInput[] = [];

    for (const layer of layers) {
      if (layer.kind === "text") {
        textEdits.push({
          page: layer.page,
          x: layer.x,
          y: layer.y,
          text: layer.text,
          fontSize: layer.fontSize,
          fontFamily: layer.fontFamily,
          bold: layer.bold,
          italic: layer.italic,
          underline: layer.underline,
          color: layer.color
        });
        continue;
      }

      if (layer.kind === "rectangle") {
        rectangleEdits.push({
          page: layer.page,
          x: layer.x,
          y: layer.y,
          width: layer.width,
          height: layer.height,
          color: layer.color,
          opacity: layer.opacity
        });
        continue;
      }

      imageEdits.push({
        page: layer.page,
        x: layer.x,
        y: layer.y,
        width: layer.width,
        height: layer.height,
        dataUrl: layer.dataUrl
      });
    }

    try {
      setBusy(true);
      setDownloadUrl("");
      let uploadedFileId = sourceFileId;
      if (!uploadedFileId || sourceRetentionHours !== retentionHours) {
        setStatus("Uploading the source PDF to your self-hosted workspace...");
        uploadedFileId = (await uploadPdfWithRetention(pdfFile, retentionHours)).fileId;
        setSourceFileId(uploadedFileId);
        setSourceRetentionHours(retentionHours);
      }

      setStatus("Applying studio layers to the document...");
      const { taskId } = await queueEditPdf(uploadedFileId, outputName.trim(), {
        textEdits,
        rectangleEdits,
        imageEdits,
        pageRotations,
        pageNumbers: pageNumberConfig ?? undefined,
        watermark: watermarkConfig ?? undefined,
        retentionHours
      });

      const completed = await pollTask(taskId);
      if (completed.status === "completed" && completed.outputDownloadUrl) {
        setDownloadUrl(completed.outputDownloadUrl);
        setStatus(
          `Studio export completed. Download remains active for ${retentionLabel(retentionHours)}.`
        );
      } else {
        setStatus(`Studio export failed: ${completed.errorMessage ?? "unknown error"}`);
      }
    } catch (error) {
      setStatus(`Studio export failed: ${(error as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const sendSignatureRequest = async (): Promise<void> => {
    if (!pdfFile || !sourceFileId) {
      setSignatureRequestStatus("Open a PDF first.");
      return;
    }

    if (!requesterEmail.trim() || !signerEmail.trim()) {
      setSignatureRequestStatus("Enter both requester and signer email addresses.");
      return;
    }

    if (!selectedSignatureBox) {
      setSignatureRequestStatus("Select a rectangle layer to use as the signer box.");
      return;
    }

    if (!signatureRequestOutputName.trim()) {
      setSignatureRequestStatus("Name the signed output PDF.");
      return;
    }

    try {
      setBusy(true);
      setSignatureRequestLink("");
      setSignatureRequestStatus("Sending signature request...");

      const result = await createSignatureRequest({
        fileId: sourceFileId,
        requesterEmail: requesterEmail.trim(),
        signerName: signerName.trim() || undefined,
        signerEmail: signerEmail.trim(),
        signerRole: signerRole.trim() || undefined,
        page: selectedSignatureBox.page,
        x: selectedSignatureBox.x,
        y: selectedSignatureBox.y,
        width: selectedSignatureBox.width,
        height: selectedSignatureBox.height,
        outputName: signatureRequestOutputName.trim(),
        message: signatureRequestMessage.trim() || undefined
      });

      setSignatureRequestLink(result.signingUrl);
      setSignatureRequestStatus("Signature request sent.");
      setSignatureFlowStep("request");
    } catch (error) {
      setSignatureRequestStatus(`Signature request failed: ${(error as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const openSignatureChooser = (): void => {
    if (!pdfFile || !sourceFileId) {
      setSignatureRequestStatus("Open a PDF first.");
      return;
    }

    if (!selectedSignatureBox) {
      setSignatureRequestStatus("Select a rectangle layer to define the signer box first.");
      return;
    }

    setSignatureRequestStatus("");
    setSignatureRequestLink("");
    setSignatureFlowStep("choose");
  };

  return (
    <div className="site-shell">
      <SiteHeader active={mode === "sign" ? "sign-pdf" : "edit"} />

      <main className="studio-page">
        <section className="studio-shell">
          <div className="studio-topbar">
            <div className="studio-topbar__identity">
              <span className="studio-pill studio-pill--brand">
                {mode === "sign" ? "SIGN PDF" : "PDF Editor Studio"}
              </span>
              <h1>
                {mode === "sign"
                  ? "Sign PDFs yourself or send them for signature"
                  : "Precision PDF editing for self-hosted teams"}
              </h1>
              <p>
                {mode === "sign"
                  ? "Mark signature areas on the PDF, sign it yourself with an uploaded signature image, or create a secure signer request for someone else."
                  : "Layer text, highlights, signatures, and images directly on each PDF page, then rotate pages, add page numbers, and stamp watermarks without leaving the same export pipeline."}
              </p>
            </div>

            <div className="studio-topbar__actions">
              <button
                type="button"
                className="studio-primary-button"
                onClick={() => pdfInputRef.current?.click()}
                disabled={busy}
              >
                {pdfFile ? "Replace PDF" : "Open PDF"}
              </button>
              <input
                ref={pdfInputRef}
                type="file"
                hidden
                accept="application/pdf"
                onChange={(event) => {
                  const file = event.target.files?.[0] ?? null;
                  setPdfFile(file);
                  setLayers([]);
                  setPageRotations([]);
                  setRotationPage(1);
                  setSelectedLayerId(null);
                  setDownloadUrl("");
                  setSourceFileId(null);
                  setSourceRetentionHours(null);
                  setOutputName(file ? buildEditedName(file.name) : "studio-export.pdf");
                  setSignatureRequestOutputName(file ? buildSignedName(file.name) : "signed-request.pdf");
                  setSignatureRequestLink("");
                  setSignatureRequestStatus("");
                  setSignatureFlowStep("closed");
                  event.target.value = "";
                }}
              />

              <button
                type="button"
                className="studio-secondary-button"
                onClick={() => imageInputRef.current?.click()}
                disabled={busy}
              >
                Load image
              </button>
              <input
                ref={imageInputRef}
                type="file"
                hidden
                accept="image/png,image/jpeg"
                onChange={(event) => {
                  void handleAssetSelect(event, "image");
                }}
              />

              <button
                type="button"
                className="studio-secondary-button"
                onClick={() => signatureInputRef.current?.click()}
                disabled={busy}
              >
                Load signature
              </button>
              <input
                ref={signatureInputRef}
                type="file"
                hidden
                accept="image/png,image/jpeg"
                onChange={(event) => {
                  void handleAssetSelect(event, "sign");
                }}
              />
            </div>
          </div>

          <section className="studio-toolbar">
            <div className="studio-toolbar__group">
              {TOOL_ITEMS.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={`studio-tool ${tool === item.id ? "is-active" : ""}`}
                  onClick={() => setTool(item.id)}
                >
                  <strong>{item.label}</strong>
                  <span>{item.hint}</span>
                </button>
              ))}
            </div>

            <div className="studio-toolbar__group studio-toolbar__group--compact">
              <label className="studio-inline-control">
                <span>Typeface</span>
                <select
                  value={draftFontFamily}
                  onChange={(event) => setDraftFontFamily(event.target.value as FontFamily)}
                >
                  <option value="sans">Studio Sans</option>
                  <option value="serif">Editorial Serif</option>
                  <option value="mono">Mono</option>
                </select>
              </label>

              <label className="studio-inline-control studio-inline-control--short">
                <span>Size</span>
                <input
                  type="number"
                  min={8}
                  max={72}
                  value={draftFontSize}
                  onChange={(event) => setDraftFontSize(normalizeNumber(Number(event.target.value), 20))}
                />
              </label>

              <label className="studio-inline-control studio-inline-control--short">
                <span>Color</span>
                <input
                  type="color"
                  value={draftColor}
                  onChange={(event) => setDraftColor(event.target.value)}
                />
              </label>

              <label className="studio-toggle-chip">
                <input
                  type="checkbox"
                  checked={draftBold}
                  onChange={(event) => setDraftBold(event.target.checked)}
                />
                <span>B</span>
              </label>
              <label className="studio-toggle-chip">
                <input
                  type="checkbox"
                  checked={draftItalic}
                  onChange={(event) => setDraftItalic(event.target.checked)}
                />
                <span>I</span>
              </label>
              <label className="studio-toggle-chip">
                <input
                  type="checkbox"
                  checked={draftUnderline}
                  onChange={(event) => setDraftUnderline(event.target.checked)}
                />
                <span>U</span>
              </label>
            </div>
          </section>

          <section className="studio-workspace">
            <aside className="studio-sidebar">
              <div className="studio-panel">
                <div className="studio-panel__eyebrow">Document</div>
                <h2>{pdfFile?.name ?? "No PDF loaded"}</h2>
                <p>
                  {pdfFile
                    ? isLoadingPreview
                      ? "Inspecting the uploaded PDF and loading a live preview..."
                      : `${pages.length} page${pages.length === 1 ? "" : "s"} detected. Click directly on the PDF page to place the current tool.`
                    : "Open a PDF, then place layers or configure document-wide edits from the studio sidebar."}
                </p>

                <label htmlFor="studio-output">Export filename</label>
                <input
                  id="studio-output"
                  value={outputName}
                  onChange={(event) => setOutputName(event.target.value)}
                  placeholder="studio-export.pdf"
                />

                <div className="studio-stage-controls">
                  <span>Pages</span>
                  <strong>{isLoadingPreview ? "Loading..." : pages.length}</strong>
                </div>
              </div>

              <div className="studio-panel">
                <div className="studio-panel__eyebrow">Layers</div>
                <div className="studio-layer-list">
                  {layers.length === 0 ? (
                    <p className="studio-empty-copy">
                      No layers yet. Pick a tool, then click directly on the PDF page to drop it in.
                    </p>
                  ) : (
                    layers.map((layer, index) => (
                      <button
                        key={layer.id}
                        type="button"
                        className={`studio-layer-card ${selectedLayerId === layer.id ? "is-active" : ""}`}
                        onClick={() => setSelectedLayerId(layer.id)}
                      >
                        <span className="studio-layer-card__index">{index + 1}</span>
                        <span className="studio-layer-card__content">
                          <strong>{layer.kind === "text" ? "Text" : layer.kind === "rectangle" ? "Block" : "Asset"}</strong>
                          <small>{layerSummary(layer)}</small>
                        </span>
                        <span className="studio-layer-card__meta">P{layer.page}</span>
                      </button>
                    ))
                  )}
                </div>
              </div>

              <div className="studio-panel">
                <div className="studio-panel__eyebrow">Document operations</div>
                <div className="studio-form-grid">
                  <label>
                    Rotate page
                    <input
                      type="number"
                      min={1}
                      max={Math.max(1, pages.length)}
                      value={rotationPage}
                      onChange={(event) =>
                        setRotationPage(normalizeNumber(Number(event.target.value), rotationPage))
                      }
                    />
                  </label>
                  <label>
                    Degrees
                    <select
                      value={rotationDegrees}
                      onChange={(event) =>
                        setRotationDegrees(Number(event.target.value) as EditPageRotationInput["degrees"])
                      }
                    >
                      <option value={90}>90° clockwise</option>
                      <option value={180}>180°</option>
                      <option value={270}>270° clockwise</option>
                    </select>
                  </label>
                </div>
                <button
                  type="button"
                  className="studio-secondary-button studio-primary-button--full"
                  onClick={queuePageRotation}
                >
                  Add page rotation
                </button>

                {pageRotations.length > 0 ? (
                  <div className="studio-layer-list">
                    {pageRotations.map((rotation) => (
                      <button
                        key={`rotation-${rotation.page}`}
                        type="button"
                        className="studio-layer-card"
                        onClick={() => {
                          setRotationPage(rotation.page);
                          setRotationDegrees(rotation.degrees);
                        }}
                      >
                        <span className="studio-layer-card__index">R</span>
                        <span className="studio-layer-card__content">
                          <strong>Page {rotation.page}</strong>
                          <small>{rotation.degrees}° rotation</small>
                        </span>
                        <span
                          className="studio-layer-card__meta"
                          onClick={(event) => {
                            event.stopPropagation();
                            setPageRotations((current) =>
                              current.filter((item) => item.page !== rotation.page)
                            );
                          }}
                        >
                          Remove
                        </span>
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="studio-empty-copy">No page rotations queued.</p>
                )}

                <div className="studio-toggle-row">
                  <label className="studio-check">
                    <input
                      type="checkbox"
                      checked={pageNumbersEnabled}
                      onChange={(event) => setPageNumbersEnabled(event.target.checked)}
                    />
                    <span>Add page numbers</span>
                  </label>
                </div>

                {pageNumbersEnabled ? (
                  <div className="studio-form-grid">
                    <label>
                      Start at
                      <input
                        type="number"
                        min={1}
                        value={pageNumberStartAt}
                        onChange={(event) =>
                          setPageNumberStartAt(normalizeNumber(Number(event.target.value), 1))
                        }
                      />
                    </label>
                    <label>
                      Position
                      <select
                        value={pageNumberPosition}
                        onChange={(event) =>
                          setPageNumberPosition(event.target.value as EditPageNumbersInput["position"])
                        }
                      >
                        {PAGE_NUMBER_POSITIONS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Font size
                      <input
                        type="number"
                        min={6}
                        max={72}
                        value={pageNumberFontSize}
                        onChange={(event) =>
                          setPageNumberFontSize(normalizeNumber(Number(event.target.value), 12))
                        }
                      />
                    </label>
                    <label>
                      Margin
                      <input
                        type="number"
                        min={0}
                        max={144}
                        value={pageNumberMargin}
                        onChange={(event) =>
                          setPageNumberMargin(normalizeNumber(Number(event.target.value), 24))
                        }
                      />
                    </label>
                    <label>
                      Prefix
                      <input
                        value={pageNumberPrefix}
                        onChange={(event) => setPageNumberPrefix(event.target.value)}
                        placeholder="Page "
                      />
                    </label>
                    <label>
                      Color
                      <input
                        type="color"
                        value={pageNumberColor}
                        onChange={(event) => setPageNumberColor(event.target.value)}
                      />
                    </label>
                  </div>
                ) : null}

                <div className="studio-toggle-row">
                  <label className="studio-check">
                    <input
                      type="checkbox"
                      checked={watermarkEnabled}
                      onChange={(event) => setWatermarkEnabled(event.target.checked)}
                    />
                    <span>Add watermark</span>
                  </label>
                </div>

                {watermarkEnabled ? (
                  <div className="studio-form-grid">
                    <label>
                      Watermark text
                      <input
                        value={watermarkText}
                        onChange={(event) => setWatermarkText(event.target.value)}
                        placeholder="Confidential"
                      />
                    </label>
                    <label>
                      Font size
                      <input
                        type="number"
                        min={18}
                        max={240}
                        value={watermarkFontSize}
                        onChange={(event) =>
                          setWatermarkFontSize(normalizeNumber(Number(event.target.value), 64))
                        }
                      />
                    </label>
                    <label>
                      Rotation
                      <input
                        type="number"
                        min={-180}
                        max={180}
                        value={watermarkRotation}
                        onChange={(event) =>
                          setWatermarkRotation(normalizeNumber(Number(event.target.value), -32))
                        }
                      />
                    </label>
                    <label>
                      Opacity
                      <input
                        type="number"
                        min={0.05}
                        max={0.95}
                        step={0.05}
                        value={watermarkOpacity}
                        onChange={(event) =>
                          setWatermarkOpacity(normalizeNumber(Number(event.target.value), 0.14))
                        }
                      />
                    </label>
                    <label>
                      Color
                      <input
                        type="color"
                        value={watermarkColor}
                        onChange={(event) => setWatermarkColor(event.target.value)}
                      />
                    </label>
                  </div>
                ) : null}
              </div>

              <div className="studio-panel">
                <div className="studio-panel__eyebrow">
                  {selectedLayer ? "Selected layer" : "Tool defaults"}
                </div>

                {selectedLayer?.kind === "text" ? (
                  <div className="studio-form-grid">
                    <label>
                      Text
                      <textarea
                        value={selectedLayer.text}
                        onChange={(event) =>
                          applyLayerUpdate(selectedLayer.id, (layer) =>
                            layer.kind === "text" ? { ...layer, text: event.target.value } : layer
                          )
                        }
                      />
                    </label>
                    <label>
                      Page
                      <input
                        type="number"
                        min={1}
                        max={Math.max(1, pages.length)}
                        value={selectedLayer.page}
                        onChange={(event) =>
                          applyLayerUpdate(selectedLayer.id, (layer) =>
                            layer.kind === "text"
                              ? { ...layer, page: normalizeNumber(Number(event.target.value), layer.page) }
                              : layer
                          )
                        }
                      />
                    </label>
                    <label>
                      X
                      <input
                        type="number"
                        min={0}
                        value={selectedLayer.x}
                        onChange={(event) =>
                          applyLayerUpdate(selectedLayer.id, (layer) =>
                            layer.kind === "text"
                              ? { ...layer, x: normalizeNumber(Number(event.target.value), layer.x) }
                              : layer
                          )
                        }
                      />
                    </label>
                    <label>
                      Y
                      <input
                        type="number"
                        min={0}
                        value={selectedLayer.y}
                        onChange={(event) =>
                          applyLayerUpdate(selectedLayer.id, (layer) =>
                            layer.kind === "text"
                              ? { ...layer, y: normalizeNumber(Number(event.target.value), layer.y) }
                              : layer
                          )
                        }
                      />
                    </label>
                    <label>
                      Size
                      <input
                        type="number"
                        min={8}
                        max={72}
                        value={selectedLayer.fontSize}
                        onChange={(event) =>
                          applyLayerUpdate(selectedLayer.id, (layer) =>
                            layer.kind === "text"
                              ? { ...layer, fontSize: normalizeNumber(Number(event.target.value), layer.fontSize) }
                              : layer
                          )
                        }
                      />
                    </label>
                    <label>
                      Typeface
                      <select
                        value={selectedLayer.fontFamily}
                        onChange={(event) =>
                          applyLayerUpdate(selectedLayer.id, (layer) =>
                            layer.kind === "text"
                              ? { ...layer, fontFamily: event.target.value as FontFamily }
                              : layer
                          )
                        }
                      >
                        <option value="sans">Studio Sans</option>
                        <option value="serif">Editorial Serif</option>
                        <option value="mono">Mono</option>
                      </select>
                    </label>
                    <label>
                      Color
                      <input
                        type="color"
                        value={selectedLayer.color}
                        onChange={(event) =>
                          applyLayerUpdate(selectedLayer.id, (layer) =>
                            layer.kind === "text" ? { ...layer, color: event.target.value } : layer
                          )
                        }
                      />
                    </label>
                    <div className="studio-toggle-row">
                      <label className="studio-check">
                        <input
                          type="checkbox"
                          checked={selectedLayer.bold}
                          onChange={(event) =>
                            applyLayerUpdate(selectedLayer.id, (layer) =>
                              layer.kind === "text" ? { ...layer, bold: event.target.checked } : layer
                            )
                          }
                        />
                        <span>Bold</span>
                      </label>
                      <label className="studio-check">
                        <input
                          type="checkbox"
                          checked={selectedLayer.italic}
                          onChange={(event) =>
                            applyLayerUpdate(selectedLayer.id, (layer) =>
                              layer.kind === "text" ? { ...layer, italic: event.target.checked } : layer
                            )
                          }
                        />
                        <span>Italic</span>
                      </label>
                      <label className="studio-check">
                        <input
                          type="checkbox"
                          checked={selectedLayer.underline}
                          onChange={(event) =>
                            applyLayerUpdate(selectedLayer.id, (layer) =>
                              layer.kind === "text" ? { ...layer, underline: event.target.checked } : layer
                            )
                          }
                        />
                        <span>Underline</span>
                      </label>
                    </div>
                  </div>
                ) : null}

                {selectedLayer?.kind === "rectangle" ? (
                  <div className="studio-form-grid">
                    <label>
                      Page
                      <input
                        type="number"
                        min={1}
                        max={Math.max(1, pages.length)}
                        value={selectedLayer.page}
                        onChange={(event) =>
                          applyLayerUpdate(selectedLayer.id, (layer) =>
                            layer.kind === "rectangle"
                              ? { ...layer, page: normalizeNumber(Number(event.target.value), layer.page) }
                              : layer
                          )
                        }
                      />
                    </label>
                    <label>
                      X
                      <input
                        type="number"
                        min={0}
                        value={selectedLayer.x}
                        onChange={(event) =>
                          applyLayerUpdate(selectedLayer.id, (layer) =>
                            layer.kind === "rectangle"
                              ? { ...layer, x: normalizeNumber(Number(event.target.value), layer.x) }
                              : layer
                          )
                        }
                      />
                    </label>
                    <label>
                      Y
                      <input
                        type="number"
                        min={0}
                        value={selectedLayer.y}
                        onChange={(event) =>
                          applyLayerUpdate(selectedLayer.id, (layer) =>
                            layer.kind === "rectangle"
                              ? { ...layer, y: normalizeNumber(Number(event.target.value), layer.y) }
                              : layer
                          )
                        }
                      />
                    </label>
                    <label>
                      Width
                      <input
                        type="number"
                        min={24}
                        value={selectedLayer.width}
                        onChange={(event) =>
                          applyLayerUpdate(selectedLayer.id, (layer) =>
                            layer.kind === "rectangle"
                              ? { ...layer, width: normalizeNumber(Number(event.target.value), layer.width) }
                              : layer
                          )
                        }
                      />
                    </label>
                    <label>
                      Height
                      <input
                        type="number"
                        min={18}
                        value={selectedLayer.height}
                        onChange={(event) =>
                          applyLayerUpdate(selectedLayer.id, (layer) =>
                            layer.kind === "rectangle"
                              ? { ...layer, height: normalizeNumber(Number(event.target.value), layer.height) }
                              : layer
                          )
                        }
                      />
                    </label>
                    <label>
                      Color
                      <input
                        type="color"
                        value={selectedLayer.color}
                        onChange={(event) =>
                          applyLayerUpdate(selectedLayer.id, (layer) =>
                            layer.kind === "rectangle" ? { ...layer, color: event.target.value } : layer
                          )
                        }
                      />
                    </label>
                    <label>
                      Opacity
                      <input
                        type="number"
                        min={0.05}
                        max={1}
                        step={0.05}
                        value={selectedLayer.opacity}
                        onChange={(event) =>
                          applyLayerUpdate(selectedLayer.id, (layer) =>
                            layer.kind === "rectangle"
                              ? { ...layer, opacity: normalizeNumber(Number(event.target.value), layer.opacity) }
                              : layer
                          )
                        }
                      />
                    </label>
                  </div>
                ) : null}

                {selectedLayer?.kind === "image" ? (
                  <div className="studio-form-grid">
                    <label>
                      Page
                      <input
                        type="number"
                        min={1}
                        max={Math.max(1, pages.length)}
                        value={selectedLayer.page}
                        onChange={(event) =>
                          applyLayerUpdate(selectedLayer.id, (layer) =>
                            layer.kind === "image"
                              ? { ...layer, page: normalizeNumber(Number(event.target.value), layer.page) }
                              : layer
                          )
                        }
                      />
                    </label>
                    <label>
                      X
                      <input
                        type="number"
                        min={0}
                        value={selectedLayer.x}
                        onChange={(event) =>
                          applyLayerUpdate(selectedLayer.id, (layer) =>
                            layer.kind === "image"
                              ? { ...layer, x: normalizeNumber(Number(event.target.value), layer.x) }
                              : layer
                          )
                        }
                      />
                    </label>
                    <label>
                      Y
                      <input
                        type="number"
                        min={0}
                        value={selectedLayer.y}
                        onChange={(event) =>
                          applyLayerUpdate(selectedLayer.id, (layer) =>
                            layer.kind === "image"
                              ? { ...layer, y: normalizeNumber(Number(event.target.value), layer.y) }
                              : layer
                          )
                        }
                      />
                    </label>
                    <label>
                      Width
                      <input
                        type="number"
                        min={24}
                        value={selectedLayer.width}
                        onChange={(event) =>
                          applyLayerUpdate(selectedLayer.id, (layer) =>
                            layer.kind === "image"
                              ? { ...layer, width: normalizeNumber(Number(event.target.value), layer.width) }
                              : layer
                          )
                        }
                      />
                    </label>
                    <label>
                      Height
                      <input
                        type="number"
                        min={24}
                        value={selectedLayer.height}
                        onChange={(event) =>
                          applyLayerUpdate(selectedLayer.id, (layer) =>
                            layer.kind === "image"
                              ? { ...layer, height: normalizeNumber(Number(event.target.value), layer.height) }
                              : layer
                          )
                        }
                      />
                    </label>
                  </div>
                ) : null}

                {!selectedLayer ? (
                  <div className="studio-defaults">
                    <p>
                      Current tool: <strong>{TOOL_ITEMS.find((item) => item.id === tool)?.label}</strong>
                    </p>
                    <p>
                      Text defaults use <strong>{fontFamilyLabel(draftFontFamily)}</strong> at{" "}
                      <strong>{draftFontSize}px</strong>.
                    </p>
                    <p>
                      Shape defaults place a <strong>{draftBoxWidth} x {draftBoxHeight}</strong> block
                      with <strong>{Math.round(draftBoxOpacity * 100)}%</strong> opacity.
                    </p>
                    <p>
                      Document edits: <strong>{pageRotations.length}</strong> rotations,{" "}
                      <strong>{pageNumberConfig ? "page numbers on" : "page numbers off"}</strong>,{" "}
                      <strong>{watermarkConfig ? "watermark on" : "watermark off"}</strong>.
                    </p>
                  </div>
                ) : (
                  <button
                    type="button"
                    className="studio-danger-button"
                    onClick={() => {
                      setLayers((current) => current.filter((layer) => layer.id !== selectedLayer.id));
                      setSelectedLayerId(null);
                    }}
                  >
                    Remove selected layer
                  </button>
                )}
              </div>

              <div className="studio-panel">
                <div className="studio-panel__eyebrow">Signature Flow</div>
                <h2>Prepare signing</h2>
                <p>
                  Select a rectangle layer as the signature box, then choose whether you will sign it
                  yourself or send a request to someone else.
                </p>

                <div className="studio-stage-controls">
                  <span>Selected box</span>
                  <strong>
                    {selectedSignatureBox
                      ? `P${selectedSignatureBox.page} · ${Math.round(selectedSignatureBox.width)} x ${Math.round(selectedSignatureBox.height)}`
                      : "None"}
                  </strong>
                </div>

                <button
                  type="button"
                  className="studio-primary-button studio-primary-button--full"
                  onClick={openSignatureChooser}
                  disabled={busy}
                >
                  Open signing flow
                </button>

                <p className={signatureRequestStatus.toLowerCase().includes("failed") ? "error" : "small"}>
                  {signatureRequestStatus || "Use a rectangle layer to mark the signer area."}
                </p>

                {signatureRequestLink ? (
                  <a className="download studio-download-link" href={signatureRequestLink} target="_blank" rel="noreferrer">
                    Open signer link
                  </a>
                ) : null}
              </div>

              <div className="studio-panel studio-panel--privacy">
                <div className="studio-panel__eyebrow">Privacy & retention</div>
                <h2>Retention window</h2>
                <p>
                  Files from this studio are processed on your self-hosted server and stored in{" "}
                  <code>./storage</code>. The selected window controls when download access expires.
                </p>

                <label htmlFor="retention-hours">Auto-expire downloads after</label>
                <select
                  id="retention-hours"
                  value={retentionHours}
                  onChange={(event) => setRetentionHours(Number(event.target.value))}
                >
                  {RETENTION_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>

                <div className="studio-privacy-note">
                  <strong>Trust note</strong>
                  <span>
                    This is not a browser-only editor. The file leaves the device, is written to your
                    server, and auto-expires from download after {retentionLabel(retentionHours)}.
                  </span>
                </div>
              </div>

              <div className="studio-panel">
                <div className="studio-panel__eyebrow">Export</div>
                <button
                  type="button"
                  className="studio-primary-button studio-primary-button--full"
                  onClick={() => void processDocument()}
                  disabled={busy}
                >
                  {busy ? "Rendering studio export..." : "Save PDF"}
                </button>
                <p className={status.toLowerCase().includes("failed") ? "error" : "small"}>{status}</p>
                {downloadUrl ? (
                  <a className="download studio-download-link" href={downloadUrl} target="_blank" rel="noreferrer">
                    Download edited PDF
                  </a>
                ) : null}
              </div>
            </aside>

            <section className="studio-canvas-area">
              {!pdfFile ? (
                <div className="studio-placeholder">
                  <strong>Drop in a PDF to open the studio.</strong>
                  <span>
                    Once loaded, every stage becomes a clean placement surface for text, highlights,
                    images, signatures, and document-level finishing passes.
                  </span>
                </div>
              ) : null}

              {pdfFile && pages.length > 0 ? (
                <div className="studio-page-stack">
                  {pages.map((page) => (
                    <StudioPdfPage
                      key={page.pageNumber}
                      fileName={pdfFile.name}
                      page={page}
                      previewUrl={sourceFileId ? getPdfPagePreviewUrl(sourceFileId, page.pageNumber) : null}
                      layers={layers.filter((layer) => layer.page === page.pageNumber)}
                      rotationDegrees={pageRotationMap.get(page.pageNumber) ?? 0}
                      pageNumbers={pageNumberConfig}
                      watermark={watermarkConfig}
                      selectedLayerId={selectedLayerId}
                      onSelectLayer={setSelectedLayerId}
                      onPlaceLayer={(x, y) => {
                        void createLayerAt(page.pageNumber, x, y);
                      }}
                    />
                  ))}
                </div>
              ) : null}
            </section>
          </section>

          {signatureFlowStep !== "closed" ? (
            <div className="studio-modal-backdrop" onClick={() => setSignatureFlowStep("closed")}>
              <div
                className="studio-modal"
                onClick={(event) => {
                  event.stopPropagation();
                }}
              >
                {signatureFlowStep === "choose" ? (
                  <>
                    <div className="studio-modal__header">
                      <div>
                        <span className="studio-panel__eyebrow">Sign PDF</span>
                        <h2>Who will sign this document?</h2>
                      </div>
                      <button
                        type="button"
                        className="studio-modal__close"
                        onClick={() => setSignatureFlowStep("closed")}
                      >
                        Close
                      </button>
                    </div>

                    <div className="studio-sign-choice-grid">
                      <button
                        type="button"
                        className="studio-sign-choice"
                        onClick={() => {
                          setSignatureFlowStep("closed");
                          setTool("sign");
                          setStatus("Load a signature image, then click the PDF page to place it yourself.");
                        }}
                      >
                        <strong>Only me</strong>
                        <span>Sign this document yourself with a local signature image.</span>
                      </button>

                      <button
                        type="button"
                        className="studio-sign-choice is-highlighted"
                        onClick={() => setSignatureFlowStep("request")}
                      >
                        <strong>Several people</strong>
                        <span>Invite another signer with a secure link for the selected box.</span>
                      </button>
                    </div>
                  </>
                ) : null}

                {signatureFlowStep === "request" ? (
                  <>
                    <div className="studio-modal__header">
                      <div>
                        <span className="studio-panel__eyebrow">Signature Request</span>
                        <h2>Create your signature request</h2>
                      </div>
                      <button
                        type="button"
                        className="studio-modal__close"
                        onClick={() => setSignatureFlowStep("closed")}
                      >
                        Close
                      </button>
                    </div>

                    <div className="studio-modal__body">
                      <section className="studio-modal__section">
                        <h3>Who will receive your document?</h3>
                        <div className="studio-request-recipient">
                          <input
                            value={signerName}
                            onChange={(event) => setSignerName(event.target.value)}
                            placeholder="Name"
                          />
                          <input
                            type="email"
                            value={signerEmail}
                            onChange={(event) => setSignerEmail(event.target.value)}
                            placeholder="Email"
                          />
                          <select
                            value={signerRole}
                            onChange={(event) => setSignerRole(event.target.value)}
                          >
                            <option value="Signer">Signer</option>
                            <option value="Approver">Approver</option>
                            <option value="Viewer">Viewer</option>
                          </select>
                        </div>
                      </section>

                      <section className="studio-modal__section">
                        <h3>Request details</h3>
                        <div className="studio-form-grid">
                          <label>
                            Your email
                            <input
                              type="email"
                              value={requesterEmail}
                              onChange={(event) => setRequesterEmail(event.target.value)}
                              placeholder="you@example.com"
                            />
                          </label>
                          <label>
                            Signed output name
                            <input
                              value={signatureRequestOutputName}
                              onChange={(event) => setSignatureRequestOutputName(event.target.value)}
                              placeholder="signed-request.pdf"
                            />
                          </label>
                          <label>
                            Signature box
                            <input
                              value={
                                selectedSignatureBox
                                  ? `Page ${selectedSignatureBox.page} · ${Math.round(selectedSignatureBox.width)} x ${Math.round(selectedSignatureBox.height)}`
                                  : "Select a rectangle layer"
                              }
                              readOnly
                            />
                          </label>
                          <label>
                            Message
                            <textarea
                              value={signatureRequestMessage}
                              onChange={(event) => setSignatureRequestMessage(event.target.value)}
                              placeholder="Please sign this document."
                            />
                          </label>
                        </div>
                      </section>

                      <section className="studio-modal__section">
                        <h3>Settings</h3>
                        <div className="studio-request-settings">
                          <div className="studio-request-setting">
                            <strong>Expiration</strong>
                            <span>Requests currently expire according to the server signing policy.</span>
                          </div>
                          <div className="studio-request-setting">
                            <strong>Email notifications</strong>
                            <span>The signer receives the secure link by email, and completion can be tracked from the returned document task.</span>
                          </div>
                        </div>
                      </section>
                    </div>

                    <div className="studio-modal__footer">
                      <p className={signatureRequestStatus.toLowerCase().includes("failed") ? "error" : "small"}>
                        {signatureRequestStatus || "Complete the signer details and apply the request."}
                      </p>
                      {signatureRequestLink ? (
                        <a
                          className="studio-secondary-button"
                          href={signatureRequestLink}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Open link
                        </a>
                      ) : null}
                      <button
                        type="button"
                        className="studio-secondary-button"
                        onClick={() => setSignatureFlowStep("choose")}
                      >
                        Back
                      </button>
                      <button
                        type="button"
                        className="studio-primary-button"
                        onClick={() => void sendSignatureRequest()}
                        disabled={busy}
                      >
                        {busy ? "Sending request..." : "Apply"}
                      </button>
                    </div>
                  </>
                ) : null}
              </div>
            </div>
          ) : null}
        </section>
      </main>
    </div>
  );
}

function StudioPdfPage({
  fileName,
  page,
  previewUrl,
  layers,
  rotationDegrees,
  pageNumbers,
  watermark,
  selectedLayerId,
  onSelectLayer,
  onPlaceLayer
}: {
  fileName: string;
  page: StudioPageMeta;
  previewUrl: string | null;
  layers: StudioLayer[];
  rotationDegrees: number;
  pageNumbers: EditPageNumbersInput | null;
  watermark: EditWatermarkInput | null;
  selectedLayerId: string | null;
  onSelectLayer: (layerId: string) => void;
  onPlaceLayer: (x: number, y: number) => void;
}): React.JSX.Element {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [renderWidth, setRenderWidth] = useState<number>(page.width);

  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) {
      return;
    }

    const updateWidth = (): void => {
      setRenderWidth(wrapper.clientWidth || page.width);
    };

    updateWidth();

    const observer = new ResizeObserver(() => {
      updateWidth();
    });
    observer.observe(wrapper);

    return () => observer.disconnect();
  }, [page.width]);

  const scale = renderWidth / page.width;
  const pageHeight = page.height * scale;
  const pageNumberPreview = pageNumbers ? previewPageNumber(page.pageNumber, pageNumbers) : null;
  const pageNumberStyle: React.CSSProperties | null = pageNumbers
    ? {
        position: "absolute",
        color: pageNumbers.color,
        fontSize: `${Math.max(10, pageNumbers.fontSize * scale)}px`,
        fontWeight: 800,
        letterSpacing: "0.01em",
        zIndex: 1,
        ...(pageNumbers.position.startsWith("top")
          ? { top: `${pageNumbers.margin * scale}px` }
          : { bottom: `${pageNumbers.margin * scale}px` }),
        ...(pageNumbers.position.endsWith("left")
          ? { left: `${pageNumbers.margin * scale}px` }
          : pageNumbers.position.endsWith("right")
            ? { right: `${pageNumbers.margin * scale}px` }
            : { left: "50%", transform: "translateX(-50%)" })
      }
    : null;

  return (
    <article className="studio-page-card">
      <div className="studio-page-card__meta">
        <span>Page {page.pageNumber}</span>
        <span>
          {Math.round(page.width)} x {Math.round(page.height)} pt
          {rotationDegrees ? ` • rotate ${rotationDegrees}°` : ""}
        </span>
      </div>

      <div
        ref={wrapperRef}
        className="studio-page-surface"
        style={{ height: `${pageHeight}px` }}
        onClick={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          const relativeX = event.clientX - rect.left;
          const relativeY = event.clientY - rect.top;
          const x = (relativeX / rect.width) * page.width;
          const y = (1 - relativeY / rect.height) * page.height;
          onPlaceLayer(x, y);
        }}
        >
        <div className="studio-page-paper">
          {previewUrl ? (
            <img
              className="studio-page-paper__preview"
              src={previewUrl}
              alt={`${fileName} page ${page.pageNumber}`}
              draggable={false}
            />
          ) : (
            <>
              <div className="studio-page-paper__watermark">{fileName}</div>
              <div className="studio-page-paper__grid" />
              <div className="studio-page-paper__header">
                <span>Loading PDF page...</span>
                <small>Page {page.pageNumber}</small>
              </div>
            </>
          )}
          {watermark ? (
            <div
              className="studio-page-paper__watermark-preview"
              style={{
                color: watermark.color,
                opacity: watermark.opacity,
                fontSize: `${Math.max(24, watermark.fontSize * scale)}px`,
                transform: `translate(-50%, -50%) rotate(${watermark.rotation}deg)`
              }}
            >
              {watermark.text}
            </div>
          ) : null}
          {pageNumberPreview && pageNumberStyle ? (
            <div className="studio-page-paper__page-number" style={pageNumberStyle}>
              {pageNumberPreview}
            </div>
          ) : null}
        </div>

        <div className="studio-layer-overlay">
          {layers.map((layer) => {
            if (layer.kind === "text") {
              return (
                <button
                  key={layer.id}
                  type="button"
                  className={`studio-layer-ghost studio-layer-ghost--text ${
                    selectedLayerId === layer.id ? "is-active" : ""
                  }`}
                  style={{
                    left: `${layer.x * scale}px`,
                    top: `${pageHeight - layer.y * scale}px`,
                    color: layer.color,
                    fontSize: `${Math.max(12, layer.fontSize * scale)}px`,
                    fontFamily: cssFontFamily(layer.fontFamily),
                    fontWeight: layer.bold ? 800 : 600,
                    fontStyle: layer.italic ? "italic" : "normal",
                    textDecoration: layer.underline ? "underline" : "none"
                  }}
                  onClick={(event) => {
                    event.stopPropagation();
                    onSelectLayer(layer.id);
                  }}
                >
                  {layer.text}
                </button>
              );
            }

            if (layer.kind === "rectangle") {
              return (
                <button
                  key={layer.id}
                  type="button"
                  className={`studio-layer-ghost studio-layer-ghost--rectangle ${
                    selectedLayerId === layer.id ? "is-active" : ""
                  }`}
                  style={{
                    left: `${layer.x * scale}px`,
                    top: `${pageHeight - (layer.y + layer.height) * scale}px`,
                    width: `${layer.width * scale}px`,
                    height: `${layer.height * scale}px`,
                    background: layer.color,
                    opacity: layer.opacity
                  }}
                  onClick={(event) => {
                    event.stopPropagation();
                    onSelectLayer(layer.id);
                  }}
                />
              );
            }

            return (
              <button
                key={layer.id}
                type="button"
                className={`studio-layer-ghost studio-layer-ghost--image ${
                  selectedLayerId === layer.id ? "is-active" : ""
                }`}
                style={{
                  left: `${layer.x * scale}px`,
                  top: `${pageHeight - (layer.y + layer.height) * scale}px`,
                  width: `${layer.width * scale}px`,
                  height: `${layer.height * scale}px`
                }}
                onClick={(event) => {
                  event.stopPropagation();
                  onSelectLayer(layer.id);
                }}
              >
                <img src={layer.dataUrl} alt={layer.fileName} />
              </button>
            );
          })}
        </div>
      </div>
    </article>
  );
}
