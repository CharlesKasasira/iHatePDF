"use client";

import type { EditPageRotationInput } from "../../lib/pdf-api";
import { ReorderableList, ReorderHandle } from "../reorderable-list";
import { PAGE_NUMBER_POSITIONS, RETENTION_OPTIONS } from "./constants";
import type {
  EditorDocumentState,
  EditorDraftDefaults,
  EditorImageLayer,
  EditorLayer,
  EditorRectangleLayer,
  EditorTextLayer
} from "./types";
import { fontFamilyLabel, layerSummary, normalizeNumber, retentionLabel } from "./utils";

export function EditorSidebar({
  state,
  selectedLayer,
  selectedSignatureBox,
  onSelectLayer,
  onUpdateLayer,
  onRemoveSelectedLayer,
  onOutputNameChange,
  onRotationPageChange,
  onRotationDegreesChange,
  onQueuePageRotation,
  onRemovePageRotation,
  onPageNumbersEnabledChange,
  onPageNumbersChange,
  onWatermarkEnabledChange,
  onWatermarkChange,
  onTextDefaultsChange,
  onRectangleDefaultsChange,
  onImageDefaultsChange,
  onSignatureDefaultsChange,
  onOpenImagePicker,
  onOpenSignaturePicker,
  onOpenSignatureChooser,
  onRetentionHoursChange,
  onExport,
  onReorderLayers
}: {
  state: EditorDocumentState;
  selectedLayer: EditorLayer | null;
  selectedSignatureBox: EditorRectangleLayer | null;
  onSelectLayer: (layerId: string | null) => void;
  onUpdateLayer: (layerId: string, updater: (layer: EditorLayer) => EditorLayer) => void;
  onRemoveSelectedLayer: () => void;
  onOutputNameChange: (outputName: string) => void;
  onRotationPageChange: (page: number) => void;
  onRotationDegreesChange: (degrees: EditPageRotationInput["degrees"]) => void;
  onQueuePageRotation: () => void;
  onRemovePageRotation: (page: number) => void;
  onPageNumbersEnabledChange: (enabled: boolean) => void;
  onPageNumbersChange: (patch: Partial<EditorDocumentState["pageNumbers"]>) => void;
  onWatermarkEnabledChange: (enabled: boolean) => void;
  onWatermarkChange: (patch: Partial<EditorDocumentState["watermark"]>) => void;
  onTextDefaultsChange: (patch: Partial<EditorDraftDefaults["text"]>) => void;
  onRectangleDefaultsChange: (patch: Partial<EditorDraftDefaults["rectangle"]>) => void;
  onImageDefaultsChange: (patch: Partial<EditorDraftDefaults["image"]>) => void;
  onSignatureDefaultsChange: (patch: Partial<EditorDraftDefaults["signature"]>) => void;
  onOpenImagePicker: () => void;
  onOpenSignaturePicker: () => void;
  onOpenSignatureChooser: () => void;
  onRetentionHoursChange: (retentionHours: number) => void;
  onExport: () => Promise<void>;
  onReorderLayers: (layers: EditorLayer[]) => void;
}): React.JSX.Element {
  return (
    <aside className="studio-sidebar">
      <div className="studio-panel">
        <div className="studio-panel__eyebrow">Document</div>
        <h2>{state.pdfFile?.name ?? "No PDF loaded"}</h2>
        <p>
          {state.pdfFile
            ? state.isLoadingPreview
              ? "Inspecting the uploaded PDF and loading a live preview..."
              : `${state.pages.length} page${state.pages.length === 1 ? "" : "s"} detected. Click directly on the PDF page to place the current tool.`
            : "Open a PDF, then place layers or configure document-wide edits from the studio sidebar."}
        </p>

        <label htmlFor="studio-output">Export filename</label>
        <input
          id="studio-output"
          value={state.outputName}
          onChange={(event) => onOutputNameChange(event.target.value)}
          placeholder="studio-export.pdf"
        />

        <div className="studio-stage-controls">
          <span>Pages</span>
          <strong>{state.isLoadingPreview ? "Loading..." : state.pages.length}</strong>
        </div>
      </div>

      <div className="studio-panel">
        <div className="studio-panel__eyebrow">Layers</div>
        {state.layers.length === 0 ? (
          <p className="studio-empty-copy">
            No layers yet. Pick a tool, then click directly on the PDF page to drop it in.
          </p>
        ) : (
          <ReorderableList
            items={state.layers}
            onReorder={onReorderLayers}
            className="studio-layer-list"
            disabled={state.busy}
            keyForItem={(layer) => layer.id}
            renderItem={(layer, index) => (
              <button
                type="button"
                className={`studio-layer-card ${
                  state.selection.layerId === layer.id ? "is-active" : ""
                }`}
                onClick={() => onSelectLayer(layer.id)}
              >
                <ReorderHandle label="Drag layer to reorder stack" />
                <span className="studio-layer-card__index">{index + 1}</span>
                <span className="studio-layer-card__content">
                  <strong>
                    {layer.kind === "text"
                      ? "Text"
                      : layer.kind === "rectangle"
                        ? layer.variant === "erase"
                          ? "Erase"
                          : "Block"
                        : "Asset"}
                  </strong>
                  <small>{layerSummary(layer)}</small>
                </span>
                <span className="studio-layer-card__meta">P{layer.page}</span>
              </button>
            )}
          />
        )}
      </div>

      <div className="studio-panel">
        <div className="studio-panel__eyebrow">Document operations</div>
        <div className="studio-form-grid">
          <label>
            Rotate page
            <input
              type="number"
              min={1}
              max={Math.max(1, state.pages.length)}
              value={state.rotationPage}
              onChange={(event) =>
                onRotationPageChange(normalizeNumber(Number(event.target.value), state.rotationPage))
              }
            />
          </label>
          <label>
            Degrees
            <select
              value={state.rotationDegrees}
              onChange={(event) =>
                onRotationDegreesChange(Number(event.target.value) as EditPageRotationInput["degrees"])
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
          onClick={onQueuePageRotation}
        >
          Add page rotation
        </button>

        {state.pageRotations.length > 0 ? (
          <div className="studio-layer-list">
            {state.pageRotations.map((rotation) => (
              <button
                key={`rotation-${rotation.page}`}
                type="button"
                className="studio-layer-card"
                onClick={() => {
                  onRotationPageChange(rotation.page);
                  onRotationDegreesChange(rotation.degrees);
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
                    onRemovePageRotation(rotation.page);
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
              checked={state.pageNumbers.enabled}
              onChange={(event) => onPageNumbersEnabledChange(event.target.checked)}
            />
            <span>Add page numbers</span>
          </label>
        </div>

        {state.pageNumbers.enabled ? (
          <div className="studio-form-grid">
            <label>
              Start at
              <input
                type="number"
                min={1}
                value={state.pageNumbers.startAt}
                onChange={(event) =>
                  onPageNumbersChange({ startAt: normalizeNumber(Number(event.target.value), 1) })
                }
              />
            </label>
            <label>
              Position
              <select
                value={state.pageNumbers.position}
                onChange={(event) =>
                  onPageNumbersChange({
                    position: event.target.value as EditorDocumentState["pageNumbers"]["position"]
                  })
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
                value={state.pageNumbers.fontSize}
                onChange={(event) =>
                  onPageNumbersChange({
                    fontSize: normalizeNumber(Number(event.target.value), 12)
                  })
                }
              />
            </label>
            <label>
              Margin
              <input
                type="number"
                min={0}
                max={144}
                value={state.pageNumbers.margin}
                onChange={(event) =>
                  onPageNumbersChange({ margin: normalizeNumber(Number(event.target.value), 24) })
                }
              />
            </label>
            <label>
              Prefix
              <input
                value={state.pageNumbers.prefix}
                onChange={(event) => onPageNumbersChange({ prefix: event.target.value })}
                placeholder="Page "
              />
            </label>
            <label>
              Color
              <input
                type="color"
                value={state.pageNumbers.color}
                onChange={(event) => onPageNumbersChange({ color: event.target.value })}
              />
            </label>
          </div>
        ) : null}

        <div className="studio-toggle-row">
          <label className="studio-check">
            <input
              type="checkbox"
              checked={state.watermark.enabled}
              onChange={(event) => onWatermarkEnabledChange(event.target.checked)}
            />
            <span>Add watermark</span>
          </label>
        </div>

        {state.watermark.enabled ? (
          <div className="studio-form-grid">
            <label>
              Watermark text
              <input
                value={state.watermark.text}
                onChange={(event) => onWatermarkChange({ text: event.target.value })}
                placeholder="Confidential"
              />
            </label>
            <label>
              Font size
              <input
                type="number"
                min={18}
                max={240}
                value={state.watermark.fontSize}
                onChange={(event) =>
                  onWatermarkChange({ fontSize: normalizeNumber(Number(event.target.value), 64) })
                }
              />
            </label>
            <label>
              Rotation
              <input
                type="number"
                min={-180}
                max={180}
                value={state.watermark.rotation}
                onChange={(event) =>
                  onWatermarkChange({ rotation: normalizeNumber(Number(event.target.value), -32) })
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
                value={state.watermark.opacity}
                onChange={(event) =>
                  onWatermarkChange({ opacity: normalizeNumber(Number(event.target.value), 0.14) })
                }
              />
            </label>
            <label>
              Color
              <input
                type="color"
                value={state.watermark.color}
                onChange={(event) => onWatermarkChange({ color: event.target.value })}
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
          <TextLayerEditor layer={selectedLayer} onUpdateLayer={onUpdateLayer} />
        ) : null}

        {selectedLayer?.kind === "rectangle" ? (
          <RectangleLayerEditor layer={selectedLayer} onUpdateLayer={onUpdateLayer} />
        ) : null}

        {selectedLayer?.kind === "image" ? (
          <ImageLayerEditor layer={selectedLayer} onUpdateLayer={onUpdateLayer} />
        ) : null}

        {!selectedLayer ? (
          <div className="studio-defaults">
            <p>
              Current tool: <strong>{state.tool}</strong>
            </p>

            {state.tool === "text" ? (
              <div className="studio-form-grid">
                <label>
                  Text to place
                  <textarea
                    value={state.draftDefaults.text.text}
                    onChange={(event) => onTextDefaultsChange({ text: event.target.value })}
                    placeholder="Type the text you want to place on the PDF."
                  />
                </label>
                <p>
                  Text defaults use <strong>{fontFamilyLabel(state.draftDefaults.text.fontFamily)}</strong>{" "}
                  at <strong>{state.draftDefaults.text.fontSize}px</strong>.
                </p>
              </div>
            ) : null}

            {state.tool === "highlight" || state.tool === "shape" || state.tool === "erase" ? (
              <div className="studio-form-grid">
                <label>
                  Width
                  <input
                    type="number"
                    min={24}
                    value={state.draftDefaults.rectangle.width}
                    onChange={(event) =>
                      onRectangleDefaultsChange({
                        width: normalizeNumber(Number(event.target.value), 220)
                      })
                    }
                  />
                </label>
                <label>
                  Height
                  <input
                    type="number"
                    min={18}
                    value={state.draftDefaults.rectangle.height}
                    onChange={(event) =>
                      onRectangleDefaultsChange({
                        height: normalizeNumber(Number(event.target.value), 54)
                      })
                    }
                  />
                </label>
                {state.tool !== "erase" ? (
                  <>
                    <label>
                      Color
                      <input
                        type="color"
                        value={state.draftDefaults.rectangle.color}
                        onChange={(event) => onRectangleDefaultsChange({ color: event.target.value })}
                      />
                    </label>
                    <label>
                      Opacity
                      <input
                        type="number"
                        min={0.05}
                        max={1}
                        step={0.05}
                        value={state.draftDefaults.rectangle.opacity}
                        onChange={(event) =>
                          onRectangleDefaultsChange({
                            opacity: normalizeNumber(Number(event.target.value), 0.22)
                          })
                        }
                      />
                    </label>
                  </>
                ) : null}
                {state.tool === "erase" ? (
                  <p>
                    Erase places a white{" "}
                    <strong>
                      {state.draftDefaults.rectangle.width} x {state.draftDefaults.rectangle.height}
                    </strong>{" "}
                    block over PDF content.
                  </p>
                ) : (
                  <p>
                    Shape defaults place a{" "}
                    <strong>
                      {state.draftDefaults.rectangle.width} x {state.draftDefaults.rectangle.height}
                    </strong>{" "}
                    block with{" "}
                    <strong>{Math.round(state.draftDefaults.rectangle.opacity * 100)}%</strong> opacity.
                  </p>
                )}
              </div>
            ) : null}

            {state.tool === "image" ? (
              <div className="studio-form-grid">
                <label>
                  Width
                  <input
                    type="number"
                    min={24}
                    value={state.draftDefaults.image.width}
                    onChange={(event) =>
                      onImageDefaultsChange({
                        width: normalizeNumber(Number(event.target.value), 180)
                      })
                    }
                  />
                </label>
                <label>
                  Height
                  <input
                    type="number"
                    min={24}
                    value={state.draftDefaults.image.height}
                    onChange={(event) =>
                      onImageDefaultsChange({
                        height: normalizeNumber(Number(event.target.value), 88)
                      })
                    }
                  />
                </label>
                <button
                  type="button"
                  className="studio-secondary-button studio-primary-button--full"
                  onClick={onOpenImagePicker}
                >
                  {state.assets.image
                    ? `Replace image (${state.assets.image.fileName})`
                    : "Choose image"}
                </button>
                <p>
                  {state.assets.image
                    ? "Image ready. Click any PDF page to place it."
                    : "Load an image first, then click a PDF page to place it."}
                </p>
              </div>
            ) : null}

            {state.tool === "sign" ? (
              <div className="studio-form-grid">
                <label>
                  Width
                  <input
                    type="number"
                    min={24}
                    value={state.draftDefaults.signature.width}
                    onChange={(event) =>
                      onSignatureDefaultsChange({
                        width: normalizeNumber(Number(event.target.value), 190)
                      })
                    }
                  />
                </label>
                <label>
                  Height
                  <input
                    type="number"
                    min={24}
                    value={state.draftDefaults.signature.height}
                    onChange={(event) =>
                      onSignatureDefaultsChange({
                        height: normalizeNumber(Number(event.target.value), 72)
                      })
                    }
                  />
                </label>
                <button
                  type="button"
                  className="studio-secondary-button studio-primary-button--full"
                  onClick={onOpenSignaturePicker}
                >
                  {state.assets.sign
                    ? `Replace signature (${state.assets.sign.fileName})`
                    : "Choose signature image"}
                </button>
                <p>
                  {state.assets.sign
                    ? "Signature ready. Click any PDF page to stamp it."
                    : "Load a signature image first, then click a PDF page to stamp it."}
                </p>
              </div>
            ) : null}

            {state.tool === "select" ? (
              <p>
                Drag placed layers directly on the PDF to reposition them, pull a selected layer's
                handles to resize it, or double-click text to edit it in place.
              </p>
            ) : null}

            <p>
              Document edits: <strong>{state.pageRotations.length}</strong> rotations,{" "}
              <strong>{state.pageNumbers.enabled ? "page numbers on" : "page numbers off"}</strong>,{" "}
              <strong>{state.watermark.enabled ? "watermark on" : "watermark off"}</strong>.
            </p>
          </div>
        ) : (
          <button type="button" className="studio-danger-button" onClick={onRemoveSelectedLayer}>
            Remove selected layer
          </button>
        )}
      </div>

      <div className="studio-panel">
        <div className="studio-panel__eyebrow">Signature Flow</div>
        <h2>Prepare signing</h2>
        <p>
          Select a rectangle layer as the signature box, then choose whether you will sign it yourself
          or send a request to someone else.
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
          onClick={onOpenSignatureChooser}
          disabled={state.busy}
        >
          Open signing flow
        </button>

        <p
          className={
            state.signatureRequest.status.toLowerCase().includes("failed") ? "error" : "small"
          }
        >
          {state.signatureRequest.status || "Use a rectangle layer to mark the signer area."}
        </p>

        {state.signatureRequest.link ? (
          <a
            className="download studio-download-link"
            href={state.signatureRequest.link}
            target="_blank"
            rel="noreferrer"
          >
            Open signer link
          </a>
        ) : null}
      </div>

      <div className="studio-panel studio-panel--privacy">
        <div className="studio-panel__eyebrow">Privacy & retention</div>
        <h2>Retention window</h2>
        <p>
          Files from this studio are processed on your self-hosted server and stored in <code>./storage</code>.
          The selected window controls when download access expires.
        </p>

        <label htmlFor="retention-hours">Auto-expire downloads after</label>
        <select
          id="retention-hours"
          value={state.retentionHours}
          onChange={(event) => onRetentionHoursChange(Number(event.target.value))}
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
            This is not a browser-only editor. The file leaves the device, is written to your server,
            and auto-expires from download after {retentionLabel(state.retentionHours)}.
          </span>
        </div>
      </div>

      <div className="studio-panel">
        <div className="studio-panel__eyebrow">Export</div>
        <button
          type="button"
          className="studio-primary-button studio-primary-button--full"
          onClick={() => void onExport()}
          disabled={state.busy}
        >
          {state.busy ? "Rendering studio export..." : "Save PDF"}
        </button>
        <p className={state.status.toLowerCase().includes("failed") ? "error" : "small"}>
          {state.status}
        </p>
        {state.downloadUrl ? (
          <a
            className="download studio-download-link"
            href={state.downloadUrl}
            target="_blank"
            rel="noreferrer"
          >
            Download edited PDF
          </a>
        ) : null}
      </div>
    </aside>
  );
}

function TextLayerEditor({
  layer,
  onUpdateLayer
}: {
  layer: EditorTextLayer;
  onUpdateLayer: (layerId: string, updater: (layer: EditorLayer) => EditorLayer) => void;
}): React.JSX.Element {
  return (
    <div className="studio-form-grid">
      <label>
        Text
        <textarea
          value={layer.text}
          onChange={(event) =>
            onUpdateLayer(layer.id, (current) =>
              current.kind === "text" ? { ...current, text: event.target.value } : current
            )
          }
        />
      </label>
      <label>
        Page
        <input
          type="number"
          min={1}
          value={layer.page}
          onChange={(event) =>
            onUpdateLayer(layer.id, (current) =>
              current.kind === "text"
                ? { ...current, page: normalizeNumber(Number(event.target.value), current.page) }
                : current
            )
          }
        />
      </label>
      <label>
        X
        <input
          type="number"
          min={0}
          value={layer.x}
          onChange={(event) =>
            onUpdateLayer(layer.id, (current) =>
              current.kind === "text"
                ? { ...current, x: normalizeNumber(Number(event.target.value), current.x) }
                : current
            )
          }
        />
      </label>
      <label>
        Y
        <input
          type="number"
          min={0}
          value={layer.y}
          onChange={(event) =>
            onUpdateLayer(layer.id, (current) =>
              current.kind === "text"
                ? { ...current, y: normalizeNumber(Number(event.target.value), current.y) }
                : current
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
          value={layer.fontSize}
          onChange={(event) =>
            onUpdateLayer(layer.id, (current) =>
              current.kind === "text"
                ? {
                    ...current,
                    fontSize: normalizeNumber(Number(event.target.value), current.fontSize)
                  }
                : current
            )
          }
        />
      </label>
      <label>
        Typeface
        <select
          value={layer.fontFamily}
          onChange={(event) =>
            onUpdateLayer(layer.id, (current) =>
              current.kind === "text"
                ? {
                    ...current,
                    fontFamily: event.target.value as EditorTextLayer["fontFamily"]
                  }
                : current
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
          value={layer.color}
          onChange={(event) =>
            onUpdateLayer(layer.id, (current) =>
              current.kind === "text" ? { ...current, color: event.target.value } : current
            )
          }
        />
      </label>
      <div className="studio-toggle-row">
        <label className="studio-check">
          <input
            type="checkbox"
            checked={layer.bold}
            onChange={(event) =>
              onUpdateLayer(layer.id, (current) =>
                current.kind === "text" ? { ...current, bold: event.target.checked } : current
              )
            }
          />
          <span>Bold</span>
        </label>
        <label className="studio-check">
          <input
            type="checkbox"
            checked={layer.italic}
            onChange={(event) =>
              onUpdateLayer(layer.id, (current) =>
                current.kind === "text" ? { ...current, italic: event.target.checked } : current
              )
            }
          />
          <span>Italic</span>
        </label>
        <label className="studio-check">
          <input
            type="checkbox"
            checked={layer.underline}
            onChange={(event) =>
              onUpdateLayer(layer.id, (current) =>
                current.kind === "text" ? { ...current, underline: event.target.checked } : current
              )
            }
          />
          <span>Underline</span>
        </label>
      </div>
    </div>
  );
}

function RectangleLayerEditor({
  layer,
  onUpdateLayer
}: {
  layer: EditorRectangleLayer;
  onUpdateLayer: (layerId: string, updater: (layer: EditorLayer) => EditorLayer) => void;
}): React.JSX.Element {
  return (
    <div className="studio-form-grid">
      <label>
        Page
        <input
          type="number"
          min={1}
          value={layer.page}
          onChange={(event) =>
            onUpdateLayer(layer.id, (current) =>
              current.kind === "rectangle"
                ? { ...current, page: normalizeNumber(Number(event.target.value), current.page) }
                : current
            )
          }
        />
      </label>
      <label>
        X
        <input
          type="number"
          min={0}
          value={layer.x}
          onChange={(event) =>
            onUpdateLayer(layer.id, (current) =>
              current.kind === "rectangle"
                ? { ...current, x: normalizeNumber(Number(event.target.value), current.x) }
                : current
            )
          }
        />
      </label>
      <label>
        Y
        <input
          type="number"
          min={0}
          value={layer.y}
          onChange={(event) =>
            onUpdateLayer(layer.id, (current) =>
              current.kind === "rectangle"
                ? { ...current, y: normalizeNumber(Number(event.target.value), current.y) }
                : current
            )
          }
        />
      </label>
      <label>
        Width
        <input
          type="number"
          min={24}
          value={layer.width}
          onChange={(event) =>
            onUpdateLayer(layer.id, (current) =>
              current.kind === "rectangle"
                ? { ...current, width: normalizeNumber(Number(event.target.value), current.width) }
                : current
            )
          }
        />
      </label>
      <label>
        Height
        <input
          type="number"
          min={18}
          value={layer.height}
          onChange={(event) =>
            onUpdateLayer(layer.id, (current) =>
              current.kind === "rectangle"
                ? {
                    ...current,
                    height: normalizeNumber(Number(event.target.value), current.height)
                  }
                : current
            )
          }
        />
      </label>
      {layer.variant !== "erase" ? (
        <>
          <label>
            Color
            <input
              type="color"
              value={layer.color}
              onChange={(event) =>
                onUpdateLayer(layer.id, (current) =>
                  current.kind === "rectangle" ? { ...current, color: event.target.value } : current
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
              value={layer.opacity}
              onChange={(event) =>
                onUpdateLayer(layer.id, (current) =>
                  current.kind === "rectangle"
                    ? {
                        ...current,
                        opacity: normalizeNumber(Number(event.target.value), current.opacity)
                      }
                    : current
                )
              }
            />
          </label>
        </>
      ) : null}
    </div>
  );
}

function ImageLayerEditor({
  layer,
  onUpdateLayer
}: {
  layer: EditorImageLayer;
  onUpdateLayer: (layerId: string, updater: (layer: EditorLayer) => EditorLayer) => void;
}): React.JSX.Element {
  return (
    <div className="studio-form-grid">
      <label>
        Page
        <input
          type="number"
          min={1}
          value={layer.page}
          onChange={(event) =>
            onUpdateLayer(layer.id, (current) =>
              current.kind === "image"
                ? { ...current, page: normalizeNumber(Number(event.target.value), current.page) }
                : current
            )
          }
        />
      </label>
      <label>
        X
        <input
          type="number"
          min={0}
          value={layer.x}
          onChange={(event) =>
            onUpdateLayer(layer.id, (current) =>
              current.kind === "image"
                ? { ...current, x: normalizeNumber(Number(event.target.value), current.x) }
                : current
            )
          }
        />
      </label>
      <label>
        Y
        <input
          type="number"
          min={0}
          value={layer.y}
          onChange={(event) =>
            onUpdateLayer(layer.id, (current) =>
              current.kind === "image"
                ? { ...current, y: normalizeNumber(Number(event.target.value), current.y) }
                : current
            )
          }
        />
      </label>
      <label>
        Width
        <input
          type="number"
          min={24}
          value={layer.width}
          onChange={(event) =>
            onUpdateLayer(layer.id, (current) =>
              current.kind === "image"
                ? { ...current, width: normalizeNumber(Number(event.target.value), current.width) }
                : current
            )
          }
        />
      </label>
      <label>
        Height
        <input
          type="number"
          min={24}
          value={layer.height}
          onChange={(event) =>
            onUpdateLayer(layer.id, (current) =>
              current.kind === "image"
                ? {
                    ...current,
                    height: normalizeNumber(Number(event.target.value), current.height)
                  }
                : current
            )
          }
        />
      </label>
    </div>
  );
}
