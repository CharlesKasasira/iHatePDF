"use client";

import {
  BringToFront,
  ChevronLeft,
  ChevronRight,
  ChevronsDown,
  ChevronsUp,
  Grid3X3,
  Maximize2,
  Minus,
  PanelTop,
  Plus,
  Redo2,
  SendToBack,
  Undo2
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { EditPageRotationInput, FileShareResponse, PdfEntity, PdfIntelligenceResponse } from "../../lib/pdf-api";
import { formatEatDateTime } from "../../lib/time";
import { ReorderableList, ReorderHandle } from "../reorderable-list";
import { PAGE_NUMBER_POSITIONS, RETENTION_OPTIONS } from "./constants";
import type {
  EditorDocumentModel,
  EditorDocumentState,
  EditorDraftDefaults,
  EditorImageLayer,
  EditorLayer,
  EditorRectangleLayer,
  EditorTextLayer
} from "./types";
import { fileToDataUrl, fontFamilyLabel, layerSummary, normalizeNumber, retentionLabel } from "./utils";

export function EditorSidebar({
  state,
  selectedLayer,
  selectedLayerIds,
  selectedSignatureBox,
  onSelectLayer,
  onUpdateLayer,
  onRemoveSelectedLayer,
  onToggleSelectedLayersLock,
  onOutputNameChange,
  onRotationPageChange,
  onRotationDegreesChange,
  onQueuePageRotation,
  onRemovePageRotation,
  onPageNumbersEnabledChange,
  onPageNumbersChange,
  onWatermarkEnabledChange,
  onWatermarkChange,
  onAddTextReplacement,
  onRemoveTextReplacement,
  onActivePageChange,
  onZoomChange,
  onFitModeChange,
  onSnapToGridChange,
  onShowGuidesChange,
  onFormValueChange,
  onJumpToPage,
  onUndo,
  onRedo,
  onTextDefaultsChange,
  onRectangleDefaultsChange,
  onImageDefaultsChange,
  onSignatureDefaultsChange,
  onOpenImagePicker,
  onOpenSignaturePicker,
  onOpenSignatureChooser,
  onRetentionHoursChange,
  onOutputModeChange,
  onExport,
  onReorderLayers,
  onMoveSelectedLayersInStack,
  invite,
  intelligence,
  onInviteEmailChange,
  onInviteMessageChange,
  onInviteExpiresInHoursChange,
  onCreateEditorInvite,
  onCopyEditorInvite
}: {
  state: EditorDocumentState;
  selectedLayer: EditorLayer | null;
  selectedLayerIds: string[];
  selectedSignatureBox: EditorRectangleLayer | null;
  onSelectLayer: (layerId: string | null, additive?: boolean) => void;
  onUpdateLayer: (layerId: string, updater: (layer: EditorLayer) => EditorLayer) => void;
  onRemoveSelectedLayer: () => void;
  onToggleSelectedLayersLock: (locked: boolean) => void;
  onOutputNameChange: (outputName: string) => void;
  onRotationPageChange: (page: number) => void;
  onRotationDegreesChange: (degrees: EditPageRotationInput["degrees"]) => void;
  onQueuePageRotation: () => void;
  onRemovePageRotation: (page: number) => void;
  onPageNumbersEnabledChange: (enabled: boolean) => void;
  onPageNumbersChange: (patch: Partial<EditorDocumentModel["operations"]["pageNumbers"]>) => void;
  onWatermarkEnabledChange: (enabled: boolean) => void;
  onWatermarkChange: (patch: Partial<EditorDocumentModel["operations"]["watermark"]>) => void;
  onAddTextReplacement: (replacement: EditorDocumentModel["operations"]["textReplacements"][number]) => void;
  onRemoveTextReplacement: (index: number) => void;
  onActivePageChange: (page: number) => void;
  onZoomChange: (zoom: number) => void;
  onFitModeChange: (fitMode: EditorDocumentModel["viewport"]["fitMode"]) => void;
  onSnapToGridChange: (enabled: boolean) => void;
  onShowGuidesChange: (enabled: boolean) => void;
  onFormValueChange: (name: string, value: EditorDocumentModel["formValues"][string]) => void;
  onJumpToPage: (page: number) => void;
  onUndo: () => void;
  onRedo: () => void;
  onTextDefaultsChange: (patch: Partial<EditorDraftDefaults["text"]>) => void;
  onRectangleDefaultsChange: (patch: Partial<EditorDraftDefaults["rectangle"]>) => void;
  onImageDefaultsChange: (patch: Partial<EditorDraftDefaults["image"]>) => void;
  onSignatureDefaultsChange: (patch: Partial<EditorDraftDefaults["signature"]>) => void;
  onOpenImagePicker: () => void;
  onOpenSignaturePicker: () => void;
  onOpenSignatureChooser: () => void;
  onRetentionHoursChange: (retentionHours: number) => void;
  onOutputModeChange: (outputMode: EditorDocumentModel["export"]["outputMode"]) => void;
  onExport: () => Promise<void>;
  onReorderLayers: (layers: EditorLayer[]) => void;
  onMoveSelectedLayersInStack: (direction: "front" | "forward" | "backward" | "back") => void;
  invite: {
    email: string;
    message: string;
    expiresInHours: number;
    expiryOptions: Array<{ value: number; label: string }>;
    busy: boolean;
    status: string;
    share: FileShareResponse | null;
  };
  intelligence: {
    data: PdfIntelligenceResponse | null;
    busy: boolean;
    status: string;
  };
  onInviteEmailChange: (email: string) => void;
  onInviteMessageChange: (message: string) => void;
  onInviteExpiresInHoursChange: (expiresInHours: number) => void;
  onCreateEditorInvite: () => void;
  onCopyEditorInvite: () => void;
}): React.JSX.Element {
  const document = state.document;
  const operations = document.operations;
  const signatureRequest = document.signatures.request;
  const exportState = document.export;
  const pageCount = Math.max(1, document.pages.length);
  const activePage = Math.min(Math.max(1, document.viewport.activePage ?? 1), pageCount);
  const selectedLockedCount = selectedLayerIds.filter((layerId) =>
    document.layers.some((layer) => layer.id === layerId && layer.locked)
  ).length;
  const [pageInput, setPageInput] = useState(String(activePage));
  const [intelligenceQuery, setIntelligenceQuery] = useState("");
  const [replacementFind, setReplacementFind] = useState("");
  const [replacementText, setReplacementText] = useState("");
  const [replacementPage, setReplacementPage] = useState("");
  const [replacementMatchCase, setReplacementMatchCase] = useState(false);

  useEffect(() => {
    setPageInput(String(activePage));
  }, [activePage]);

  const commitPageInput = (): void => {
    const requestedPage = normalizeNumber(Number(pageInput), activePage);
    const nextPage = Math.min(Math.max(1, requestedPage), pageCount);
    setPageInput(String(nextPage));
    onJumpToPage(nextPage);
  };

  const changeZoom = (delta: number): void => {
    onZoomChange(Number((document.viewport.zoom + delta).toFixed(2)));
  };

  const zoomPresets = [0.5, 0.75, 1, 1.25, 1.5, 2];

  const intelligenceMatches = useMemo(() => {
    const query = intelligenceQuery.trim().toLowerCase();
    if (!query || !intelligence.data) {
      return [];
    }

    return intelligence.data.text.sampleLines
      .filter((line) => line.toLowerCase().includes(query))
      .slice(0, 8);
  }, [intelligence.data, intelligenceQuery]);

  return (
    <aside className="studio-sidebar">
      <div className="studio-panel">
        <div className="studio-panel__eyebrow">Document</div>
        <h2>{document.file?.name ?? "No PDF loaded"}</h2>
        <p>
          {document.file
            ? state.isLoadingPreview
              ? "Inspecting the uploaded PDF and loading a live preview..."
              : `${document.pages.length} page${document.pages.length === 1 ? "" : "s"} detected. Click directly on the PDF page to place the current tool.`
            : "Open a PDF, then place layers or configure document-wide edits from the studio sidebar."}
        </p>

        <label htmlFor="studio-output">Export filename</label>
        <input
          id="studio-output"
          value={exportState.outputName}
          onChange={(event) => onOutputNameChange(event.target.value)}
          placeholder="studio-export.pdf"
        />

        <div className="studio-navigation-controls">
          <div className="studio-history-controls" aria-label="Undo and redo">
            <button
              type="button"
              className="studio-fit-button"
              onClick={onUndo}
              disabled={state.history.past.length === 0}
              title="Undo"
            >
              <Undo2 aria-hidden="true" size={14} />
              Undo
            </button>
            <button
              type="button"
              className="studio-fit-button"
              onClick={onRedo}
              disabled={state.history.future.length === 0}
              title="Redo"
            >
              <Redo2 aria-hidden="true" size={14} />
              Redo
            </button>
          </div>

          <div className="studio-page-jump">
            <button
              type="button"
              className="studio-icon-button"
              onClick={() => onJumpToPage(activePage - 1)}
              disabled={!document.file || activePage <= 1}
              aria-label="Previous page"
              title="Previous page"
            >
              <ChevronLeft aria-hidden="true" size={16} />
            </button>
            <label htmlFor="studio-page-jump">
              <span>Page</span>
              <input
                id="studio-page-jump"
                type="number"
                min={1}
                max={pageCount}
                value={state.isLoadingPreview ? "" : pageInput}
                disabled={!document.file || state.isLoadingPreview}
                onChange={(event) => {
                  setPageInput(event.target.value);
                }}
                onBlur={commitPageInput}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.currentTarget.blur();
                  }
                }}
              />
              <strong>of {state.isLoadingPreview ? "..." : pageCount}</strong>
            </label>
            <button
              type="button"
              className="studio-icon-button"
              onClick={() => onJumpToPage(activePage + 1)}
              disabled={!document.file || activePage >= pageCount}
              aria-label="Next page"
              title="Next page"
            >
              <ChevronRight aria-hidden="true" size={16} />
            </button>
          </div>

          <div className="studio-zoom-controls">
            <button
              type="button"
              className="studio-icon-button"
              onClick={() => changeZoom(-0.1)}
              disabled={document.viewport.zoom <= 0.5}
              aria-label="Zoom out"
              title="Zoom out"
            >
              <Minus aria-hidden="true" size={15} />
            </button>
            <strong>{Math.round(document.viewport.zoom * 100)}%</strong>
            <button
              type="button"
              className="studio-icon-button"
              onClick={() => changeZoom(0.1)}
              disabled={document.viewport.zoom >= 2}
              aria-label="Zoom in"
              title="Zoom in"
            >
              <Plus aria-hidden="true" size={15} />
            </button>
          </div>

          <div className="studio-fit-controls" aria-label="Canvas fit mode">
            <button
              type="button"
              className={`studio-fit-button ${document.viewport.fitMode === "fit-width" ? "is-active" : ""}`}
              onClick={() => onFitModeChange("fit-width")}
              title="Fit width"
            >
              <PanelTop aria-hidden="true" size={14} />
              Fit width
            </button>
            <button
              type="button"
              className={`studio-fit-button ${document.viewport.fitMode === "fit-page" ? "is-active" : ""}`}
              onClick={() => onFitModeChange("fit-page")}
              title="Fit page"
            >
              <Maximize2 aria-hidden="true" size={14} />
              Fit page
            </button>
          </div>

          <div className="studio-zoom-presets" aria-label="Zoom presets">
            {zoomPresets.map((preset) => (
              <button
                key={preset}
                type="button"
                className={`studio-preset-button ${
                  document.viewport.fitMode === "manual" && Math.abs(document.viewport.zoom - preset) < 0.01
                    ? "is-active"
                    : ""
                }`}
                onClick={() => onZoomChange(preset)}
              >
                {Math.round(preset * 100)}%
              </button>
            ))}
          </div>

          <div className="studio-snap-controls">
            <label className="studio-check">
              <input
                type="checkbox"
                checked={document.viewport.snapToGrid}
                onChange={(event) => onSnapToGridChange(event.target.checked)}
              />
              <Grid3X3 aria-hidden="true" size={14} />
              <span>Snap grid</span>
            </label>
            <label className="studio-check">
              <input
                type="checkbox"
                checked={document.viewport.showGuides}
                onChange={(event) => onShowGuidesChange(event.target.checked)}
              />
              <span>Guides</span>
            </label>
          </div>
        </div>
      </div>

      <div className="studio-panel">
        <div className="studio-panel__eyebrow">Document intelligence</div>
        <h2>Find and understand</h2>
        <p>
          {intelligence.busy
            ? "Reading embedded text, fields, signatures, and important entities..."
            : intelligence.data
              ? intelligence.data.text.ocrReason
              : document.file
                ? intelligence.status || "Document intelligence will appear after preview loading."
                : "Open a PDF to analyze text, forms, signatures, dates, emails, names, and totals."}
        </p>

        <label htmlFor="studio-intelligence-search">Search extracted text</label>
        <input
          id="studio-intelligence-search"
          value={intelligenceQuery}
          onChange={(event) => setIntelligenceQuery(event.target.value)}
          placeholder="Search dates, names, totals..."
          disabled={!intelligence.data}
        />

        {intelligenceMatches.length > 0 ? (
          <div className="studio-intelligence-results">
            {intelligenceMatches.map((line) => (
              <span key={line}>{line}</span>
            ))}
          </div>
        ) : intelligenceQuery.trim() && intelligence.data ? (
          <p className="studio-empty-copy">No extracted text matches yet.</p>
        ) : null}

        {intelligence.data ? (
          <>
            <div className="studio-intelligence-metrics">
              <span>
                <strong>{intelligence.data.pageCount}</strong>
                Pages
              </span>
              <span>
                <strong>{formatBytes(intelligence.data.sizeBytes)}</strong>
                File size
              </span>
              <span>
                <strong>{intelligence.data.detection.imageCount}</strong>
                Images
              </span>
              <span>
                <strong>{intelligence.data.text.characterCount.toLocaleString()}</strong>
                Text chars
              </span>
            </div>

            <div className="studio-intelligence-grid">
              <span className={intelligence.data.text.ocrRecommended ? "is-warn" : "is-ok"}>
                OCR {intelligence.data.text.ocrRecommended ? "recommended" : "not needed"}
              </span>
              <span className={intelligence.data.detection.scannedLikely ? "is-warn" : "is-ok"}>
                Scan {intelligence.data.detection.scannedLikely ? "likely" : "unlikely"}
              </span>
              <span className={intelligence.data.detection.hasAcroForm ? "is-ok" : ""}>
                Forms {intelligence.data.detection.hasAcroForm ? "detected" : "not found"}
              </span>
              <span className={intelligence.data.detection.hasSignatureFields ? "is-ok" : ""}>
                Signature fields {intelligence.data.detection.hasSignatureFields ? "found" : "none"}
              </span>
              <span className={intelligence.data.detection.encrypted ? "is-warn" : "is-ok"}>
                Encryption {intelligence.data.detection.encrypted ? "detected" : "none"}
              </span>
              <span className={intelligence.data.detection.hasRedactionRisk ? "is-warn" : "is-ok"}>
                Redaction risk {intelligence.data.detection.hasRedactionRisk ? "found" : "low"}
              </span>
            </div>

            <div className="studio-intelligence-block">
              <strong>Compression estimate</strong>
              <span>
                About {intelligence.data.compression.estimatedSavingsPercent}% smaller, down to roughly{" "}
                {formatBytes(intelligence.data.compression.estimatedOutputBytes)}.
              </span>
              <small>
                Confidence: {intelligence.data.compression.confidence}. {intelligence.data.compression.reason}
              </small>
            </div>

            {intelligence.data.recommendedWorkflow.length > 0 ? (
              <div className="studio-intelligence-block">
                <strong>Recommended workflow</strong>
                <div className="studio-workflow-chips">
                  {intelligence.data.recommendedWorkflow.map((step, index) => (
                    <span key={`${step}-${index}`}>
                      <small>{index + 1}</small>
                      {step}
                    </span>
                  ))}
                </div>
              </div>
            ) : null}

            {intelligence.data.suggestedActions.length > 0 ? (
              <div className="studio-intelligence-block">
                <strong>Suggested actions</strong>
                <div className="studio-action-chip-list">
                  {intelligence.data.suggestedActions.map((action) => (
                    <span key={action.action} title={action.reason}>
                      {action.label}
                    </span>
                  ))}
                </div>
                {intelligence.data.suggestedActions.slice(0, 3).map((action) => (
                  <small key={`${action.action}-reason`}>{action.reason}</small>
                ))}
              </div>
            ) : null}

            {intelligence.data.fileRisks.length > 0 ? (
              <div className="studio-risk-list">
                {intelligence.data.fileRisks.map((risk) => (
                  <div key={`${risk.level}-${risk.label}`} className={`studio-risk-card is-${risk.level}`}>
                    <strong>{risk.label}</strong>
                    <span>{risk.detail}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="studio-risk-card is-info">
                <strong>No major file risks detected</strong>
                <span>The document looks safe for normal editing and export workflows.</span>
              </div>
            )}

            {intelligence.data.summary.length > 0 ? (
              <div className="studio-intelligence-block">
                <strong>Summary</strong>
                {intelligence.data.summary.map((line) => (
                  <span key={line}>{line}</span>
                ))}
              </div>
            ) : null}

            <EntityList label="Emails" entities={intelligence.data.entities.emails} />
            <EntityList label="Dates" entities={intelligence.data.entities.dates} />
            <EntityList label="Names" entities={intelligence.data.entities.names} />
            <EntityList label="Invoice totals" entities={intelligence.data.entities.invoiceTotals} />

            {intelligence.data.redactionCandidates.length > 0 ? (
              <div className="studio-intelligence-block studio-intelligence-block--warning">
                <strong>Redaction candidates</strong>
                <span>
                  These values need true content removal for safe redaction. White cover boxes are only
                  visual masking.
                </span>
                {intelligence.data.redactionCandidates.slice(0, 8).map((candidate) => (
                  <small key={`${candidate.kind}-${candidate.value}`}>
                    {candidate.kind}: {candidate.value}
                  </small>
                ))}
              </div>
            ) : null}
          </>
        ) : null}

        <div className="studio-intelligence-block">
          <strong>Text replacement</strong>
          <span>Find existing text, remove its underlying page content, then place replacement text in the same region.</span>
          <div className="studio-form-grid">
            <label>
              Find
              <input value={replacementFind} onChange={(event) => setReplacementFind(event.target.value)} />
            </label>
            <label>
              Replace with
              <input value={replacementText} onChange={(event) => setReplacementText(event.target.value)} />
            </label>
            <label>
              Page
              <input
                type="number"
                min={1}
                max={pageCount}
                value={replacementPage}
                onChange={(event) => setReplacementPage(event.target.value)}
                placeholder="All"
              />
            </label>
            <label className="studio-check">
              <input
                type="checkbox"
                checked={replacementMatchCase}
                onChange={(event) => setReplacementMatchCase(event.target.checked)}
              />
              <span>Match case</span>
            </label>
          </div>
          <button
            type="button"
            className="studio-secondary-button studio-primary-button--full"
            onClick={() => {
              if (!replacementFind.trim()) {
                return;
              }
              onAddTextReplacement({
                find: replacementFind.trim(),
                replace: replacementText,
                matchCase: replacementMatchCase,
                page: replacementPage ? normalizeNumber(Number(replacementPage), activePage) : undefined,
                color: "#111827"
              });
              setReplacementFind("");
              setReplacementText("");
            }}
          >
            Queue replacement
          </button>
          {operations.textReplacements.length > 0 ? (
            <div className="studio-layer-list">
              {operations.textReplacements.map((replacement, index) => (
                <button
                  key={`${replacement.find}-${index}`}
                  type="button"
                  className="studio-layer-card"
                  onClick={() => onRemoveTextReplacement(index)}
                >
                  <span className="studio-layer-card__index">T</span>
                  <span className="studio-layer-card__content">
                    <strong>{replacement.find}</strong>
                    <small>{replacement.replace || "(blank)"} {replacement.page ? `on page ${replacement.page}` : "throughout document"}</small>
                  </span>
                  <span className="studio-layer-card__meta">Remove</span>
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </div>

      <div className="studio-panel">
        <div className="studio-panel__eyebrow">Form fields</div>
        <h2>Fill PDF form</h2>
        {document.formFields.length === 0 ? (
          <p className="studio-empty-copy">No AcroForm fields were detected in this PDF.</p>
        ) : (
          <div className="studio-form-field-list">
            {document.formFields.map((field) => {
              const value = document.formValues[field.name] ?? field.value ?? "";
              const firstWidget = field.widgets[0];

              if (field.type === "checkbox") {
                return (
                  <label key={field.name} className="studio-form-field studio-form-field--check">
                    <input
                      type="checkbox"
                      checked={Boolean(value)}
                      onChange={(event) => onFormValueChange(field.name, event.target.checked)}
                    />
                    <span>
                      <strong>{field.name}</strong>
                      <small>{firstWidget?.pageNumber ? `Page ${firstWidget.pageNumber}` : "Checkbox"}</small>
                    </span>
                  </label>
                );
              }

              if (field.type === "dropdown" || field.type === "radio" || field.type === "option-list") {
                const selected = Array.isArray(value) ? value[0] ?? "" : String(value ?? "");
                return (
                  <label key={field.name} className="studio-form-field">
                    <span>{field.name}</span>
                    <select value={selected} onChange={(event) => onFormValueChange(field.name, event.target.value)}>
                      <option value="">Choose...</option>
                      {field.options.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                    <small>{firstWidget?.pageNumber ? `Page ${firstWidget.pageNumber}` : field.type}</small>
                  </label>
                );
              }

              if (field.type === "signature") {
                return (
                  <div key={field.name} className="studio-form-field">
                    <span>{field.name}</span>
                    <small>Signature field detected. Use the Sign tool or signing workflow to place a visible signature.</small>
                  </div>
                );
              }

              if (field.type === "button" || field.type === "unknown") {
                return (
                  <div key={field.name} className="studio-form-field">
                    <span>{field.name}</span>
                    <small>{field.type === "button" ? "Button fields are detected but not fillable." : "Unsupported field type."}</small>
                  </div>
                );
              }

              return (
                <label key={field.name} className="studio-form-field">
                  <span>{field.name}</span>
                  <input
                    value={Array.isArray(value) ? value.join(", ") : String(value ?? "")}
                    onChange={(event) => onFormValueChange(field.name, event.target.value)}
                  />
                  <small>{firstWidget?.pageNumber ? `Page ${firstWidget.pageNumber}` : "Text field"}</small>
                </label>
              );
            })}
          </div>
        )}
      </div>

      <div className="studio-panel">
        <div className="studio-panel__eyebrow">Layers</div>
        {document.layers.length === 0 ? (
          <p className="studio-empty-copy">
            No layers yet. Pick a tool, then click directly on the PDF page to drop it in.
          </p>
        ) : (
          <ReorderableList
            items={[...document.layers].reverse()}
            onReorder={(visualLayers) => onReorderLayers([...visualLayers].reverse())}
            className="studio-layer-list"
            disabled={state.busy || document.layers.some((layer) => layer.locked)}
            keyForItem={(layer) => layer.id}
            renderItem={(layer, index) => (
              <button
                type="button"
                className={`studio-layer-card ${layer.locked ? "is-locked" : ""} ${
                  selectedLayerIds.includes(layer.id) ? "is-active" : ""
                }`}
                onClick={(event) => onSelectLayer(layer.id, event.shiftKey || event.metaKey || event.ctrlKey)}
              >
                <ReorderHandle label={layer.locked ? "Layer locked" : "Drag layer to reorder stack"} />
                <span className="studio-layer-card__index">{document.layers.length - index}</span>
                <span className="studio-layer-card__content">
                  <strong>
                    {layer.kind === "text"
                      ? "Text"
                      : layer.kind === "rectangle"
                        ? layer.variant === "erase"
                          ? "Erase"
                          : layer.variant === "redact"
                            ? "Redact"
                          : "Block"
                        : layer.kind === "annotation"
                          ? layer.variant === "strike"
                            ? "Strike"
                            : layer.variant === "sticky"
                              ? "Sticky"
                              : "Comment"
                          : layer.kind === "ink"
                            ? "Ink"
                        : "Asset"}
                  </strong>
                  <small>{layerSummary(layer)}</small>
                </span>
                <span className="studio-layer-card__meta">{layer.locked ? "Locked" : `P${layer.page}`}</span>
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
              max={Math.max(1, document.pages.length)}
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

        {operations.pageRotations.length > 0 ? (
          <div className="studio-layer-list">
            {operations.pageRotations.map((rotation) => (
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
              checked={operations.pageNumbers.enabled}
              onChange={(event) => onPageNumbersEnabledChange(event.target.checked)}
            />
            <span>Add page numbers</span>
          </label>
        </div>

        {operations.pageNumbers.enabled ? (
          <div className="studio-form-grid">
            <label>
              Start at
              <input
                type="number"
                min={1}
                value={operations.pageNumbers.startAt}
                onChange={(event) =>
                  onPageNumbersChange({ startAt: normalizeNumber(Number(event.target.value), 1) })
                }
              />
            </label>
            <label>
              Position
              <select
                value={operations.pageNumbers.position}
                onChange={(event) =>
                  onPageNumbersChange({
                    position: event.target.value as EditorDocumentModel["operations"]["pageNumbers"]["position"]
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
                value={operations.pageNumbers.fontSize}
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
                value={operations.pageNumbers.margin}
                onChange={(event) =>
                  onPageNumbersChange({ margin: normalizeNumber(Number(event.target.value), 24) })
                }
              />
            </label>
            <label>
              Prefix
              <input
                value={operations.pageNumbers.prefix}
                onChange={(event) => onPageNumbersChange({ prefix: event.target.value })}
                placeholder="Page "
              />
            </label>
            <label>
              Color
              <input
                type="color"
                value={operations.pageNumbers.color}
                onChange={(event) => onPageNumbersChange({ color: event.target.value })}
              />
            </label>
          </div>
        ) : null}

        <div className="studio-toggle-row">
          <label className="studio-check">
            <input
              type="checkbox"
              checked={operations.watermark.enabled}
              onChange={(event) => onWatermarkEnabledChange(event.target.checked)}
            />
            <span>Add watermark</span>
          </label>
        </div>

        {operations.watermark.enabled ? (
          <div className="studio-form-grid">
            <label>
              Watermark text
              <input
                value={operations.watermark.text}
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
                value={operations.watermark.fontSize}
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
                value={operations.watermark.rotation}
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
                value={operations.watermark.opacity}
                onChange={(event) =>
                  onWatermarkChange({ opacity: normalizeNumber(Number(event.target.value), 0.14) })
                }
              />
            </label>
            <label>
              Color
              <input
                type="color"
                value={operations.watermark.color}
                onChange={(event) => onWatermarkChange({ color: event.target.value })}
              />
            </label>
          </div>
        ) : null}
      </div>

      <div className="studio-panel">
        <div className="studio-panel__eyebrow">
          {selectedLayerIds.length > 1 ? "Selected layers" : selectedLayer ? "Selected layer" : "Tool defaults"}
        </div>

        {selectedLayerIds.length > 1 ? (
          <div className="studio-defaults">
            <p>
              <strong>{selectedLayerIds.length}</strong> layers selected. Use arrow keys to nudge,
              Shift+arrow for larger nudges, or Cmd/Ctrl+D to duplicate.
            </p>
          </div>
        ) : null}

        {selectedLayerIds.length > 0 ? (
          <div className="studio-stack-actions" aria-label="Layer lock">
            <button type="button" className="studio-fit-button" onClick={() => onToggleSelectedLayersLock(true)}>
              Lock
            </button>
            <button type="button" className="studio-fit-button" onClick={() => onToggleSelectedLayersLock(false)}>
              Unlock
            </button>
            <span className="studio-layer-card__meta">
              {selectedLockedCount > 0 ? `${selectedLockedCount} locked` : "Unlocked"}
            </span>
          </div>
        ) : null}

        {selectedLockedCount > 0 ? (
          <p className="studio-empty-copy">Unlock selected layers before resizing, moving, editing, deleting, duplicating, or changing stack order.</p>
        ) : null}

        {selectedLayerIds.length > 0 ? (
          <div className="studio-stack-actions" aria-label="Layer order">
            <button type="button" className="studio-fit-button" disabled={selectedLockedCount > 0} onClick={() => onMoveSelectedLayersInStack("front")}>
              <BringToFront aria-hidden="true" size={14} />
              Front
            </button>
            <button type="button" className="studio-fit-button" disabled={selectedLockedCount > 0} onClick={() => onMoveSelectedLayersInStack("forward")}>
              <ChevronsUp aria-hidden="true" size={14} />
              Forward
            </button>
            <button type="button" className="studio-fit-button" disabled={selectedLockedCount > 0} onClick={() => onMoveSelectedLayersInStack("backward")}>
              <ChevronsDown aria-hidden="true" size={14} />
              Backward
            </button>
            <button type="button" className="studio-fit-button" disabled={selectedLockedCount > 0} onClick={() => onMoveSelectedLayersInStack("back")}>
              <SendToBack aria-hidden="true" size={14} />
              Back
            </button>
          </div>
        ) : null}

        {selectedLayerIds.length <= 1 && selectedLayer?.kind === "text" && !selectedLayer.locked ? (
          <TextLayerEditor layer={selectedLayer} onUpdateLayer={onUpdateLayer} />
        ) : null}

        {selectedLayerIds.length <= 1 && selectedLayer?.kind === "rectangle" && !selectedLayer.locked ? (
          <RectangleLayerEditor layer={selectedLayer} onUpdateLayer={onUpdateLayer} />
        ) : null}

        {selectedLayerIds.length <= 1 && selectedLayer?.kind === "image" && !selectedLayer.locked ? (
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
                <label>
                  Width
                  <input
                    type="number"
                    min={40}
                    max={2000}
                    value={state.draftDefaults.text.width}
                    onChange={(event) =>
                      onTextDefaultsChange({ width: normalizeNumber(Number(event.target.value), 220) })
                    }
                  />
                </label>
                <label>
                  Align
                  <select
                    value={state.draftDefaults.text.align}
                    onChange={(event) =>
                      onTextDefaultsChange({ align: event.target.value as EditorTextLayer["align"] })
                    }
                  >
                    <option value="left">Left</option>
                    <option value="center">Center</option>
                    <option value="right">Right</option>
                  </select>
                </label>
                <label>
                  Line height
                  <input
                    type="number"
                    min={0.8}
                    max={3}
                    step={0.05}
                    value={state.draftDefaults.text.lineHeight}
                    onChange={(event) =>
                      onTextDefaultsChange({ lineHeight: normalizeNumber(Number(event.target.value), 1.2) })
                    }
                  />
                </label>
                <label>
                  Custom font
                  <input
                    type="file"
                    accept=".ttf,.otf,font/ttf,font/otf"
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (!file) {
                        return;
                      }
                      void fileToDataUrl(file).then((dataUrl) =>
                        onTextDefaultsChange({
                          customFont: {
                            name: file.name,
                            dataUrl
                          }
                        })
                      );
                    }}
                  />
                </label>
                {state.draftDefaults.text.customFont ? (
                  <button
                    type="button"
                    className="studio-fit-button"
                    onClick={() => onTextDefaultsChange({ customFont: null })}
                  >
                    Remove {state.draftDefaults.text.customFont.name}
                  </button>
                ) : null}
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
              Document edits: <strong>{operations.pageRotations.length}</strong> rotations,{" "}
              <strong>{operations.pageNumbers.enabled ? "page numbers on" : "page numbers off"}</strong>,{" "}
              <strong>{operations.watermark.enabled ? "watermark on" : "watermark off"}</strong>.
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
            signatureRequest.status.toLowerCase().includes("failed") ? "error" : "small"
          }
        >
          {signatureRequest.status || "Use a rectangle layer to mark the signer area."}
        </p>

        {signatureRequest.link ? (
          <a
            className="download studio-download-link"
            href={signatureRequest.link}
            target="_blank"
            rel="noreferrer"
          >
            Open signer link
          </a>
        ) : null}
      </div>

      <div className="studio-panel">
        <div className="studio-panel__eyebrow">Collaboration</div>
        <h2>Invite collaborators</h2>
        <p>
          Send an editor invite link for this PDF. Collaborators open it in the editor and save their
          own exported copy.
        </p>

        <label htmlFor="editor-invite-email">Recipient email</label>
        <input
          id="editor-invite-email"
          type="email"
          value={invite.email}
          onChange={(event) => onInviteEmailChange(event.target.value)}
          placeholder="name@example.com"
          disabled={state.busy || invite.busy}
        />

        <label htmlFor="editor-invite-expiry">Invite expires after</label>
        <select
          id="editor-invite-expiry"
          value={invite.expiresInHours}
          onChange={(event) => onInviteExpiresInHoursChange(Number(event.target.value))}
          disabled={state.busy || invite.busy}
        >
          {invite.expiryOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>

        <label htmlFor="editor-invite-message">Message</label>
        <textarea
          id="editor-invite-message"
          value={invite.message}
          onChange={(event) => onInviteMessageChange(event.target.value)}
          placeholder="Add a short note for the collaborator"
          disabled={state.busy || invite.busy}
        />

        <button
          type="button"
          className="studio-primary-button studio-primary-button--full"
          onClick={onCreateEditorInvite}
          disabled={state.busy || invite.busy || !document.file}
        >
          {invite.busy ? "Creating invite..." : invite.email.trim() ? "Send editor invite" : "Create editor link"}
        </button>

        {invite.status ? (
          <p className={invite.status.toLowerCase().includes("failed") ? "error" : "small"}>
            {invite.status}
          </p>
        ) : (
          <p className="small">Open a PDF, then create an invite link or email it directly.</p>
        )}

        {invite.share ? (
          <div className="share-result">
            <div>
              <strong>{invite.share.fileName}</strong>
              <span>Expires {formatEatDateTime(invite.share.expiresAt)}</span>
            </div>
            <input readOnly value={invite.share.shareUrl} aria-label="Editor invite link" />
            <div className="row-actions">
              <button type="button" onClick={onCopyEditorInvite}>
                Copy link
              </button>
              <a className="download" href={invite.share.shareUrl} target="_blank" rel="noreferrer">
                Open invite
              </a>
            </div>
          </div>
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
          value={exportState.retentionHours}
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
            and auto-expires from download after {retentionLabel(exportState.retentionHours)}.
          </span>
        </div>
      </div>

      <div className="studio-panel">
        <div className="studio-panel__eyebrow">Export</div>
        <div className="studio-form-grid">
          <label>
            PDF output
            <select
              value={exportState.outputMode}
              onChange={(event) =>
                onOutputModeChange(event.target.value as EditorDocumentModel["export"]["outputMode"])
              }
            >
              <option value="flattened">Flattened final PDF</option>
              <option value="editable-annotations">Editable PDF annotations</option>
            </select>
          </label>
          <p className="small">
            Editable export keeps supported text, shape, and ink edits as PDF annotations. Redactions,
            replacements, images, watermarks, and page operations are still finalized into the PDF.
          </p>
        </div>
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
        {document.export.downloadUrl ? (
          <a
            className="download studio-download-link"
            href={document.export.downloadUrl}
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

function EntityList({
  label,
  entities
}: {
  label: string;
  entities: PdfEntity[];
}): React.JSX.Element | null {
  if (entities.length === 0) {
    return null;
  }

  return (
    <div className="studio-intelligence-block">
      <strong>{label}</strong>
      <div className="studio-entity-list">
        {entities.slice(0, 8).map((entity) => (
          <span key={`${label}-${entity.value}`}>
            {entity.value}
            {entity.count > 1 ? <small>{entity.count}</small> : null}
          </span>
        ))}
      </div>
    </div>
  );
}

function formatBytes(value: string | number): string {
  const bytes = typeof value === "string" ? Number(value) : value;
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0 B";
  }

  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const amount = bytes / 1024 ** index;
  return `${amount >= 10 || index === 0 ? Math.round(amount) : amount.toFixed(1)} ${units[index]}`;
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
          <option value="inter">Inter</option>
          <option value="serif">Editorial Serif</option>
          <option value="source-serif">Source Serif</option>
          <option value="mono">Mono</option>
          <option value="roboto-mono">Roboto Mono</option>
          <option value="cursive">Handwritten</option>
        </select>
      </label>
      <label>
        Custom font
        <input
          type="file"
          accept=".ttf,.otf,font/ttf,font/otf"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (!file) {
              return;
            }
            void fileToDataUrl(file).then((dataUrl) =>
              onUpdateLayer(layer.id, (current) =>
                current.kind === "text"
                  ? {
                      ...current,
                      customFont: {
                        name: file.name,
                        dataUrl
                      }
                    }
                  : current
              )
            );
          }}
        />
      </label>
      {layer.customFont ? (
        <button
          type="button"
          className="studio-fit-button"
          onClick={() =>
            onUpdateLayer(layer.id, (current) =>
              current.kind === "text"
                ? {
                    ...current,
                    customFont: null
                  }
                : current
            )
          }
        >
          Remove {layer.customFont.name}
        </button>
      ) : null}
      <label>
        Width
        <input
          type="number"
          min={40}
          max={2000}
          value={layer.width}
          onChange={(event) =>
            onUpdateLayer(layer.id, (current) =>
              current.kind === "text"
                ? {
                    ...current,
                    width: normalizeNumber(Number(event.target.value), current.width)
                  }
                : current
            )
          }
        />
      </label>
      <label>
        Align
        <select
          value={layer.align}
          onChange={(event) =>
            onUpdateLayer(layer.id, (current) =>
              current.kind === "text"
                ? {
                    ...current,
                    align: event.target.value as EditorTextLayer["align"]
                  }
                : current
            )
          }
        >
          <option value="left">Left</option>
          <option value="center">Center</option>
          <option value="right">Right</option>
        </select>
      </label>
      <label>
        Line height
        <input
          type="number"
          min={0.8}
          max={3}
          step={0.05}
          value={layer.lineHeight}
          onChange={(event) =>
            onUpdateLayer(layer.id, (current) =>
              current.kind === "text"
                ? {
                    ...current,
                    lineHeight: normalizeNumber(Number(event.target.value), current.lineHeight)
                  }
                : current
            )
          }
        />
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
              current.kind === "text"
                ? {
                    ...current,
                    opacity: normalizeNumber(Number(event.target.value), current.opacity)
                  }
                : current
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
