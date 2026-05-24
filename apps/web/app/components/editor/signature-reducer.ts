import type { EditorAction, EditorDocumentState } from "./types";

export function reduceSignatureState(
  state: EditorDocumentState,
  action: EditorAction
): EditorDocumentState | null {
  switch (action.type) {
    case "set-signature-request":
      return {
        ...state,
        document: {
          ...state.document,
          signatures: {
            ...state.document.signatures,
            request: { ...state.document.signatures.request, ...action.patch }
          }
        }
      };
    case "set-signature-request-feedback":
      return {
        ...state,
        document: {
          ...state.document,
          signatures: {
            ...state.document.signatures,
            request: {
              ...state.document.signatures.request,
              status: action.status,
              link: action.link ?? state.document.signatures.request.link
            }
          }
        }
      };
    case "set-signature-flow-step":
      return {
        ...state,
        document: {
          ...state.document,
          signatures: {
            ...state.document.signatures,
            flowStep: action.step
          }
        }
      };
    default:
      return null;
  }
}
