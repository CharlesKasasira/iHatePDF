"use client";

import { TOOL_ITEMS } from "./constants";
import type { EditorDraftDefaults, EditorTool } from "./types";
import { normalizeNumber } from "./utils";

export function EditorToolbar({
  tool,
  textDefaults,
  onToolSelect,
  onTextDefaultsChange
}: {
  tool: EditorTool;
  textDefaults: EditorDraftDefaults["text"];
  onToolSelect: (tool: EditorTool) => void;
  onTextDefaultsChange: (patch: Partial<EditorDraftDefaults["text"]>) => void;
}): React.JSX.Element {
  return (
    <section className="studio-toolbar">
      <div className="studio-toolbar__group">
        {TOOL_ITEMS.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`studio-tool ${tool === item.id ? "is-active" : ""}`}
            onClick={() => onToolSelect(item.id)}
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
            value={textDefaults.fontFamily}
            onChange={(event) =>
              onTextDefaultsChange({ fontFamily: event.target.value as EditorDraftDefaults["text"]["fontFamily"] })
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

        <label className="studio-inline-control studio-inline-control--short">
          <span>Size</span>
          <input
            type="number"
            min={8}
            max={72}
            value={textDefaults.fontSize}
            onChange={(event) =>
              onTextDefaultsChange({ fontSize: normalizeNumber(Number(event.target.value), 20) })
            }
          />
        </label>

        <label className="studio-inline-control studio-inline-control--short">
          <span>Color</span>
          <input
            type="color"
            value={textDefaults.color}
            onChange={(event) => onTextDefaultsChange({ color: event.target.value })}
          />
        </label>

        <label className="studio-inline-control studio-inline-control--short">
          <span>Opacity</span>
          <input
            type="number"
            min={0.05}
            max={1}
            step={0.05}
            value={textDefaults.opacity}
            onChange={(event) =>
              onTextDefaultsChange({ opacity: normalizeNumber(Number(event.target.value), 1) })
            }
          />
        </label>

        <label className="studio-toggle-chip">
          <input
            type="checkbox"
            checked={textDefaults.bold}
            onChange={(event) => onTextDefaultsChange({ bold: event.target.checked })}
          />
          <span>B</span>
        </label>
        <label className="studio-toggle-chip">
          <input
            type="checkbox"
            checked={textDefaults.italic}
            onChange={(event) => onTextDefaultsChange({ italic: event.target.checked })}
          />
          <span>I</span>
        </label>
        <label className="studio-toggle-chip">
          <input
            type="checkbox"
            checked={textDefaults.underline}
            onChange={(event) => onTextDefaultsChange({ underline: event.target.checked })}
          />
          <span>U</span>
        </label>
      </div>
    </section>
  );
}
