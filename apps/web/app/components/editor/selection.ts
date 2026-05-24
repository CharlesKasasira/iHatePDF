import type { EditorDocumentState, EditorLayer, EditorSelection } from "./types";
import { nextLayerId } from "./utils";

export const DUPLICATE_LAYER_OFFSET = 18;

export function createEmptySelection(): EditorSelection {
  return { layerId: null, layerIds: [] };
}

export function createSelectionFromLayerId(layerId: string | null): EditorSelection {
  return { layerId, layerIds: layerId ? [layerId] : [] };
}

export function createSelectionFromLayerIds(layerIds: string[]): EditorSelection {
  const uniqueLayerIds = Array.from(new Set(layerIds));
  return {
    layerId: uniqueLayerIds.at(-1) ?? null,
    layerIds: uniqueLayerIds
  };
}

export function getSelectionLayerIds(selection: EditorSelection): string[] {
  if (selection.layerIds.length > 0) {
    return selection.layerIds;
  }

  return selection.layerId ? [selection.layerId] : [];
}

export function toggleSelectionLayer(state: EditorDocumentState, layerId: string | null): EditorSelection {
  if (!layerId) {
    return createEmptySelection();
  }

  const currentLayerIds = getSelectionLayerIds(state.document.selection);
  const nextLayerIds = currentLayerIds.includes(layerId)
    ? currentLayerIds.filter((currentLayerId) => currentLayerId !== layerId)
    : [...currentLayerIds, layerId];

  return createSelectionFromLayerIds(nextLayerIds);
}

export function cloneLayer(layer: EditorLayer, offset = DUPLICATE_LAYER_OFFSET): EditorLayer {
  return {
    ...layer,
    id: nextLayerId(),
    locked: false,
    x: layer.x + offset,
    y: layer.y + offset
  };
}
