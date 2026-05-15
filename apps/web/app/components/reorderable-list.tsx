"use client";

import { useState } from "react";
import { UtilityIcons } from "./tool-icon";

export function moveItem<T>(items: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= items.length || to >= items.length) {
    return items;
  }
  const next = [...items];
  const [removed] = next.splice(from, 1);
  next.splice(to, 0, removed);
  return next;
}

export function ReorderHandle({ label = "Drag to reorder" }: { label?: string }): React.JSX.Element {
  const Grip = UtilityIcons.GripVertical;
  return (
    <span className="reorder-handle" aria-label={label} title={label}>
      <Grip aria-hidden="true" size={18} />
    </span>
  );
}

export function ReorderableList<T>({
  items,
  onReorder,
  className,
  disabled = false,
  keyForItem,
  renderItem
}: {
  items: T[];
  onReorder: (items: T[]) => void;
  className?: string;
  disabled?: boolean;
  keyForItem: (item: T, index: number) => string;
  renderItem: (item: T, index: number, dragging: boolean) => React.ReactNode;
}): React.JSX.Element {
  const [dragIndex, setDragIndex] = useState<number | null>(null);

  return (
    <div className={className}>
      {items.map((item, index) => (
        <div
          key={keyForItem(item, index)}
          className={`reorderable-item ${dragIndex === index ? "is-dragging" : ""}`}
          draggable={!disabled}
          onDragStart={(event) => {
            if (disabled) {
              event.preventDefault();
              return;
            }
            setDragIndex(index);
            event.dataTransfer.effectAllowed = "move";
            event.dataTransfer.setData("text/plain", String(index));
          }}
          onDragOver={(event) => {
            if (!disabled) {
              event.preventDefault();
              event.dataTransfer.dropEffect = "move";
            }
          }}
          onDrop={(event) => {
            event.preventDefault();
            const from = dragIndex ?? Number(event.dataTransfer.getData("text/plain"));
            setDragIndex(null);
            if (!Number.isInteger(from) || from === index) {
              return;
            }
            onReorder(moveItem(items, from, index));
          }}
          onDragEnd={() => setDragIndex(null)}
        >
          {renderItem(item, index, dragIndex === index)}
        </div>
      ))}
    </div>
  );
}
