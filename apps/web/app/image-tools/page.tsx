"use client";

import {
  BadgeAlert,
  Brush,
  ChevronsUp,
  Crop,
  Droplets,
  FileImage,
  Image as ImageIcon,
  ImageOff,
  Images,
  RotateCw,
  Shield,
  Sparkles,
  Type,
  Wand2
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";
import { SiteHeader } from "../components/site-header";
import {
  IMAGE_TOOL_CATEGORIES,
  IMAGE_TOOLS,
  imageToolsForCategory,
  type ImageToolCategoryId,
  type ImageToolItem,
  type ImageToolKey
} from "../components/image-tool-registry";
import { TaskProgressState } from "../components/task-progress-state";
import { UploadDropzone } from "../components/upload-dropzone";
import {
  isAllowedFileType,
  pollTask,
  queueImageTool,
  uploadImage,
  type ImageToolOperation
} from "../lib/pdf-api";

const FILTERS = ["all", ...IMAGE_TOOL_CATEGORIES.map((category) => category.id)] as const;
const IMAGE_MIME_TYPES = ["image/jpeg", "image/jpg", "image/png", "image/webp", "image/gif", "image/svg+xml"] as const;
const MIN_CROP_SIZE = 24;
type Filter = (typeof FILTERS)[number];

type TaskPhase = "idle" | "uploading" | "queued" | "processing" | "completed" | "failed";
type ImageSize = {
  width: number;
  height: number;
};
type CropBounds = {
  left: number;
  top: number;
  width: number;
  height: number;
};
type CropInteraction = "move" | "n" | "e" | "s" | "w" | "nw" | "ne" | "se" | "sw";
type WorkItem = {
  id: string;
  file: File;
  phase: TaskPhase;
  progressPercent: number;
  status: string;
  downloadUrl: string;
};

const TOOL_ICONS: Record<ImageToolKey, LucideIcon> = {
  "compress-image": Droplets,
  "resize-image": Images,
  "crop-image": Crop,
  "convert-to-jpg": FileImage,
  "photo-editor": Brush,
  "upscale-image": ChevronsUp,
  "remove-background": ImageOff,
  "meme-generator": Type,
  "rotate-image": RotateCw,
  "convert-from-jpg": ImageIcon,
  "html-to-image": Wand2,
  "watermark-image": Shield,
  "blur-face": BadgeAlert
};

function filterLabel(filter: Filter): string {
  if (filter === "all") {
    return "All image tools";
  }
  return IMAGE_TOOL_CATEGORIES.find((category) => category.id === filter)?.label ?? filter;
}

function createItemId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function stripExtension(fileName: string): string {
  const dotIndex = fileName.lastIndexOf(".");
  return dotIndex > 0 ? fileName.slice(0, dotIndex) : fileName;
}

function isSingleImageTool(operation?: ImageToolOperation): boolean {
  return operation === "crop" || operation === "meme";
}

function deriveOutputName(file: File, tool: ImageToolItem): string {
  return `${stripExtension(file.name)}-${tool.shortTitle.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
}

function taskMessage(status: string | null | undefined): string {
  return status || "Processing image...";
}

function clamp(value: number, min: number, max: number): number {
  if (max < min) {
    return min;
  }
  return Math.min(Math.max(value, min), max);
}

function roundCropBounds(bounds: CropBounds): CropBounds {
  return {
    left: Math.round(bounds.left),
    top: Math.round(bounds.top),
    width: Math.round(bounds.width),
    height: Math.round(bounds.height)
  };
}

function fitCropBounds(bounds: CropBounds, imageSize: ImageSize): CropBounds {
  const maxWidth = Math.max(1, imageSize.width);
  const maxHeight = Math.max(1, imageSize.height);
  const width = clamp(bounds.width, 1, maxWidth);
  const height = clamp(bounds.height, 1, maxHeight);
  const left = clamp(bounds.left, 0, maxWidth - width);
  const top = clamp(bounds.top, 0, maxHeight - height);
  const roundedWidth = clamp(Math.round(width), 1, maxWidth);
  const roundedHeight = clamp(Math.round(height), 1, maxHeight);
  return {
    left: clamp(Math.round(left), 0, maxWidth - roundedWidth),
    top: clamp(Math.round(top), 0, maxHeight - roundedHeight),
    width: roundedWidth,
    height: roundedHeight
  };
}

export default function ImageToolsPage(): React.JSX.Element {
  const [selectedFilter, setSelectedFilter] = useState<Filter>("all");
  const [selectedTool, setSelectedTool] = useState<ImageToolItem>(IMAGE_TOOLS[0]);
  const [items, setItems] = useState<WorkItem[]>([]);
  const cropStageRef = useRef<HTMLDivElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [quality, setQuality] = useState(78);
  const [resizeMode, setResizeMode] = useState<"pixels" | "percent">("pixels");
  const [resizeWidth, setResizeWidth] = useState(1200);
  const [resizeHeight, setResizeHeight] = useState(0);
  const [resizePercent, setResizePercent] = useState(50);
  const [cropLeft, setCropLeft] = useState(0);
  const [cropTop, setCropTop] = useState(0);
  const [cropWidth, setCropWidth] = useState(800);
  const [cropHeight, setCropHeight] = useState(600);
  const [imageSize, setImageSize] = useState<ImageSize | null>(null);
  const [rotation, setRotation] = useState<90 | 180 | 270>(90);
  const [convertFromFormat, setConvertFromFormat] = useState<"png" | "webp" | "gif">("png");
  const [watermarkText, setWatermarkText] = useState("iHatePDF");
  const [watermarkPosition, setWatermarkPosition] = useState("bottom-right");
  const [watermarkOpacity, setWatermarkOpacity] = useState(0.72);
  const [memeTopText, setMemeTopText] = useState("TOP TEXT");
  const [memeBottomText, setMemeBottomText] = useState("BOTTOM TEXT");
  const [fontSize, setFontSize] = useState(54);

  const visibleTools = useMemo(
    () => (selectedFilter === "all" ? IMAGE_TOOLS : imageToolsForCategory(selectedFilter as ImageToolCategoryId)),
    [selectedFilter]
  );
  const SelectedIcon = TOOL_ICONS[selectedTool.key];
  const previewFile = items[0]?.file;
  const previewUrl = useMemo(() => (previewFile ? URL.createObjectURL(previewFile) : ""), [previewFile]);
  const canUpload = selectedTool.status === "available";
  const singleImage = isSingleImageTool(selectedTool.operation);
  const acceptedMimeTypes =
    selectedTool.operation === "convert_from_jpg" ? ["image/jpeg", "image/jpg"] : IMAGE_MIME_TYPES;
  const cropBounds = imageSize
    ? fitCropBounds({ left: cropLeft, top: cropTop, width: cropWidth, height: cropHeight }, imageSize)
    : null;
  const cropBoxStyle: CSSProperties | undefined =
    cropBounds && imageSize
      ? {
          left: `${(cropBounds.left / imageSize.width) * 100}%`,
          top: `${(cropBounds.top / imageSize.height) * 100}%`,
          width: `${(cropBounds.width / imageSize.width) * 100}%`,
          height: `${(cropBounds.height / imageSize.height) * 100}%`
        }
      : undefined;

  useEffect(() => {
    return () => {
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
      }
    };
  }, [previewUrl]);

  const updateItem = (id: string, patch: Partial<WorkItem>): void => {
    setItems((current) => current.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  };

  const selectTool = (tool: ImageToolItem): void => {
    if (busy) {
      return;
    }
    setSelectedTool(tool);
    setItems([]);
    setNotice("");
  };

  const addFiles = (fileList: FileList | null): void => {
    const selected = Array.from(fileList ?? []);
    const accepted = selected.filter((file) => isAllowedFileType(file, acceptedMimeTypes));

    if (accepted.length === 0) {
      setNotice(
        selectedTool.operation === "convert_from_jpg"
          ? "Convert from JPG accepts only JPG or JPEG files."
          : "Select JPG, PNG, WebP, GIF, or SVG images."
      );
      return;
    }

    if (singleImage) {
      setImageSize(null);
    }

    setItems((current) => [
      ...(singleImage ? [] : current),
      ...accepted.slice(0, singleImage ? 1 : accepted.length).map((file) => ({
        id: createItemId(),
        file,
        phase: "idle" as const,
        progressPercent: 0,
        status: "Ready",
        downloadUrl: ""
      }))
    ]);
    setNotice(`${accepted.length} image(s) added.${selected.length > accepted.length ? " Some files were skipped." : ""}`);
  };

  const setCropBoundsFromImage = (bounds: CropBounds, size = imageSize): void => {
    const next = size ? fitCropBounds(bounds, size) : roundCropBounds(bounds);
    setCropLeft(next.left);
    setCropTop(next.top);
    setCropWidth(next.width);
    setCropHeight(next.height);
  };

  const handlePreviewImageLoad = (event: React.SyntheticEvent<HTMLImageElement>): void => {
    const nextSize = {
      width: event.currentTarget.naturalWidth,
      height: event.currentTarget.naturalHeight
    };

    setImageSize(nextSize);
    if (selectedTool.operation === "crop") {
      setCropBoundsFromImage({ left: 0, top: 0, width: nextSize.width, height: nextSize.height }, nextSize);
    }
  };

  const startCropInteraction = (event: ReactPointerEvent<HTMLElement>, interaction: CropInteraction): void => {
    if (!cropBounds || !imageSize || !cropStageRef.current || busy) {
      return;
    }

    event.preventDefault();

    const stageRect = cropStageRef.current.getBoundingClientRect();
    const startX = event.clientX;
    const startY = event.clientY;
    const startBounds = cropBounds;
    const scaleX = imageSize.width / stageRect.width;
    const scaleY = imageSize.height / stageRect.height;

    const updateCrop = (moveEvent: PointerEvent): void => {
      const deltaX = (moveEvent.clientX - startX) * scaleX;
      const deltaY = (moveEvent.clientY - startY) * scaleY;
      const right = startBounds.left + startBounds.width;
      const bottom = startBounds.top + startBounds.height;
      const minWidth = Math.min(MIN_CROP_SIZE, imageSize.width);
      const minHeight = Math.min(MIN_CROP_SIZE, imageSize.height);
      let next = { ...startBounds };

      if (interaction === "move") {
        next = {
          ...next,
          left: clamp(startBounds.left + deltaX, 0, imageSize.width - startBounds.width),
          top: clamp(startBounds.top + deltaY, 0, imageSize.height - startBounds.height)
        };
      } else {
        if (interaction.includes("w")) {
          const nextLeft = clamp(startBounds.left + deltaX, 0, right - minWidth);
          next.left = nextLeft;
          next.width = right - nextLeft;
        }
        if (interaction.includes("e")) {
          next.width = clamp(startBounds.width + deltaX, minWidth, imageSize.width - startBounds.left);
        }
        if (interaction.includes("n")) {
          const nextTop = clamp(startBounds.top + deltaY, 0, bottom - minHeight);
          next.top = nextTop;
          next.height = bottom - nextTop;
        }
        if (interaction.includes("s")) {
          next.height = clamp(startBounds.height + deltaY, minHeight, imageSize.height - startBounds.top);
        }
      }

      setCropBoundsFromImage(next);
    };

    const endCrop = (): void => {
      window.removeEventListener("pointermove", updateCrop);
      window.removeEventListener("pointerup", endCrop);
      window.removeEventListener("pointercancel", endCrop);
    };

    window.addEventListener("pointermove", updateCrop);
    window.addEventListener("pointerup", endCrop);
    window.addEventListener("pointercancel", endCrop);
  };

  const buildOptions = (): Record<string, unknown> => {
    if (selectedTool.operation === "compress") {
      return { quality };
    }
    if (selectedTool.operation === "resize") {
      return resizeMode === "percent"
        ? { mode: "percent", percent: resizePercent }
        : {
            mode: "pixels",
            width: resizeWidth || undefined,
            height: resizeHeight || undefined
          };
    }
    if (selectedTool.operation === "crop") {
      const bounds = imageSize
        ? fitCropBounds({ left: cropLeft, top: cropTop, width: cropWidth, height: cropHeight }, imageSize)
        : roundCropBounds({ left: cropLeft, top: cropTop, width: cropWidth, height: cropHeight });
      return bounds;
    }
    if (selectedTool.operation === "rotate") {
      return { degrees: rotation };
    }
    if (selectedTool.operation === "convert_to_jpg") {
      return { quality };
    }
    if (selectedTool.operation === "convert_from_jpg") {
      return { format: convertFromFormat, quality };
    }
    if (selectedTool.operation === "watermark") {
      return {
        text: watermarkText,
        position: watermarkPosition,
        opacity: watermarkOpacity,
        fontSize
      };
    }
    if (selectedTool.operation === "meme") {
      return { topText: memeTopText, bottomText: memeBottomText, fontSize };
    }
    return {};
  };

  const runItem = async (item: WorkItem): Promise<void> => {
    if (!selectedTool.operation) {
      return;
    }

    try {
      updateItem(item.id, { phase: "uploading", progressPercent: 4, status: "Uploading image...", downloadUrl: "" });
      const uploaded = await uploadImage(item.file);
      const outputName = deriveOutputName(item.file, selectedTool);
      updateItem(item.id, { phase: "queued", progressPercent: 12, status: "Queueing image task..." });
      const { taskId } = await queueImageTool(uploaded.fileId, selectedTool.operation, outputName, buildOptions());

      const done = await pollTask(taskId, {
        onUpdate: (task) => {
          updateItem(item.id, {
            phase: task.status === "completed" ? "completed" : task.status === "failed" ? "failed" : "processing",
            progressPercent: task.progressPercent,
            status: taskMessage(task.progressMessage),
            downloadUrl: task.outputDownloadUrl ?? ""
          });
        }
      });

      if (done.status === "failed") {
        throw new Error(done.errorMessage ?? "Image task failed.");
      }
    } catch (error) {
      updateItem(item.id, {
        phase: "failed",
        progressPercent: 100,
        status: (error as Error).message,
        downloadUrl: ""
      });
      throw error;
    }
  };

  const runSelectedTool = async (): Promise<void> => {
    if (!selectedTool.operation || busy) {
      return;
    }
    if (items.length === 0) {
      setNotice("Select at least one image first.");
      return;
    }
    if (selectedTool.operation === "watermark" && !watermarkText.trim()) {
      setNotice("Enter watermark text.");
      return;
    }
    if (selectedTool.operation === "meme" && !memeTopText.trim() && !memeBottomText.trim()) {
      setNotice("Enter top or bottom meme text.");
      return;
    }

    setBusy(true);
    setNotice("");
    try {
      for (const item of items) {
        await runItem(item);
      }
      setNotice("Image task completed.");
    } catch (error) {
      setNotice(`Image task failed: ${(error as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="site-shell">
      <SiteHeader active="image-tools" />

      <main className="image-tools-page">
        <section className="image-tools-hero">
          <span className="image-tools-kicker">
            <Sparkles aria-hidden="true" size={16} />
            Beta surface
          </span>
          <h1>Image tools beta</h1>
          <p>
            A focused image workspace for compressing, resizing, cropping, rotating, converting,
            watermarking, and creating quick meme outputs on your own deployment.
          </p>
        </section>

        <section className="filter-row image-filter-row" aria-label="Image tool categories">
          {FILTERS.map((filter) => (
            <button
              key={filter}
              type="button"
              className={`filter-chip ${selectedFilter === filter ? "is-selected" : ""}`}
              onClick={() => setSelectedFilter(filter)}
              aria-pressed={selectedFilter === filter}
              disabled={busy}
            >
              {filterLabel(filter)}
            </button>
          ))}
        </section>

        <section className="image-tools-layout">
          <div className="image-tool-grid" aria-label="Image tools">
            {visibleTools.map((tool) => {
              const Icon = TOOL_ICONS[tool.key];
              return (
                <button
                  key={tool.key}
                  type="button"
                  className={`image-tool-card ${selectedTool.key === tool.key ? "is-selected" : ""}`}
                  onClick={() => selectTool(tool)}
                  disabled={busy}
                >
                  <span className="image-tool-card__icon">
                    <Icon aria-hidden="true" size={24} />
                  </span>
                  <span className="image-tool-card__meta">{filterLabel(tool.category)}</span>
                  <strong>{tool.title}</strong>
                  <span>{tool.description}</span>
                  {tool.status === "gated" ? <em>{tool.betaLabel ?? "Gated beta"}</em> : null}
                </button>
              );
            })}
          </div>

          <aside className="image-tool-workbench" aria-label={`${selectedTool.title} workbench`}>
            <div className="image-tool-workbench__header">
              <span className="image-tool-workbench__icon">
                <SelectedIcon aria-hidden="true" size={24} />
              </span>
              <div>
                <span>{filterLabel(selectedTool.category)}</span>
                <h2>{selectedTool.title}</h2>
              </div>
            </div>

            {selectedTool.status === "gated" ? (
              <div className="image-tool-gated">
                <strong>This tool is visible for the beta, but processing is not enabled yet.</strong>
                <p>
                  {selectedTool.title} needs a richer editor, browser capture, or AI/provider-backed
                  processing before it can run reliably in this self-hosted build.
                </p>
                <button type="button" disabled>
                  Processing disabled
                </button>
              </div>
            ) : (
              <>
                <UploadDropzone
                  label={singleImage ? "Select image" : "Select images"}
                  hint={
                    items.length > 0
                      ? `${items.length} image(s) ready`
                      : selectedTool.operation === "convert_from_jpg"
                        ? "Drop JPG files here"
                        : "Drop JPG, PNG, WebP, GIF, or SVG files here"
                  }
                  accept={
                    selectedTool.operation === "convert_from_jpg"
                      ? ".jpg,.jpeg,image/jpeg"
                      : ".jpg,.jpeg,.png,.webp,.gif,.svg,image/jpeg,image/png,image/webp,image/gif,image/svg+xml"
                  }
                  multiple={!singleImage}
                  disabled={busy || !canUpload}
                  compact
                  onFiles={addFiles}
                />

                {previewUrl && singleImage ? (
                  <div className={`image-preview-frame ${selectedTool.operation === "crop" ? "image-preview-frame--crop" : ""}`}>
                    {selectedTool.operation === "crop" ? (
                      <div className="image-crop-stage" ref={cropStageRef}>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={previewUrl} alt="Selected image preview" draggable={false} onLoad={handlePreviewImageLoad} />
                        {cropBoxStyle ? (
                          <div className="image-crop-overlay" aria-hidden="true">
                            <span className="image-crop-shade image-crop-shade--top" style={{ height: cropBoxStyle.top }} />
                            <span
                              className="image-crop-shade image-crop-shade--right"
                              style={{
                                left: `calc(${cropBoxStyle.left} + ${cropBoxStyle.width})`,
                                top: cropBoxStyle.top,
                                width: `calc(100% - (${cropBoxStyle.left} + ${cropBoxStyle.width}))`,
                                height: cropBoxStyle.height
                              }}
                            />
                            <span
                              className="image-crop-shade image-crop-shade--bottom"
                              style={{
                                top: `calc(${cropBoxStyle.top} + ${cropBoxStyle.height})`,
                                height: `calc(100% - (${cropBoxStyle.top} + ${cropBoxStyle.height}))`
                              }}
                            />
                            <span
                              className="image-crop-shade image-crop-shade--left"
                              style={{
                                top: cropBoxStyle.top,
                                width: cropBoxStyle.left,
                                height: cropBoxStyle.height
                              }}
                            />
                          </div>
                        ) : null}
                        {cropBoxStyle ? (
                          <div
                            className="image-crop-box"
                            style={cropBoxStyle}
                            role="button"
                            tabIndex={0}
                            aria-label="Drag crop area"
                            onPointerDown={(event) => startCropInteraction(event, "move")}
                          >
                            {(["nw", "n", "ne", "e", "se", "s", "sw", "w"] as CropInteraction[]).map((handle) => (
                              <span
                                key={handle}
                                className={`image-crop-handle image-crop-handle--${handle}`}
                                onPointerDown={(event) => {
                                  event.stopPropagation();
                                  startCropInteraction(event, handle);
                                }}
                              />
                            ))}
                          </div>
                        ) : null}
                      </div>
                    ) : (
                      <>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={previewUrl} alt="Selected image preview" draggable={false} onLoad={handlePreviewImageLoad} />
                      </>
                    )}
                  </div>
                ) : null}

                <div className="image-tool-options">
                  {(selectedTool.operation === "compress" || selectedTool.operation?.startsWith("convert")) && (
                    <label>
                      Quality
                      <span className="image-control-row">
                        <input
                          type="range"
                          min={1}
                          max={100}
                          value={quality}
                          onChange={(event) => setQuality(Number(event.target.value))}
                        />
                        <strong>{quality}%</strong>
                      </span>
                    </label>
                  )}

                  {selectedTool.operation === "resize" ? (
                    <>
                      <label>
                        Mode
                        <span className="image-segmented-control">
                          {(["pixels", "percent"] as const).map((mode) => (
                            <button
                              key={mode}
                              type="button"
                              className={resizeMode === mode ? "is-selected" : ""}
                              onClick={() => setResizeMode(mode)}
                              aria-pressed={resizeMode === mode}
                            >
                              {mode === "pixels" ? "Pixels" : "Percent"}
                            </button>
                          ))}
                        </span>
                      </label>
                      {resizeMode === "pixels" ? (
                        <div className="image-tool-options__pair">
                          <label>
                            Width
                            <input type="number" min={0} value={resizeWidth} onChange={(event) => setResizeWidth(Number(event.target.value))} />
                          </label>
                          <label>
                            Height
                            <input type="number" min={0} value={resizeHeight} onChange={(event) => setResizeHeight(Number(event.target.value))} />
                          </label>
                        </div>
                      ) : (
                        <label>
                          Percent
                          <span className="image-control-row">
                            <input type="range" min={1} max={500} value={resizePercent} onChange={(event) => setResizePercent(Number(event.target.value))} />
                            <strong>{resizePercent}%</strong>
                          </span>
                        </label>
                      )}
                    </>
                  ) : null}

                  {selectedTool.operation === "crop" ? (
                    <div className="image-crop-summary">
                      <div>
                        <span>Crop area</span>
                        <strong>{cropBounds ? `${cropBounds.width} x ${cropBounds.height} px` : "Select an image to start"}</strong>
                      </div>
                      <div className="image-crop-actions">
                        <button
                          type="button"
                          disabled={!imageSize || busy}
                          onClick={() => {
                            if (imageSize) {
                              const size = Math.min(imageSize.width, imageSize.height);
                              setCropBoundsFromImage({
                                left: (imageSize.width - size) / 2,
                                top: (imageSize.height - size) / 2,
                                width: size,
                                height: size
                              });
                            }
                          }}
                        >
                          Square
                        </button>
                        <button
                          type="button"
                          disabled={!imageSize || busy}
                          onClick={() => {
                            if (imageSize) {
                              setCropBoundsFromImage({ left: 0, top: 0, width: imageSize.width, height: imageSize.height });
                            }
                          }}
                        >
                          Full image
                        </button>
                      </div>
                    </div>
                  ) : null}

                  {selectedTool.operation === "rotate" ? (
                    <label>
                      Rotation
                      <span className="image-segmented-control">
                        {[90, 180, 270].map((degrees) => (
                          <button
                            key={degrees}
                            type="button"
                            className={rotation === degrees ? "is-selected" : ""}
                            onClick={() => setRotation(degrees as 90 | 180 | 270)}
                            aria-pressed={rotation === degrees}
                          >
                            {degrees}°
                          </button>
                        ))}
                      </span>
                    </label>
                  ) : null}

                  {selectedTool.operation === "convert_from_jpg" ? (
                    <label>
                      Output format
                      <select value={convertFromFormat} onChange={(event) => setConvertFromFormat(event.target.value as "png" | "webp" | "gif")}>
                        <option value="png">PNG</option>
                        <option value="webp">WebP</option>
                        <option value="gif">GIF</option>
                      </select>
                    </label>
                  ) : null}

                  {selectedTool.operation === "watermark" ? (
                    <>
                      <label>
                        Watermark text
                        <input value={watermarkText} onChange={(event) => setWatermarkText(event.target.value)} />
                      </label>
                      <div className="image-tool-options__pair">
                        <label>
                          Position
                          <select value={watermarkPosition} onChange={(event) => setWatermarkPosition(event.target.value)}>
                            <option value="top-left">Top left</option>
                            <option value="top-center">Top center</option>
                            <option value="top-right">Top right</option>
                            <option value="center">Center</option>
                            <option value="bottom-left">Bottom left</option>
                            <option value="bottom-center">Bottom center</option>
                            <option value="bottom-right">Bottom right</option>
                          </select>
                        </label>
                        <label>
                          Opacity
                          <span className="image-control-row">
                            <input type="range" min={0.05} max={1} step={0.05} value={watermarkOpacity} onChange={(event) => setWatermarkOpacity(Number(event.target.value))} />
                            <strong>{Math.round(watermarkOpacity * 100)}%</strong>
                          </span>
                        </label>
                      </div>
                    </>
                  ) : null}

                  {selectedTool.operation === "meme" ? (
                    <>
                      <label>
                        Top text
                        <input value={memeTopText} onChange={(event) => setMemeTopText(event.target.value)} />
                      </label>
                      <label>
                        Bottom text
                        <input value={memeBottomText} onChange={(event) => setMemeBottomText(event.target.value)} />
                      </label>
                    </>
                  ) : null}

                  {(selectedTool.operation === "watermark" || selectedTool.operation === "meme") ? (
                    <label>
                      Text size
                      <span className="image-control-row">
                        <input type="range" min={12} max={240} value={fontSize} onChange={(event) => setFontSize(Number(event.target.value))} />
                        <strong>{fontSize}px</strong>
                      </span>
                    </label>
                  ) : null}
                </div>

                {items.length > 0 ? (
                  <div className="image-task-list">
                    {items.map((item) => (
                      <article key={item.id} className="image-task-row">
                        <strong>{item.file.name}</strong>
                        <TaskProgressState
                          status={item.status}
                          progressPercent={item.progressPercent}
                          downloadUrl={item.downloadUrl}
                          downloadLabel="Download image"
                        />
                      </article>
                    ))}
                  </div>
                ) : null}

                {notice ? <p className="image-tool-notice">{notice}</p> : null}

                <button
                  type="button"
                  className="start-process-btn image-tool-run"
                  disabled={busy || items.length === 0}
                  onClick={runSelectedTool}
                >
                  {busy ? "Processing..." : `Run ${selectedTool.shortTitle}`}
                </button>
              </>
            )}
          </aside>
        </section>
      </main>
    </div>
  );
}
