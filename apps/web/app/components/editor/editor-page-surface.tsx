"use client";

import { useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy, RenderTask, TextLayer } from "pdfjs-dist";
import type { EditPageNumbersInput, EditWatermarkInput } from "../../lib/pdf-api";
import type { EditorLayer, EditorPage, EditorTool } from "./types";
import { clamp, cssFontFamily, previewPageNumber } from "./utils";

type PdfJsModule = typeof import("pdfjs-dist");

let pdfJsModulePromise: Promise<PdfJsModule> | null = null;

function loadPdfJs(): Promise<PdfJsModule> {
  pdfJsModulePromise ??= import("pdfjs-dist").then((pdfjs) => {
    pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
    return pdfjs;
  });

  return pdfJsModulePromise;
}

function customFontCssName(layer: EditorLayer): string | null {
  if (layer.kind !== "text" || !layer.customFont?.dataUrl) {
    return null;
  }
  return `ihatepdf-${layer.id}`;
}

type ResizeHandle = "nw" | "ne" | "se" | "sw";
type AlignmentGuides = {
  vertical: number[];
  horizontal: number[];
};

const SNAP_DISTANCE = 6;
const GRID_SIZE = 12;

function colorWithOpacity(color: string, opacity: number): string {
  const normalized = color.trim();
  if (/^#[0-9a-f]{6}$/i.test(normalized)) {
    const red = Number.parseInt(normalized.slice(1, 3), 16);
    const green = Number.parseInt(normalized.slice(3, 5), 16);
    const blue = Number.parseInt(normalized.slice(5, 7), 16);
    return `rgba(${red}, ${green}, ${blue}, ${clamp(opacity, 0, 1)})`;
  }

  return normalized;
}

