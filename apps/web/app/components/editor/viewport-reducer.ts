import type { EditorAction, EditorDocumentState } from "./types";

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 2;

export function reduceViewportState(
  state: EditorDocumentState,
  action: EditorAction
): EditorDocumentState | null {
  switch (action.type) {
    case "set-active-page":
      return {
        ...state,
        document: {
          ...state.document,
          viewport: {
            ...state.document.viewport,
            activePage: Math.min(Math.max(1, action.activePage), Math.max(1, state.document.pages.length))
          }
        }
      };
    case "set-zoom":
      return {
        ...state,
        document: {
          ...state.document,
          viewport: {
            ...state.document.viewport,
            zoom: Math.min(Math.max(MIN_ZOOM, action.zoom), MAX_ZOOM),
            fitMode: "manual"
          }
        }
      };
    case "set-fit-mode":
      return {
        ...state,
        document: {
          ...state.document,
          viewport: {
            ...state.document.viewport,
            fitMode: action.fitMode,
            zoom: action.fitMode === "manual" ? state.document.viewport.zoom : 1
          }
        }
      };
    case "set-snap-to-grid":
      return {
        ...state,
        document: {
          ...state.document,
          viewport: {
            ...state.document.viewport,
            snapToGrid: action.enabled
          }
        },
        status: action.enabled ? "Snap to grid enabled." : "Snap to grid disabled."
      };
    case "set-show-guides":
      return {
        ...state,
        document: {
          ...state.document,
          viewport: {
            ...state.document.viewport,
            showGuides: action.enabled
          }
        },
        status: action.enabled ? "Alignment guides enabled." : "Alignment guides hidden."
      };
    case "set-scroll-target": {
      const targetPage = Math.min(Math.max(1, action.page), Math.max(1, state.document.pages.length));
      return {
        ...state,
        document: {
          ...state.document,
          viewport: {
            ...state.document.viewport,
            activePage: targetPage,
            scrollTarget: {
              page: targetPage,
              behavior: action.behavior ?? "smooth",
              requestedAt: Date.now()
            }
          }
        }
      };
    }
    default:
      return null;
  }
}
