"use client";

import { useEffect, useRef, useState } from "react";
import type { EditPageNumbersInput, EditWatermarkInput } from "../../lib/pdf-api";
import type { EditorLayer, EditorPage, EditorTool } from "./types";
import { clamp, cssFontFamily, previewPageNumber } from "./utils";

type ResizeHandle = "nw" | "ne" | "se" | "sw";

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
  previewUrl,
  layers,
  rotationDegrees,
  pageNumbers,
  watermark,
  activeTool,
  selectedLayerId,
  onSelectLayer,
  onUpdateLayer,
  onMoveLayer,
  onPlaceLayer
}: {
  fileName: string;
  page: EditorPage;
  previewUrl: string | null;
  layers: EditorLayer[];
  rotationDegrees: number;
  pageNumbers: EditPageNumbersInput | null;
  watermark: EditWatermarkInput | null;
  activeTool: EditorTool;
  selectedLayerId: string | null;
  onSelectLayer: (layerId: string) => void;
  onUpdateLayer: (layerId: string, updater: (layer: EditorLayer) => EditorLayer) => void;
  onMoveLayer: (layerId: string, x: number, y: number) => void;
  onPlaceLayer: (x: number, y: number) => void;
}): React.JSX.Element {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [renderWidth, setRenderWidth] = useState<number>(page.width);
  const [draggingLayerId, setDraggingLayerId] = useState<string | null>(null);
  const [editingTextLayerId, setEditingTextLayerId] = useState<string | null>(null);

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

  useEffect(() => {
    if (!draggingLayerId) {
      return;
    }

    const stopDragging = (): void => {
      setDraggingLayerId(null);
    };

    window.addEventListener("pointerup", stopDragging);
    window.addEventListener("pointercancel", stopDragging);

    return () => {
      window.removeEventListener("pointerup", stopDragging);
      window.removeEventListener("pointercancel", stopDragging);
    };
  }, [draggingLayerId]);

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
    if (activeTool !== "select") {
      onSelectLayer(layer.id);
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
      const x = clamp(visualLeft / scale, 0, Math.max(0, page.width - layerWidth));
      const y = clamp(
        (surfaceRect.height - visualBottom) / scale,
        0,
        Math.max(0, page.height - layerHeight)
      );

      onMoveLayer(layer.id, x, y);
    };

    onSelectLayer(layer.id);
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
    if (activeTool !== "select" || (layer.kind !== "rectangle" && layer.kind !== "image")) {
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

      onUpdateLayer(layer.id, (current) =>
        current.kind === "rectangle" || current.kind === "image" ? { ...current, ...next } : current
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
      selectedLayerId !== layer.id ||
      (layer.kind !== "rectangle" && layer.kind !== "image")
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

      <div
        ref={wrapperRef}
        className="studio-page-surface"
        style={{ height: `${pageHeight}px`, cursor: activeTool === "select" ? "default" : "crosshair" }}
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
              const isEditing = editingTextLayerId === layer.id;
              const textStyle: React.CSSProperties = {
                left: `${layer.x * scale}px`,
                top: `${pageHeight - layer.y * scale}px`,
                color: layer.color,
                fontSize: `${Math.max(12, layer.fontSize * scale)}px`,
                fontFamily: cssFontFamily(layer.fontFamily),
                fontWeight: layer.bold ? 800 : 600,
                fontStyle: layer.italic ? "italic" : "normal",
                textDecoration: layer.underline ? "underline" : "none"
              };

              if (isEditing) {
                return (
                  <textarea
                    key={layer.id}
                    className="studio-layer-text-editor"
                    style={textStyle}
                    value={layer.text}
                    autoFocus
                    rows={1}
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
                  className={`studio-layer-ghost studio-layer-ghost--text ${
                    selectedLayerId === layer.id ? "is-active" : ""
                  }`}
                  style={{
                    ...textStyle,
                    cursor:
                      activeTool === "select"
                        ? draggingLayerId === layer.id
                          ? "grabbing"
                          : "grab"
                        : "pointer"
                  }}
                  onClick={(event) => {
                    event.stopPropagation();
                    onSelectLayer(layer.id);
                  }}
                  onDoubleClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    onSelectLayer(layer.id);
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
                  className={`studio-layer-ghost studio-layer-ghost--rectangle ${
                    selectedLayerId === layer.id ? "is-active" : ""
                  }`}
                  style={{
                    left: `${layer.x * scale}px`,
                    top: `${pageHeight - (layer.y + layer.height) * scale}px`,
                    width: `${layer.width * scale}px`,
                    height: `${layer.height * scale}px`,
                    background: colorWithOpacity(layer.color, layer.opacity),
                    cursor:
                      activeTool === "select"
                        ? draggingLayerId === layer.id
                          ? "grabbing"
                          : "grab"
                        : "pointer"
                  }}
                  onClick={(event) => {
                    event.stopPropagation();
                    onSelectLayer(layer.id);
                  }}
                  onPointerDown={(event) => beginLayerDrag(event, layer)}
                >
                  {renderResizeHandles(layer)}
                </button>
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
                  height: `${layer.height * scale}px`,
                  cursor:
                    activeTool === "select"
                      ? draggingLayerId === layer.id
                        ? "grabbing"
                        : "grab"
                      : "pointer"
                }}
                onClick={(event) => {
                  event.stopPropagation();
                  onSelectLayer(layer.id);
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
    </article>
  );
}
