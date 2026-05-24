import { DEFAULT_EDITOR_PAGE } from "./constants";
import { withUndoCheckpoint } from "./history";
import { createEmptySelection } from "./selection";
import type { EditorAction, EditorDocumentState } from "./types";

function nextExportId(): string {
  return `export-${crypto.randomUUID()}`;
}

export function reduceDocumentState(
  state: EditorDocumentState,
  action: EditorAction
): EditorDocumentState | null {
  switch (action.type) {
    case "reset-for-pdf":
      return {
        ...state,
        isLoadingPreview: false,
        rotationPage: 1,
        history: { past: [], future: [] },
        document: {
          ...state.document,
          file: action.file,
          sourceFileId: null,
          sourceRetentionHours: null,
          pages: [DEFAULT_EDITOR_PAGE],
          layers: [],
          selection: createEmptySelection(),
          operations: {
            ...state.document.operations,
            pageRotations: []
          },
          export: {
            ...state.document.export,
            outputName: action.outputName,
            downloadUrl: "",
            history: []
          },
          signatures: {
            ...state.document.signatures,
            request: {
              ...state.document.signatures.request,
              outputName: action.signatureRequestOutputName,
              status: "",
              link: ""
            },
            flowStep: "closed"
          },
          viewport: {
            ...state.document.viewport,
            activePage: 1,
            scrollTarget: null
          }
        }
      };
    case "load-preview-started":
      return {
        ...state,
        isLoadingPreview: true,
        document: {
          ...state.document,
          sourceFileId: null,
          pages: [DEFAULT_EDITOR_PAGE]
        },
        status: `Loading ${action.fileName} for preview...`
      };
    case "load-preview-succeeded": {
      const nextPages = action.pages.length > 0 ? action.pages : [DEFAULT_EDITOR_PAGE];
      return {
        ...state,
        rotationPage: Math.min(Math.max(1, state.rotationPage), Math.max(1, action.pageCount)),
        document: {
          ...state.document,
          sourceFileId: action.fileId,
          sourceRetentionHours: action.retentionHours,
          pages: nextPages,
          viewport: {
            ...state.document.viewport,
            activePage: Math.min(
              Math.max(1, state.document.viewport.activePage ?? 1),
              Math.max(1, action.pageCount)
            )
          }
        },
        isLoadingPreview: false,
        status: `${action.fileName} loaded. ${action.pageCount} page${action.pageCount === 1 ? "" : "s"} ready for editing.`
      };
    }
    case "load-preview-failed":
      return {
        ...state,
        document: {
          ...state.document,
          sourceFileId: null,
          sourceRetentionHours: null,
          pages: [DEFAULT_EDITOR_PAGE]
        },
        isLoadingPreview: false,
        status: action.message
      };
    case "set-download-url":
      return {
        ...state,
        document: {
          ...state.document,
          export: {
            ...state.document.export,
            downloadUrl: action.downloadUrl,
            history: action.downloadUrl
              ? [
                  {
                    id: nextExportId(),
                    outputName: state.document.export.outputName,
                    downloadUrl: action.downloadUrl,
                    retentionHours: state.document.export.retentionHours,
                    createdAt: new Date().toISOString()
                  },
                  ...state.document.export.history.filter((item) => item.downloadUrl !== action.downloadUrl)
                ].slice(0, 20)
              : state.document.export.history
          }
        }
      };
    case "set-output-name":
      return {
        ...state,
        document: {
          ...state.document,
          export: {
            ...state.document.export,
            outputName: action.outputName
          }
        }
      };
    case "set-retention-hours":
      return {
        ...state,
        document: {
          ...state.document,
          export: {
            ...state.document.export,
            retentionHours: action.retentionHours
          }
        }
      };
    case "restore-draft":
      return {
        ...state,
        history: { past: [], future: [] },
        document: {
          ...state.document,
          layers: action.snapshot.layers,
          selection: action.snapshot.selection,
          operations: {
            ...state.document.operations,
            pageRotations: action.snapshot.pageRotations,
            pageNumbers: action.snapshot.pageNumbers,
            watermark: action.snapshot.watermark
          },
          export: {
            ...state.document.export,
            outputName: action.outputName,
            retentionHours: action.retentionHours,
            downloadUrl: ""
          }
        },
        status: "Restored the autosaved studio draft for this PDF."
      };
    case "set-page-rotations":
      return withUndoCheckpoint(state, {
        ...state,
        document: {
          ...state.document,
          operations: {
            ...state.document.operations,
            pageRotations: action.pageRotations
          }
        }
      });
    case "set-rotation-page":
      return { ...state, rotationPage: action.rotationPage };
    case "set-rotation-degrees":
      return { ...state, rotationDegrees: action.rotationDegrees };
    case "set-page-numbers-enabled":
      return withUndoCheckpoint(state, {
        ...state,
        document: {
          ...state.document,
          operations: {
            ...state.document.operations,
            pageNumbers: { ...state.document.operations.pageNumbers, enabled: action.enabled }
          }
        }
      });
    case "set-page-numbers":
      return withUndoCheckpoint(state, {
        ...state,
        document: {
          ...state.document,
          operations: {
            ...state.document.operations,
            pageNumbers: { ...state.document.operations.pageNumbers, ...action.patch }
          }
        }
      });
    case "set-watermark-enabled":
      return withUndoCheckpoint(state, {
        ...state,
        document: {
          ...state.document,
          operations: {
            ...state.document.operations,
            watermark: { ...state.document.operations.watermark, enabled: action.enabled }
          }
        }
      });
    case "set-watermark":
      return withUndoCheckpoint(state, {
        ...state,
        document: {
          ...state.document,
          operations: {
            ...state.document.operations,
            watermark: { ...state.document.operations.watermark, ...action.patch }
          }
        }
      });
    case "set-source-file":
      return {
        ...state,
        document: {
          ...state.document,
          sourceFileId: action.fileId,
          sourceRetentionHours: action.retentionHours
        }
      };
    default:
      return null;
  }
}
