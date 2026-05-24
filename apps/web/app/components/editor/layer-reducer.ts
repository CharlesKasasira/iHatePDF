import { withUndoCheckpoint } from "./history";
import {
  createEmptySelection,
  createSelectionFromLayerId,
  createSelectionFromLayerIds,
  toggleSelectionLayer
} from "./selection";
import type { EditorAction, EditorDocumentState } from "./types";

export function reduceLayerState(
  state: EditorDocumentState,
  action: EditorAction
): EditorDocumentState | null {
  switch (action.type) {
    case "set-tool":
      return {
        ...state,
        tool: action.tool,
        document: {
          ...state.document,
          selection: createEmptySelection()
        }
      };
    case "set-selection":
      return {
        ...state,
        document: {
          ...state.document,
          selection: action.additive
            ? toggleSelectionLayer(state, action.layerId)
            : createSelectionFromLayerId(action.layerId)
        }
      };
    case "set-selection-many":
      return {
        ...state,
        document: {
          ...state.document,
          selection: createSelectionFromLayerIds(action.layerIds)
        }
      };
    case "add-layer":
      return withUndoCheckpoint(state, {
        ...state,
        document: {
          ...state.document,
          layers: [...state.document.layers, action.layer],
          selection: createSelectionFromLayerId(action.layer.id)
        },
        status: action.status
      });
    case "update-layer": {
      const nextState = {
        ...state,
        document: {
          ...state.document,
          layers: state.document.layers.map((layer) =>
            layer.id === action.layerId && !layer.locked ? action.updater(layer) : layer
          )
        }
      };
      return action.trackHistory === false ? nextState : withUndoCheckpoint(state, nextState);
    }
    case "set-layers":
      return withUndoCheckpoint(state, {
        ...state,
        document: {
          ...state.document,
          layers: action.layers
        },
        status: action.status ?? state.status
      });
    case "remove-layer":
      return withUndoCheckpoint(state, {
        ...state,
        document: {
          ...state.document,
          layers: state.document.layers.filter((layer) => layer.id !== action.layerId || layer.locked),
          selection: createSelectionFromLayerIds(
            state.document.selection.layerIds.filter((layerId) => layerId !== action.layerId)
          )
        }
      });
    case "set-layer-lock": {
      const targetIds = new Set(action.layerIds);
      return withUndoCheckpoint(state, {
        ...state,
        document: {
          ...state.document,
          layers: state.document.layers.map((layer) =>
            targetIds.has(layer.id) ? { ...layer, locked: action.locked } : layer
          )
        },
        status: action.locked ? "Locked selected layer edits." : "Unlocked selected layer edits."
      });
    }
    case "set-form-value":
      return withUndoCheckpoint(state, {
        ...state,
        document: {
          ...state.document,
          formValues: {
            ...state.document.formValues,
            [action.name]: action.value
          }
        },
        status: "Updated form field."
      });
    default:
      return null;
  }
}
