export const EDITOR_REHOST_TOAST_EVENT = 'channing-editor-rehost-toast'

export type EditorRehostToastVariant = 'info' | 'success' | 'error'

export interface EditorRehostToastDetail {
  message: string
  variant: EditorRehostToastVariant
  durationMs?: number
}

export function emitEditorRehostToast(detail: EditorRehostToastDetail) {
  if (typeof window === 'undefined') return
  window.dispatchEvent(
    new CustomEvent<EditorRehostToastDetail>(EDITOR_REHOST_TOAST_EVENT, { detail })
  )
}
