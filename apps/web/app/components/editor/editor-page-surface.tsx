"use client";

import { useEffect, useRef, useState } from "react";
import type { EditPageNumbersInput, EditWatermarkInput } from "../../lib/pdf-api";
import type { EditorLayer, EditorPage, EditorTool } from "./types";
import { clamp, cssFontFamily, previewPageNumber } from "./utils";

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
  onMoveLayer: (layerId: string, x: number, y: number) => void;
  onPlaceLayer: (x: number, y: number) => void;
}): React.JSX.Element {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [renderWidth, setRenderWidth] = useState<number>(page.width);
  const [draggingLayerId, setDraggingLayerId] = useState<string | null>(null);

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
                    textDecoration: layer.underline ? "underline" : "none",
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
                    opacity: layer.opacity,
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
              </button>
            );
          })}
        </div>
      </div>
    </article>
  );
}
