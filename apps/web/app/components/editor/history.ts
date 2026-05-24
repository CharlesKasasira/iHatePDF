import type { EditorDocumentState, EditorHistorySnapshot } from "./types";

const HISTORY_LIMIT = 100;

export function createHistorySnapshot(state: EditorDocumentState): EditorHistorySnapshot {
  const document = state.document;
  return {
    layers: document.layers,
    selection: document.selection,
    pageRotations: document.operations.pageRotations,
    pageNumbers: document.operations.pageNumbers,
    watermark: document.operations.watermark
  };
}

export function withUndoCheckpoint(
  state: EditorDocumentState,
  nextState: EditorDocumentState
): EditorDocumentState {
  return {
    ...nextState,
    history: {
      past: [...state.history.past, createHistorySnapshot(state)].slice(-HISTORY_LIMIT),
      future: []
    }
  };
}

export function restoreHistorySnapshot(
  state: EditorDocumentState,
  snapshot: EditorHistorySnapshot,
  status: string
): EditorDocumentState {
  return {
    ...state,
    document: {
      ...state.document,
      layers: snapshot.layers,
      selection: snapshot.selection,
      operations: {
        ...state.document.operations,
        pageRotations: snapshot.pageRotations,
        pageNumbers: snapshot.pageNumbers,
        watermark: snapshot.watermark
      }
    },
    status
  };
}

export function undoHistory(state: EditorDocumentState): EditorDocumentState {
  const previous = state.history.past.at(-1);
  if (!previous) {
    return state;
  }

  return {
    ...restoreHistorySnapshot(state, previous, "Undid the last studio edit."),
    history: {
      past: state.history.past.slice(0, -1),
      future: [createHistorySnapshot(state), ...state.history.future].slice(0, HISTORY_LIMIT)
    }
  };
}

export function redoHistory(state: EditorDocumentState): EditorDocumentState {
  const next = state.history.future[0];
  if (!next) {
    return state;
  }

  return {
    ...restoreHistorySnapshot(state, next, "Redid the last studio edit."),
    history: {
      past: [...state.history.past, createHistorySnapshot(state)].slice(-HISTORY_LIMIT),
      future: state.history.future.slice(1)
    }
  };
}
