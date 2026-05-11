import type { EditorInstance } from 'novel'
import type { EditorView } from '@tiptap/pm/view'

const MAX_URL_LENGTH = 2048

function isAbsoluteHttpUrl(url: string): URL | null {
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
    return parsed
  } catch {
    return null
  }
}

function isSameOrigin(url: URL): boolean {
  if (typeof window === 'undefined') return false
  return url.origin === window.location.origin
}

function isAppInternalPath(src: string): boolean {
  return src.startsWith('/api/images/')
    || src.startsWith('/api/uploads')
    || src.startsWith('blob:')
    || src.startsWith('data:')
}

export function shouldRehost(src: string): boolean {
  if (!src) return false
  if (src.length > MAX_URL_LENGTH) return false
  if (isAppInternalPath(src)) return false

  const parsed = isAbsoluteHttpUrl(src)
  if (!parsed) return false
  if (isSameOrigin(parsed)) return false

  return true
}

export interface RehostResult {
  url: string
  sourceUrl: string
  deduplicated?: boolean
}

export async function rehostRemoteImage(sourceUrl: string, signal?: AbortSignal): Promise<RehostResult> {
  const response = await fetch('/api/uploads/from-url', {
    method: 'POST',
    credentials: 'include',
    signal,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: sourceUrl }),
  })

  const payload = (await response.json().catch(() => null)) as
    | { success?: boolean; url?: string; sourceUrl?: string; deduplicated?: boolean; error?: string }
    | null

  if (!response.ok || !payload?.success || typeof payload.url !== 'string') {
    throw new Error(payload?.error || `导入失败 (${response.status})`)
  }

  return {
    url: payload.url,
    sourceUrl: payload.sourceUrl || sourceUrl,
    deduplicated: Boolean(payload.deduplicated),
  }
}

export interface RehostProgress {
  total: number
  done: number
  failed: number
}

export interface RehostEditorImagesOptions {
  onProgress?: (progress: RehostProgress) => void
  onFail?: (sourceUrl: string, error: Error) => void
}

type ImageTarget = {
  pos: number
  src: string
  attrs: Record<string, unknown>
}

function collectRemoteImageNodes(editor: EditorInstance): ImageTarget[] {
  const targets: ImageTarget[] = []
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name !== 'image') return
    const src = typeof node.attrs.src === 'string' ? node.attrs.src : ''
    if (!shouldRehost(src)) return
    targets.push({ pos, src, attrs: { ...node.attrs } })
  })
  return targets
}

function replaceImageSrc(editor: EditorInstance, target: ImageTarget, newSrc: string): boolean {
  const imageType = editor.state.schema.nodes.image
  if (!imageType) return false

  const doc = editor.state.doc
  const current = doc.nodeAt(target.pos)
  // Node may have shifted since collection; walk to find the original src node in the same doc.
  if (current && current.type.name === 'image' && current.attrs.src === target.src) {
    const nextNode = imageType.create({ ...current.attrs, src: newSrc })
    const tr = editor.state.tr.replaceWith(target.pos, target.pos + current.nodeSize, nextNode).setMeta('addToHistory', false)
    editor.view.dispatch(tr)
    return true
  }

  let replaced = false
  editor.state.doc.descendants((node, pos) => {
    if (replaced) return false
    if (node.type.name !== 'image') return
    if (node.attrs.src !== target.src) return
    const nextNode = imageType.create({ ...node.attrs, src: newSrc })
    const tr = editor.state.tr.replaceWith(pos, pos + node.nodeSize, nextNode).setMeta('addToHistory', false)
    editor.view.dispatch(tr)
    replaced = true
    return false
  })
  return replaced
}

type RehostTargetView = {
  collect: () => ImageTarget[]
  replace: (target: ImageTarget, nextSrc: string) => boolean
}

function editorToView(editor: EditorInstance): RehostTargetView {
  return {
    collect: () => collectRemoteImageNodes(editor),
    replace: (target, nextSrc) => replaceImageSrc(editor, target, nextSrc),
  }
}

function viewToTargetView(view: EditorView): RehostTargetView {
  return {
    collect: () => {
      const targets: ImageTarget[] = []
      view.state.doc.descendants((node, pos) => {
        if (node.type.name !== 'image') return
        const src = typeof node.attrs.src === 'string' ? node.attrs.src : ''
        if (!shouldRehost(src)) return
        targets.push({ pos, src, attrs: { ...node.attrs } })
      })
      return targets
    },
    replace: (target, nextSrc) => {
      const imageType = view.state.schema.nodes.image
      if (!imageType) return false
      let replaced = false
      view.state.doc.descendants((node, pos) => {
        if (replaced) return false
        if (node.type.name !== 'image') return
        if (node.attrs.src !== target.src) return
        const nextNode = imageType.create({ ...node.attrs, src: nextSrc })
        const tr = view.state.tr.replaceWith(pos, pos + node.nodeSize, nextNode).setMeta('addToHistory', false)
        view.dispatch(tr)
        replaced = true
        return false
      })
      return replaced
    },
  }
}

export async function rehostRemoteImagesInView(
  view: EditorView,
  options: RehostEditorImagesOptions = {}
): Promise<RehostProgress> {
  return runRehost(viewToTargetView(view), options)
}

export async function rehostEditorImages(
  editor: EditorInstance,
  options: RehostEditorImagesOptions = {}
): Promise<RehostProgress> {
  return runRehost(editorToView(editor), options)
}

async function runRehost(
  targetView: RehostTargetView,
  options: RehostEditorImagesOptions = {}
): Promise<RehostProgress> {
  const targets = targetView.collect()
  const progress: RehostProgress = { total: targets.length, done: 0, failed: 0 }

  if (targets.length === 0) {
    return progress
  }

  // Deduplicate by src — same url only fetched once.
  const bySrc = new Map<string, ImageTarget[]>()
  for (const target of targets) {
    const bucket = bySrc.get(target.src) ?? []
    bucket.push(target)
    bySrc.set(target.src, bucket)
  }

  options.onProgress?.(progress)

  await Promise.all(
    Array.from(bySrc.entries()).map(async ([src, bucket]) => {
      try {
        const result = await rehostRemoteImage(src)
        for (const target of bucket) {
          targetView.replace(target, result.url)
        }
        progress.done += bucket.length
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err))
        progress.failed += bucket.length
        options.onFail?.(src, error)
      } finally {
        options.onProgress?.(progress)
      }
    })
  )

  return progress
}