export function EditorPageSurface({
  fileName,
  page,
  pdfDocument,
  previewUrl,
  layers,
  rotationDegrees,
  pageNumbers,
  watermark,
  activeTool,
  selectedLayerId,
  selectedLayerIds,
  zoom,
  fitMode,
  snapToGrid,
  showGuides,
  onSelectLayer,
  onCreateUndoCheckpoint,
  onUpdateLayer,
  onMoveLayer,
  onPlaceLayer,
  onCreateInkLayer
}: {
  fileName: string;
  page: EditorPage;
  pdfDocument: PDFDocumentProxy | null;
  previewUrl: string | null;
  layers: EditorLayer[];
  rotationDegrees: number;
  pageNumbers: EditPageNumbersInput | null;
  watermark: EditWatermarkInput | null;
  activeTool: EditorTool;
  selectedLayerId: string | null;
  selectedLayerIds: string[];
  zoom: number;
  fitMode: "fit-width" | "fit-page" | "manual";
  snapToGrid: boolean;
  showGuides: boolean;
  onSelectLayer: (layerId: string, additive?: boolean) => void;
  onCreateUndoCheckpoint: () => void;
  onUpdateLayer: (
    layerId: string,
    updater: (layer: EditorLayer) => EditorLayer,
    trackHistory?: boolean
  ) => void;
  onMoveLayer: (layerId: string, x: number, y: number, trackHistory?: boolean) => void;
  onPlaceLayer: (x: number, y: number) => void;
  onCreateInkLayer: (points: Array<{ x: number; y: number }>) => void;
}): React.JSX.Element {
  const frameRef = useRef<HTMLDivElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textLayerRef = useRef<HTMLDivElement>(null);
  const [renderWidth, setRenderWidth] = useState<number>(page.width);
  const [pdfJsPageReady, setPdfJsPageReady] = useState(false);
  const [draggingLayerId, setDraggingLayerId] = useState<string | null>(null);
  const [editingTextLayerId, setEditingTextLayerId] = useState<string | null>(null);
  const [alignmentGuides, setAlignmentGuides] = useState<AlignmentGuides>({ vertical: [], horizontal: [] });

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) {
      return;
    }

    const updateWidth = (): void => {
      const availableWidth = Math.min(frame.clientWidth || page.width, 920);
      if (fitMode !== "fit-page") {
        setRenderWidth(availableWidth);
        return;
      }

      const availableHeight = Math.max(360, window.innerHeight - 230);
      setRenderWidth(Math.min(availableWidth, (availableHeight / page.height) * page.width));
    };

    updateWidth();

    const observer = new ResizeObserver(() => {
      updateWidth();
    });
    observer.observe(frame);

    return () => observer.disconnect();
  }, [fitMode, page.height, page.width]);

  const scale = (renderWidth / page.width) * (fitMode === "manual" ? zoom : 1);
  const pageWidth = page.width * scale;
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

  useEffect(() => {
    if (!draggingLayerId) {
      setAlignmentGuides({ vertical: [], horizontal: [] });
      return;
    }

    const stopDragging = (): void => {
      setDraggingLayerId(null);
      setAlignmentGuides({ vertical: [], horizontal: [] });
    };

    window.addEventListener("pointerup", stopDragging);
    window.addEventListener("pointercancel", stopDragging);

    return () => {
      window.removeEventListener("pointerup", stopDragging);
      window.removeEventListener("pointercancel", stopDragging);
    };
  }, [draggingLayerId]);

  useEffect(() => {
    let cancelled = false;
    let renderTask: RenderTask | null = null;
    let textLayer: TextLayer | null = null;
    const canvas = canvasRef.current;
    const textLayerContainer = textLayerRef.current;

    setPdfJsPageReady(false);

    if (!pdfDocument || !canvas || !textLayerContainer) {
      return;
    }

    textLayerContainer.replaceChildren();

    void (async () => {
      try {
        const pdfjs = await loadPdfJs();
        const pdfPage = await pdfDocument.getPage(page.pageNumber);
        const viewport = pdfPage.getViewport({ scale });
        const outputScale = window.devicePixelRatio || 1;
        const context = canvas.getContext("2d");

        if (!context || cancelled) {
          return;
        }

        canvas.width = Math.floor(viewport.width * outputScale);
        canvas.height = Math.floor(viewport.height * outputScale);
        canvas.style.width = `${pageWidth}px`;
        canvas.style.height = `${pageHeight}px`;
        context.setTransform(outputScale, 0, 0, outputScale, 0, 0);

        renderTask = pdfPage.render({
          canvas,
          canvasContext: context,
          viewport
        });
        await renderTask.promise;

        if (cancelled) {
          return;
        }

        textLayerContainer.replaceChildren();
        textLayerContainer.style.setProperty("--total-scale-factor", String(scale));
        textLayer = new pdfjs.TextLayer({
          textContentSource: await pdfPage.getTextContent(),
          container: textLayerContainer,
          viewport
        });
        await textLayer.render();

        if (!cancelled) {
          setPdfJsPageReady(true);
        }
      } catch {
        if (!cancelled) {
          setPdfJsPageReady(false);
        }
      }
    })();

    return () => {
      cancelled = true;
      renderTask?.cancel();
      textLayer?.cancel();
    };
  }, [page.pageNumber, pageHeight, pageWidth, pdfDocument, scale]);

  const selectedLayerIdSet = new Set(selectedLayerIds);

  useEffect(() => {
    if (typeof FontFace === "undefined") {
      return;
    }

    const fonts = layers.flatMap((layer) => {
      const family = customFontCssName(layer);
      if (!family || layer.kind !== "text" || !layer.customFont?.dataUrl) {
        return [];
      }
      const face = new FontFace(family, `url(${layer.customFont.dataUrl})`);
      document.fonts.add(face);
      void face.load().catch(() => undefined);
      return [face];
    });

    return () => {
      fonts.forEach((font) => document.fonts.delete(font));
    };
  }, [layers]);

  const pointerToPdfPoint = (clientX: number, clientY: number, element: HTMLElement): { x: number; y: number } => {
    const rect = element.getBoundingClientRect();
    return {
      x: clamp(((clientX - rect.left) / rect.width) * page.width, 0, page.width),
      y: clamp((1 - (clientY - rect.top) / rect.height) * page.height, 0, page.height)
    };
  };

  const beginInkStroke = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (activeTool !== "ink") {
      return;
    }

    const surface = event.currentTarget;
    const points: Array<{ x: number; y: number }> = [pointerToPdfPoint(event.clientX, event.clientY, surface)];

    event.preventDefault();
    event.stopPropagation();
    surface.setPointerCapture(event.pointerId);

    const handlePointerMove = (moveEvent: PointerEvent): void => {
      const next = pointerToPdfPoint(moveEvent.clientX, moveEvent.clientY, surface);
      const previous = points[points.length - 1];
      if (Math.hypot(next.x - previous.x, next.y - previous.y) >= 1.5) {
        points.push(next);
      }
    };

    const finishStroke = (): void => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", finishStroke);
      window.removeEventListener("pointercancel", finishStroke);
      if (points.length >= 2) {
        onCreateInkLayer(points);
      }
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", finishStroke);
    window.addEventListener("pointercancel", finishStroke);
  };

  const getLayerDimensions = (layer: EditorLayer): { width: number; height: number } =>
    layer.kind === "text" ? { width: 0, height: 0 } : { width: layer.width, height: layer.height };

  const buildSnapTargets = (layer: EditorLayer): AlignmentGuides => {
    const targets: AlignmentGuides = {
      vertical: [0, page.width / 2, page.width],
      horizontal: [0, page.height / 2, page.height]
    };

    layers.forEach((candidate) => {
      if (candidate.id === layer.id || candidate.page !== layer.page) {
        return;
      }

      if (candidate.kind === "text") {
        targets.vertical.push(candidate.x);
        targets.horizontal.push(candidate.y);
        return;
      }

      targets.vertical.push(candidate.x, candidate.x + candidate.width / 2, candidate.x + candidate.width);
      targets.horizontal.push(candidate.y, candidate.y + candidate.height / 2, candidate.y + candidate.height);
    });

    return targets;
  };

  const snapLayerPosition = (
    layer: EditorLayer,
    x: number,
    y: number,
    width: number,
    height: number
  ): { x: number; y: number } => {
    const targets = showGuides ? buildSnapTargets(layer) : { vertical: [], horizontal: [] };
    const layerVerticalAnchors = [
      { value: x, offset: 0 },
      { value: x + width / 2, offset: width / 2 },
      { value: x + width, offset: width }
    ];
    const layerHorizontalAnchors = [
      { value: y, offset: 0 },
      { value: y + height / 2, offset: height / 2 },
      { value: y + height, offset: height }
    ];

    let snappedX = x;
    let snappedY = y;
    const nextGuides: AlignmentGuides = { vertical: [], horizontal: [] };

    if (snapToGrid) {
      snappedX = Math.round(snappedX / GRID_SIZE) * GRID_SIZE;
      snappedY = Math.round(snappedY / GRID_SIZE) * GRID_SIZE;
    }

    if (showGuides) {
      for (const target of targets.vertical) {
        const anchor = layerVerticalAnchors.find((item) => Math.abs(item.value - target) <= SNAP_DISTANCE);
        if (anchor) {
          snappedX = target - anchor.offset;
          nextGuides.vertical.push(target);
          break;
        }
      }

      for (const target of targets.horizontal) {
        const anchor = layerHorizontalAnchors.find((item) => Math.abs(item.value - target) <= SNAP_DISTANCE);
        if (anchor) {
          snappedY = target - anchor.offset;
          nextGuides.horizontal.push(target);
          break;
        }
      }
    }

    setAlignmentGuides(showGuides ? nextGuides : { vertical: [], horizontal: [] });

    return {
      x: clamp(snappedX, 0, Math.max(0, page.width - width)),
      y: clamp(snappedY, 0, Math.max(0, page.height - height))
    };
  };

  useEffect(() => {
    if (!editingTextLayerId || layers.some((layer) => layer.id === editingTextLayerId)) {
      return;
    }
    setEditingTextLayerId(null);
  }, [editingTextLayerId, layers]);

  const beginLayerDrag = (
    event: React.PointerEvent<HTMLButtonElement>,
    layer: EditorLayer
  ): void => {
    if (layer.locked) {
      onSelectLayer(layer.id, event.shiftKey || event.metaKey || event.ctrlKey);
      event.preventDefault();
      event.stopPropagation();
      return;
    }

    if (activeTool !== "select") {
      onSelectLayer(layer.id);
      return;
    }

    if (event.shiftKey || event.metaKey || event.ctrlKey) {
      onSelectLayer(layer.id, true);
      event.preventDefault();
      event.stopPropagation();
      return;
    }

    const surface = wrapperRef.current;
    if (!surface) {
      return;
    }

    const surfaceRect = surface.getBoundingClientRect();
    const layerRect = event.currentTarget.getBoundingClientRect();
    const offsetX = event.clientX - layerRect.left;
    const offsetBottom = layerRect.bottom - event.clientY;
    const layerWidth = layerRect.width / scale;
    const layerHeight = layerRect.height / scale;
    const draggedLayers = selectedLayerIdSet.has(layer.id)
      ? layers.filter((candidate) => selectedLayerIdSet.has(candidate.id))
      : [layer];
    const initialLayerPositions = new Map(
      draggedLayers.map((candidate) => [candidate.id, { x: candidate.x, y: candidate.y }])
    );
    let hasUndoCheckpoint = false;

    const updatePosition = (clientX: number, clientY: number): void => {
      const visualLeft = clamp(
        clientX - surfaceRect.left - offsetX,
        0,
        Math.max(0, surfaceRect.width - layerRect.width)
      );
      const visualBottom = clamp(
        clientY - surfaceRect.top + offsetBottom,
        layerRect.height,
        surfaceRect.height
      );
      const rawX = clamp(visualLeft / scale, 0, Math.max(0, page.width - layerWidth));
      const rawY = clamp(
        (surfaceRect.height - visualBottom) / scale,
        0,
        Math.max(0, page.height - layerHeight)
      );
      const { x, y } = snapLayerPosition(layer, rawX, rawY, layerWidth, layerHeight);

      const deltaX = x - layer.x;
      const deltaY = y - layer.y;

      if (!hasUndoCheckpoint && (Math.abs(deltaX) > 0.1 || Math.abs(deltaY) > 0.1)) {
        onCreateUndoCheckpoint();
        hasUndoCheckpoint = true;
      }

      if (draggedLayers.length === 1) {
        onMoveLayer(layer.id, x, y, false);
        return;
      }

      draggedLayers.forEach((draggedLayer) => {
        const initialPosition = initialLayerPositions.get(draggedLayer.id);
        if (!initialPosition) {
          return;
        }
        const draggedLayerSize = getLayerDimensions(draggedLayer);
        onUpdateLayer(
          draggedLayer.id,
          (current) => ({
            ...current,
            x: clamp(initialPosition.x + deltaX, 0, Math.max(0, page.width - draggedLayerSize.width)),
            y: clamp(initialPosition.y + deltaY, 0, Math.max(0, page.height - draggedLayerSize.height))
          }),
          false
        );
      });
    };

    if (!selectedLayerIdSet.has(layer.id)) {
      onSelectLayer(layer.id);
    }
    setDraggingLayerId(layer.id);
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    updatePosition(event.clientX, event.clientY);

    const handlePointerMove = (moveEvent: PointerEvent): void => {
      updatePosition(moveEvent.clientX, moveEvent.clientY);
    };

    const handlePointerUp = (): void => {
      setDraggingLayerId((current) => (current === layer.id ? null : current));
      setAlignmentGuides({ vertical: [], horizontal: [] });
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerUp);
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerUp);
  };

  const beginLayerResize = (
    event: React.PointerEvent<HTMLSpanElement>,
    layer: EditorLayer,
    handle: ResizeHandle
  ): void => {
    if (
      activeTool !== "select" ||
      layer.locked ||
      (layer.kind !== "rectangle" && layer.kind !== "image" && layer.kind !== "annotation" && layer.kind !== "ink")
    ) {
      return;
    }

    const surface = wrapperRef.current;
    if (!surface) {
      return;
    }

    const surfaceRect = surface.getBoundingClientRect();
    const initial = {
      x: layer.x,
      y: layer.y,
      width: layer.width,
      height: layer.height
    };
    const minSize = layer.kind === "image" ? 24 : 12;
    let hasUndoCheckpoint = false;

    const resize = (clientX: number, clientY: number): void => {
      const pointerX = clamp((clientX - surfaceRect.left) / scale, 0, page.width);
      const pointerY = clamp((surfaceRect.bottom - clientY) / scale, 0, page.height);
      const next = { ...initial };

      if (handle.includes("w")) {
        const maxX = initial.x + initial.width - minSize;
        next.x = clamp(pointerX, 0, Math.max(0, maxX));
        next.width = initial.x + initial.width - next.x;
      }

      if (handle.includes("e")) {
        next.width = clamp(pointerX - initial.x, minSize, Math.max(minSize, page.width - initial.x));
      }

      if (handle.includes("s")) {
        const maxY = initial.y + initial.height - minSize;
        next.y = clamp(pointerY, 0, Math.max(0, maxY));
        next.height = initial.y + initial.height - next.y;
      }

      if (handle.includes("n")) {
        next.height = clamp(pointerY - initial.y, minSize, Math.max(minSize, page.height - initial.y));
      }

      const changed =
        Math.abs(next.x - initial.x) > 0.1 ||
        Math.abs(next.y - initial.y) > 0.1 ||
        Math.abs(next.width - initial.width) > 0.1 ||
        Math.abs(next.height - initial.height) > 0.1;

      if (!hasUndoCheckpoint && changed) {
        onCreateUndoCheckpoint();
        hasUndoCheckpoint = true;
      }

      onUpdateLayer(
        layer.id,
        (current) => (current.kind === "text" ? current : { ...current, ...next }),
        false
      );
    };

    onSelectLayer(layer.id);
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    resize(event.clientX, event.clientY);

    const handlePointerMove = (moveEvent: PointerEvent): void => {
      resize(moveEvent.clientX, moveEvent.clientY);
    };

    const handlePointerUp = (): void => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerUp);
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerUp);
  };

  const renderResizeHandles = (layer: EditorLayer): React.JSX.Element | null => {
    if (
      activeTool !== "select" ||
      !selectedLayerIdSet.has(layer.id) ||
      layer.locked ||
      (layer.kind !== "rectangle" && layer.kind !== "image" && layer.kind !== "annotation" && layer.kind !== "ink")
    ) {
      return null;
    }

    return (
      <>
        {(["nw", "ne", "se", "sw"] as ResizeHandle[]).map((handle) => (
          <span
            key={`${layer.id}-${handle}`}
            className={`studio-layer-resize-handle studio-layer-resize-handle--${handle}`}
            onPointerDown={(event) => beginLayerResize(event, layer, handle)}
          />
        ))}
      </>
    );
  };

  return (
    <article className="studio-page-card">
      <div className="studio-page-card__meta">
        <span>Page {page.pageNumber}</span>
        <span>
          {Math.round(page.width)} x {Math.round(page.height)} pt
          {rotationDegrees ? ` • rotate ${rotationDegrees}°` : ""}
        </span>
      </div>

      <div ref={frameRef} className="studio-page-zoom-frame">
        <div
          ref={wrapperRef}
          className={`studio-page-surface ${snapToGrid ? "has-snap-grid" : ""}`}
          style={{
            width: `${pageWidth}px`,
            height: `${pageHeight}px`,
            cursor: activeTool === "select" ? "default" : "crosshair"
          }}
          onClick={(event) => {
            if (activeTool === "ink") {
              return;
            }
            const rect = event.currentTarget.getBoundingClientRect();
            const relativeX = event.clientX - rect.left;
            const relativeY = event.clientY - rect.top;
            const x = (relativeX / rect.width) * page.width;
            const y = (1 - relativeY / rect.height) * page.height;
            onPlaceLayer(x, y);
          }}
          onPointerDown={beginInkStroke}
        >
          <div className="studio-page-paper">
          {pdfDocument ? (
            <div className={`studio-pdfjs-page ${pdfJsPageReady ? "is-ready" : ""}`}>
              <canvas
                ref={canvasRef}
                className="studio-pdfjs-page__canvas"
                aria-label={`${fileName} page ${page.pageNumber}`}
              />
              <div ref={textLayerRef} className="textLayer studio-pdfjs-page__text-layer" />
            </div>
          ) : null}
          {!pdfJsPageReady && previewUrl ? (
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
            {alignmentGuides.vertical.map((guide) => (
              <span
                key={`vertical-${guide}`}
                className="studio-alignment-guide studio-alignment-guide--vertical"
                style={{ left: `${guide * scale}px` }}
              />
            ))}
            {alignmentGuides.horizontal.map((guide) => (
              <span
                key={`horizontal-${guide}`}
                className="studio-alignment-guide studio-alignment-guide--horizontal"
                style={{ top: `${pageHeight - guide * scale}px` }}
              />
            ))}
          {layers.map((layer) => {
            if (layer.kind === "text") {
              const isEditing = editingTextLayerId === layer.id;
              const fontFamily = customFontCssName(layer)
                ? `"${customFontCssName(layer)}", ${cssFontFamily(layer.fontFamily)}`
                : cssFontFamily(layer.fontFamily);
              const textStyle: React.CSSProperties = {
                left: `${layer.x * scale}px`,
                top: `${pageHeight - layer.y * scale}px`,
                width: `${Math.max(40, layer.width * scale)}px`,
                color: layer.color,
                fontSize: `${Math.max(12, layer.fontSize * scale)}px`,
                fontFamily,
                fontWeight: layer.bold ? 800 : 600,
                fontStyle: layer.italic ? "italic" : "normal",
                lineHeight: layer.lineHeight,
                opacity: layer.opacity,
                textAlign: layer.align,
                textDecoration: layer.underline ? "underline" : "none",
                whiteSpace: "pre-wrap"
              };

              if (isEditing) {
                return (
                  <textarea
                    key={layer.id}
                    className="studio-layer-text-editor"
                    style={textStyle}
                    value={layer.text}
                    autoFocus
                    rows={Math.max(2, layer.text.split("\n").length)}
                    onClick={(event) => event.stopPropagation()}
                    onPointerDown={(event) => event.stopPropagation()}
                    onBlur={() => setEditingTextLayerId(null)}
                    onKeyDown={(event) => {
                      if (event.key === "Escape") {
                        event.currentTarget.blur();
                      }
                    }}
                    onChange={(event) =>
                      onUpdateLayer(layer.id, (current) =>
                        current.kind === "text" ? { ...current, text: event.target.value } : current
                      )
                    }
                  />
                );
              }

              return (
                <button
                  key={layer.id}
                  type="button"
                  className={`studio-layer-ghost studio-layer-ghost--text ${layer.locked ? "is-locked" : ""} ${
                    selectedLayerIdSet.has(layer.id) ? "is-active" : ""
                  }`}
                  style={{
                    ...textStyle,
                    cursor:
                      layer.locked
                        ? "not-allowed"
                        : activeTool === "select"
                        ? draggingLayerId === layer.id
                          ? "grabbing"
                          : "grab"
                        : "pointer"
                  }}
                  onClick={(event) => {
                    event.stopPropagation();
                  }}
                  onDoubleClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    if (layer.locked) {
                      return;
                    }
                    onSelectLayer(layer.id, event.shiftKey || event.metaKey || event.ctrlKey);
                    setEditingTextLayerId(layer.id);
                  }}
                  onPointerDown={(event) => beginLayerDrag(event, layer)}
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
                  className={`studio-layer-ghost studio-layer-ghost--rectangle ${layer.locked ? "is-locked" : ""} ${
                    selectedLayerIdSet.has(layer.id) ? "is-active" : ""
                  }`}
                  style={{
                    left: `${layer.x * scale}px`,
                    top: `${pageHeight - (layer.y + layer.height) * scale}px`,
                    width: `${layer.width * scale}px`,
                    height: `${layer.height * scale}px`,
                    background: colorWithOpacity(layer.color, layer.opacity),
                    cursor:
                      layer.locked
                        ? "not-allowed"
                        : activeTool === "select"
                        ? draggingLayerId === layer.id
                          ? "grabbing"
                          : "grab"
                        : "pointer"
                  }}
                  onClick={(event) => {
                    event.stopPropagation();
                  }}
                  onPointerDown={(event) => beginLayerDrag(event, layer)}
                >
                  {renderResizeHandles(layer)}
                </button>
              );
            }

            if (layer.kind === "annotation") {
              const top = pageHeight - (layer.y + layer.height) * scale;
              return (
                <button
                  key={layer.id}
                  type="button"
                  className={`studio-layer-ghost studio-layer-ghost--annotation studio-layer-ghost--annotation-${layer.variant} ${layer.locked ? "is-locked" : ""} ${
                    selectedLayerIdSet.has(layer.id) ? "is-active" : ""
                  }`}
                  style={{
                    left: `${layer.x * scale}px`,
                    top: `${top}px`,
                    width: `${layer.width * scale}px`,
                    height: `${layer.height * scale}px`,
                    color: layer.variant === "strike" ? layer.color : "#19334d",
                    background: layer.variant === "strike" ? "transparent" : colorWithOpacity(layer.color, layer.opacity),
                    cursor:
                      layer.locked
                        ? "not-allowed"
                        : activeTool === "select"
                        ? draggingLayerId === layer.id
                          ? "grabbing"
                          : "grab"
                        : "pointer"
                  }}
                  onClick={(event) => {
                    event.stopPropagation();
                  }}
                  onDoubleClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    if (layer.locked) {
                      return;
                    }
                    onUpdateLayer(layer.id, (current) =>
                      current.kind === "annotation"
                        ? {
                            ...current,
                            text: window.prompt("Annotation text", current.text) ?? current.text
                          }
                        : current
                    );
                  }}
                  onPointerDown={(event) => beginLayerDrag(event, layer)}
                >
                  {layer.variant === "strike" ? <span className="studio-annotation-strike-line" /> : layer.text}
                  {renderResizeHandles(layer)}
                </button>
              );
            }

            if (layer.kind === "ink") {
              const points = layer.points.map((point) => `${point.x * scale},${(layer.height - point.y) * scale}`).join(" ");
              return (
                <button
                  key={layer.id}
                  type="button"
                  className={`studio-layer-ghost studio-layer-ghost--ink ${layer.locked ? "is-locked" : ""} ${
                    selectedLayerIdSet.has(layer.id) ? "is-active" : ""
                  }`}
                  style={{
                    left: `${layer.x * scale}px`,
                    top: `${pageHeight - (layer.y + layer.height) * scale}px`,
                    width: `${layer.width * scale}px`,
                    height: `${layer.height * scale}px`,
                    cursor:
                      layer.locked
                        ? "not-allowed"
                        : activeTool === "select"
                        ? draggingLayerId === layer.id
                          ? "grabbing"
                          : "grab"
                        : "pointer"
                  }}
                  onClick={(event) => {
                    event.stopPropagation();
                  }}
                  onPointerDown={(event) => beginLayerDrag(event, layer)}
                >
                  <svg viewBox={`0 0 ${layer.width * scale} ${layer.height * scale}`} aria-hidden="true">
                    <polyline
                      points={points}
                      fill="none"
                      stroke={layer.color}
                      strokeWidth={Math.max(1.5, layer.thickness * scale)}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                  {renderResizeHandles(layer)}
                </button>
              );
            }

            return (
              <button
                key={layer.id}
                type="button"
                className={`studio-layer-ghost studio-layer-ghost--image ${layer.locked ? "is-locked" : ""} ${
                  selectedLayerIdSet.has(layer.id) ? "is-active" : ""
                }`}
                style={{
                  left: `${layer.x * scale}px`,
                  top: `${pageHeight - (layer.y + layer.height) * scale}px`,
                  width: `${layer.width * scale}px`,
                  height: `${layer.height * scale}px`,
                  cursor:
                    layer.locked
                      ? "not-allowed"
                      : activeTool === "select"
                      ? draggingLayerId === layer.id
                        ? "grabbing"
                        : "grab"
                      : "pointer"
                }}
                onClick={(event) => {
                  event.stopPropagation();
                }}
                onPointerDown={(event) => beginLayerDrag(event, layer)}
              >
                <img src={layer.dataUrl} alt={layer.fileName} />
                {renderResizeHandles(layer)}
              </button>
            );
          })}
          </div>
      </div>
      </div>
    </article>
  );
}
