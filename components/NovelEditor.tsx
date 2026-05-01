'use client'

import Link from 'next/link'
import { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import {
  ArrowLeft,
  ChevronUp,
  Globe,
  Eye,
  Loader2,
  Lock,
  Link2,
  Copy,
  FileDown,
  Send,
  PanelRightOpen,
  PanelRightClose,
  ImageIcon,
  WandSparkles,
  X,
} from 'lucide-react'
import {
  EditorContent,
  EditorInstance,
  EditorRoot,
  JSONContent,
} from 'novel'
import {
  createEditorExtensions,
  buildEditorProps,
  FormattingBubble,
  SlashMenu,
  TableBubble,
} from '@/lib/editor-extensions'
import { generatePassword } from '@/lib/password'
import { InputModal } from '@/components/InputModal'
import { CategorySelector } from '@/components/CategorySelector'
import { ImageGenerationModal } from '@/components/ImageGenerationModal'
import { ImageCropModal } from '@/components/ImageCropModal'
import { WeChatPublishModal } from '@/components/WeChatPublishModal'
import { useToast } from '@/components/Toast'
import { startBackgroundTask } from '@/lib/client-background-task'
import { AIModal } from '@/lib/ai-modal'
import {
  COVER_IMAGE_OPTIMIZE_OPTIONS,
  EDITOR_IMAGE_OPTIMIZE_OPTIONS,
  optimizeImageForUpload,
} from '@/lib/client-image'
import {
  createUploadPlaceholderMarker,
  insertGeneratedImageAfterNode,
  insertGeneratedImageAtPosition,
  insertUploadPlaceholder,
  insertUploadedFileIntoEditor,
  removeUploadPlaceholder,
  replaceImageNodeAtPosition,
  uploadEditorFile,
} from '@/lib/editor-file-upload'
import { copyAsWechatArticleFormat, downloadArticleAsPdf } from '@/lib/wechat-copy'
import {
  extractFilesFromClipboard,
  useEditorAuxiliaryModals,
  useEditorUploadTriggers,
} from '@/lib/editor-ui'
import type { EditorImageActionTarget } from '@/lib/resizable-image'
import { resolvePostCoverImage } from '@/lib/default-cover-images'
import { buildAutoDescription, normalizePostSlug, sanitizePostSlugInput } from '@/lib/post-utils'
import { getSiteDisplayUrl } from '@/lib/site-config'
import { resizeTextareaHeight, useAutoResizeTextarea } from '@/lib/textarea-autosize'

type SaveFeedback =
  | { type: 'success' | 'error'; message: string; slug?: string }
  | null

type PublishStatus = 'public' | 'draft' | 'encrypted' | 'unlisted'
type SaveState = 'saved' | 'dirty' | 'saving' | 'error'

const SIDEBAR_KEY = 'qmblog:sidebar-open'
const AUTOSAVE_DEBOUNCE_MS = 1500
const AUTOSAVE_MAX_RETRY_DELAY_MS = 10000
const SITE_DISPLAY_URL = getSiteDisplayUrl()

const EMPTY_DOCUMENT = {
  type: 'doc',
  content: [{ type: 'paragraph' }],
} satisfies JSONContent

function calcReadTime(chars: number): string {
  const minutes = Math.max(1, Math.ceil(chars / 400))
  return `约${minutes}分钟阅读`
}

function relativeTime(ts: number): string {
  const diff = Math.floor((Date.now() - ts) / 1000)
  if (diff < 60) return '刚刚'
  if (diff < 3600) return `${Math.floor(diff / 60)}分钟前`
  return `${Math.floor(diff / 3600)}小时前`
}

interface NovelEditorProps {
  initialData?: {
    slug: string
    title: string
    html: string
    category?: string
    status?: 'draft' | 'published' | 'deleted'
    password?: string | null
    is_hidden?: number
    tags?: string[]
    description?: string | null
    cover_image?: string | null
  }
}

type DraftMetaState = {
  editSlug: string | null
  slug: string
  category: string
  tags: string[]
  description: string
  coverImage: string
}

type MetaGenerationTarget = 'summary' | 'tags' | 'slug' | 'cover'

export function NovelEditor({ initialData }: NovelEditorProps = {}) {
  // ── Core state ──
  const [draftReady, setDraftReady] = useState(false)
  const [initialContent, setInitialContent] = useState<JSONContent>(EMPTY_DOCUMENT)
  const editorRef = useRef<EditorInstance | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const fileUploadRef = useRef<HTMLInputElement | null>(null)

  // ── Fields ──
  const [editSlug, setEditSlug] = useState(initialData?.slug ?? null)
  const [title, setTitle] = useState('')
  const latestTitleRef = useRef('')
  const [charCount, setCharCount] = useState(0)
  const [category, setCategory] = useState(initialData?.category || '未分类')
  const [publishStatus, setPublishStatus] = useState<PublishStatus>(
    initialData?.status === 'draft' ? 'draft' :
    initialData?.password ? 'encrypted' :
    initialData?.is_hidden ? 'unlisted' : 'public'
  )
  const [tags, setTags] = useState<string[]>(initialData?.tags || [])
  const [description, setDescription] = useState(initialData?.description || '')
  const [coverImage, setCoverImage] = useState(initialData?.cover_image || '')
  const [slug, setSlug] = useState(initialData?.slug || '')

  // ── UI state ──
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [publishPanelOpen, setPublishPanelOpen] = useState(false)
  const [wechatPublishOpen, setWechatPublishOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [uploadingImage, setUploadingImage] = useState(false)
  const [uploadProgress, setUploadProgress] = useState(0)
  const [pendingMetadataTargets, setPendingMetadataTargets] = useState<MetaGenerationTarget[]>([])
  const [feedback, setFeedback] = useState<SaveFeedback>(null)
  const [saveState, setSaveState] = useState<SaveState>('saved')
  const [lastSavedAt, setLastSavedAt] = useState<number>(Date.now())
  const [referenceImageTarget, setReferenceImageTarget] = useState<EditorImageActionTarget | null>(null)
  const [cropImageTarget, setCropImageTarget] = useState<EditorImageActionTarget | null>(null)
  const [, setTick] = useState(0) // force re-render for relative time
  const publishPanelRef = useRef<HTMLDivElement>(null)
  const titleRef = useRef<HTMLTextAreaElement>(null)
  const toast = useToast()

  // Draft save refs
  const draftSaveTimerRef = useRef<number | null>(null)
  const retrySaveTimerRef = useRef<number | null>(null)
  const autosaveAbortRef = useRef<AbortController | null>(null)
  const autosaveSeqRef = useRef(0)
  const lastAutosaveSnapshotRef = useRef<string | null>(null)
  const skipNextEditorUpdateRef = useRef(Boolean(initialData?.html))
  const slugInputFocusedRef = useRef(false)
  const latestMetaRef = useRef<DraftMetaState>({
    editSlug: initialData?.slug ?? null,
    slug: initialData?.slug || '',
    category: initialData?.category || '未分类',
    tags: initialData?.tags || [],
    description: initialData?.description || '',
    coverImage: initialData?.cover_image || '',
  })

  // ── Init ──
  useEffect(() => {
    if (initialData) {
      latestTitleRef.current = initialData.title
      setTitle(initialData.title)
      setInitialContent(EMPTY_DOCUMENT)
    } else {
      // 新文章，使用空文档
      setInitialContent(EMPTY_DOCUMENT)
    }
    setDraftReady(true)

    // Load sidebar preference
    if (typeof window !== 'undefined') {
      setSidebarOpen(window.localStorage.getItem(SIDEBAR_KEY) === 'true')
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Persist sidebar preference
  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(SIDEBAR_KEY, String(sidebarOpen))
    }
  }, [sidebarOpen])

  useEffect(() => {
    latestMetaRef.current = {
      editSlug,
      slug,
      category,
      tags,
      description,
      coverImage,
    }
  }, [editSlug, slug, category, tags, description, coverImage])

  // Relative time ticker
  useEffect(() => {
    const id = window.setInterval(() => setTick(t => t + 1), 30000)
    return () => clearInterval(id)
  }, [title])

  // Cleanup timers
  useEffect(() => {
    return () => {
      if (draftSaveTimerRef.current !== null) window.clearTimeout(draftSaveTimerRef.current)
      if (retrySaveTimerRef.current !== null) window.clearTimeout(retrySaveTimerRef.current)
      autosaveAbortRef.current?.abort()
    }
  }, [title])

  // Auto-focus title on new post
  useEffect(() => {
    if (draftReady && !editSlug && titleRef.current) {
      titleRef.current.focus()
    }
  }, [draftReady, editSlug])

  // Click outside to close publish panel
  useEffect(() => {
    if (!publishPanelOpen) return
    const handler = (e: MouseEvent) => {
      if (publishPanelRef.current && !publishPanelRef.current.contains(e.target as Node)) {
        setPublishPanelOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [publishPanelOpen])

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault()
        handleSave()
      }
      if (e.key === 'Escape') {
        setPublishPanelOpen(false)
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  })

  const {
    aiModal,
    closeAiModal,
    closeImageModal,
    handleInputModalCancel,
    handleInputModalConfirm,
    imageModal,
    inputModal,
    openDocumentAIModal,
    openDocumentImageModal,
  } = useEditorAuxiliaryModals({
    title,
    getDocumentText: () => editorRef.current?.getText({ blockSeparator: '\n\n' }).trim() || '',
    getSelectionContext: () => {
      const selection = editorRef.current?.state.selection
      return {
        insertPos: selection?.to ?? null,
        selectedText: selection
          ? editorRef.current?.state.doc.textBetween(selection.from, selection.to, '\n').trim() || ''
          : '',
      }
    },
  })

  useEditorUploadTriggers(fileInputRef, fileUploadRef)

  const insertGeneratedImage = useCallback((imageUrl: string, alt: string) => {
    const editor = editorRef.current
    if (!editor) return

    insertGeneratedImageAtPosition(editor, imageUrl, alt, imageModal.insertPos)
    closeImageModal()
  }, [closeImageModal, imageModal.insertPos])

  const applyImageActionResult = useCallback((
    target: EditorImageActionTarget,
    imageUrl: string,
    alt: string,
    placementMode: 'insert' | 'replace' = 'replace',
  ) => {
    const editor = editorRef.current
    if (!editor) return

    const nextAlt = alt || target.alt || ''

    if (placementMode === 'replace') {
      replaceImageNodeAtPosition(editor, imageUrl, nextAlt, target.pos)
    } else {
      insertGeneratedImageAfterNode(editor, imageUrl, nextAlt, target.pos)
    }
  }, [])

  const buildAutosaveSnapshot = useCallback((payload: {
    currentSlug: string | null
    nextSlug: string
    title: string
    html: string
    description: string
    category: string
    tags: string[]
    coverImage: string
  }) => {
    return JSON.stringify({
      currentSlug: payload.currentSlug,
      nextSlug: payload.nextSlug,
      title: payload.title,
      html: payload.html,
      description: payload.description,
      category: payload.category,
      tags: payload.tags,
      coverImage: payload.coverImage,
    })
  }, [])

  const clearAutosaveTimers = useCallback(() => {
    if (draftSaveTimerRef.current !== null) {
      window.clearTimeout(draftSaveTimerRef.current)
      draftSaveTimerRef.current = null
    }
    if (retrySaveTimerRef.current !== null) {
      window.clearTimeout(retrySaveTimerRef.current)
      retrySaveTimerRef.current = null
    }
  }, [])

  const abortAutosaveRequest = useCallback(() => {
    autosaveAbortRef.current?.abort()
    autosaveAbortRef.current = null
  }, [])

  const syncPersistedSlug = useCallback((
    persistedSlug: string,
    previousSlug: string | null,
    forceVisibleSync = false,
  ) => {
    const shouldSyncVisibleSlug = forceVisibleSync
      || !slugInputFocusedRef.current
      || latestMetaRef.current.slug === persistedSlug

    latestMetaRef.current = {
      ...latestMetaRef.current,
      editSlug: persistedSlug,
      slug: shouldSyncVisibleSlug ? persistedSlug : latestMetaRef.current.slug,
    }

    setEditSlug(persistedSlug)
    if (shouldSyncVisibleSlug) {
      setSlug(persistedSlug)
    }

    if (persistedSlug !== previousSlug) {
      window.history.replaceState({}, '', `/editor?edit=${encodeURIComponent(persistedSlug)}`)
    }
  }, [])

  const persistDraft = useCallback(async (
    nextTitle = latestTitleRef.current,
    editor = editorRef.current,
    retryAttempt = 0,
  ) => {
    if (typeof window === 'undefined' || !draftReady || !editor) return

    const { editSlug: currentSlug, slug: nextSlugRaw, category, tags, description, coverImage } = latestMetaRef.current
    const nextSlug = normalizePostSlug(nextSlugRaw)
    const normalizedTitle = nextTitle.trim() || '无标题'
    const contentJson = editor.getJSON()
    const html = editor.getHTML()
    const plainText = editor.getText({ blockSeparator: '\n\n' }).trim()
    const hasMedia = /<(img|video|audio|iframe)\b/i.test(html)
    const hasMeaningfulContent = Boolean(nextTitle.trim() || plainText || hasMedia)

    if (!hasMeaningfulContent) {
      setSaveState('saved')
      return
    }

    const normalizedDescription = (description || buildAutoDescription(plainText) || '').trim()
    const snapshot = buildAutosaveSnapshot({
      currentSlug,
      nextSlug,
      title: normalizedTitle,
      html,
      description: normalizedDescription,
      category,
      tags,
      coverImage,
    })

    if (snapshot === lastAutosaveSnapshotRef.current) {
      setSaveState('saved')
      return
    }

    const requestId = autosaveSeqRef.current + 1
    autosaveSeqRef.current = requestId

    abortAutosaveRequest()
    const controller = new AbortController()
    autosaveAbortRef.current = controller

    setSaveState('saving')

    try {
      if (currentSlug) {
        const res = await fetch('/api/posts', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            current_slug: currentSlug,
            new_slug: nextSlug && nextSlug !== currentSlug ? nextSlug : undefined,
            title: normalizedTitle,
            html,
            content: plainText || JSON.stringify(contentJson),
            description: normalizedDescription,
            category,
            tags,
            cover_image: coverImage,
          }),
          signal: controller.signal,
        })

        const data = await res.json().catch(() => ({})) as { error?: string; slug?: string }
        if (!res.ok) {
          throw new Error(data.error || '自动保存失败')
        }

        if (requestId !== autosaveSeqRef.current) return

        const persistedSlug = typeof data.slug === 'string' ? data.slug : currentSlug
        if (persistedSlug !== currentSlug || latestMetaRef.current.slug !== persistedSlug) {
          syncPersistedSlug(persistedSlug, currentSlug)
        }
      } else {
        const res = await fetch('/api/posts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: normalizedTitle,
            html,
            content: plainText || JSON.stringify(contentJson),
            category,
            status: 'draft',
            tags,
            description: normalizedDescription,
            cover_image: coverImage,
          }),
          signal: controller.signal,
        })

        const data = await res.json().catch(() => ({})) as { error?: string; slug?: string }
        if (!res.ok) {
          throw new Error(data.error || '自动保存失败')
        }

        if (requestId !== autosaveSeqRef.current) return

        if (typeof data.slug === 'string' && data.slug) {
          syncPersistedSlug(data.slug, null, true)
        }
      }

      if (requestId !== autosaveSeqRef.current) return

      lastAutosaveSnapshotRef.current = snapshot
      setSaveState('saved')
      setLastSavedAt(Date.now())
    } catch (error) {
      if (controller.signal.aborted) return
      if (requestId !== autosaveSeqRef.current) return

      console.error('Auto-save failed:', error)
      setSaveState('error')

      const nextAttempt = retryAttempt + 1
      const delay = Math.min(AUTOSAVE_MAX_RETRY_DELAY_MS, 2000 * (2 ** retryAttempt))
      retrySaveTimerRef.current = window.setTimeout(() => {
        if (editorRef.current) {
          void persistDraft(latestTitleRef.current, editorRef.current, nextAttempt)
        }
      }, delay)
    } finally {
      if (autosaveAbortRef.current === controller) {
        autosaveAbortRef.current = null
      }
    }
  }, [abortAutosaveRequest, buildAutosaveSnapshot, draftReady, syncPersistedSlug])

  // ── Draft save ──
  const scheduleDraftSave = useCallback((
    nextTitle = latestTitleRef.current,
    editor = editorRef.current,
  ) => {
    if (typeof window === 'undefined' || !draftReady || !editor) return

    latestTitleRef.current = nextTitle
    clearAutosaveTimers()
    setSaveState((prev) => (prev === 'saving' ? prev : 'dirty'))

    draftSaveTimerRef.current = window.setTimeout(() => {
      void persistDraft(nextTitle, editor)
    }, AUTOSAVE_DEBOUNCE_MS)
  }, [clearAutosaveTimers, draftReady, persistDraft])

  const markDirty = useCallback((metaOverrides?: Partial<DraftMetaState>) => {
    if (metaOverrides && Object.keys(metaOverrides).length > 0) {
      latestMetaRef.current = {
        ...latestMetaRef.current,
        ...metaOverrides,
      }
    }
    scheduleDraftSave()
  }, [scheduleDraftSave])

  const imageExtensions = useMemo(() => createEditorExtensions({
    imageActions: {
      onSetCover: (target) => {
        setCoverImage(target.src)
        markDirty({ coverImage: target.src })
        setFeedback({ type: 'success', message: '已设为封面' })
      },
      onOpenReferenceImage: (target) => {
        setReferenceImageTarget(target)
      },
      onOpenCrop: (target) => {
        setCropImageTarget(target)
      },
    },
  }), [markDirty])

  const setMetadataTargetPending = useCallback((target: MetaGenerationTarget, pending: boolean) => {
    setPendingMetadataTargets((current) => {
      if (pending) {
        return current.includes(target) ? current : [...current, target]
      }
      return current.filter((item) => item !== target)
    })
  }, [])

  const isMetadataTargetPending = useCallback(
    (target: MetaGenerationTarget) => pendingMetadataTargets.includes(target),
    [pendingMetadataTargets],
  )

  // ── File upload ──
  const uploadImageAndGetUrl = async (file: File): Promise<string> => {
    setUploadingImage(true)
    setUploadProgress(0)
    setFeedback(null)
    try {
      const optimizedFile = await optimizeImageForUpload(file, EDITOR_IMAGE_OPTIMIZE_OPTIONS)
      const result = await uploadEditorFile(optimizedFile, (p) => setUploadProgress(p))
      if (editorRef.current) scheduleDraftSave(latestTitleRef.current, editorRef.current)
      return result.url
    } catch (error) {
      setFeedback({ type: 'error', message: error instanceof Error ? error.message : '图片上传失败' })
      throw error
    } finally {
      setUploadingImage(false)
      setUploadProgress(0)
      if (fileInputRef.current) fileInputRef.current.value = ''
      if (fileUploadRef.current) fileUploadRef.current.value = ''
    }
  }

  const insertNonImageFile = async (file: File) => {
    if (file.type.startsWith('image/')) {
      try {
        const url = await uploadImageAndGetUrl(file)
        editorRef.current?.chain().focus().setImage({ src: url, alt: file.name }).run()
      } catch {}
      return
    }
    const editor = editorRef.current
    if (!editor) { setFeedback({ type: 'error', message: '编辑器还没准备好' }); return }
    setUploadingImage(true); setUploadProgress(0); setFeedback(null)
    const marker = createUploadPlaceholderMarker()
    insertUploadPlaceholder(editor, file, marker)
    try {
      const result = await uploadEditorFile(file, (p) => setUploadProgress(p))
      removeUploadPlaceholder(editor, marker)
      insertUploadedFileIntoEditor(editor, file, result)
      scheduleDraftSave(latestTitleRef.current, editor)
    } catch (error) {
      try { removeUploadPlaceholder(editor, marker) } catch {}
      setFeedback({ type: 'error', message: error instanceof Error ? error.message : '文件上传失败' })
    } finally {
      setUploadingImage(false); setUploadProgress(0)
      if (fileInputRef.current) fileInputRef.current.value = ''
      if (fileUploadRef.current) fileUploadRef.current.value = ''
    }
  }

  const handleSelectedFiles = async (files: FileList | File[] | null | undefined) => {
    const queue = files ? Array.from(files) : []
    for (const file of queue) {
      // 顺序上传，避免多文件时占位和进度条互相打架
      await insertNonImageFile(file)
    }
  }

  // ── Cover image upload ──
  const coverInputRef = useRef<HTMLInputElement>(null)
  const handleCoverUpload = async (file: File) => {
    setUploadingImage(true); setUploadProgress(0)
    try {
      const optimizedFile = await optimizeImageForUpload(file, COVER_IMAGE_OPTIMIZE_OPTIONS)
      const result = await uploadEditorFile(optimizedFile, (p) => setUploadProgress(p))
      setCoverImage(result.url)
      markDirty({ coverImage: result.url })
    } catch (error) {
      setFeedback({ type: 'error', message: error instanceof Error ? error.message : '封面上传失败' })
    } finally {
      setUploadingImage(false); setUploadProgress(0)
      if (coverInputRef.current) coverInputRef.current.value = ''
    }
  }

  const handleGenerateMetadata = (target: MetaGenerationTarget) => {
    const editor = editorRef.current
    const normalizedTitle = latestTitleRef.current.trim() || title.trim()
    const content = editor?.getText({ blockSeparator: '\n\n' }).trim() || ''

    if (!normalizedTitle && !content) {
      setFeedback({ type: 'error', message: '先写标题或正文，再生成内容。' })
      return
    }

    if (isMetadataTargetPending(target)) {
      return
    }

    setFeedback(null)

    setMetadataTargetPending(target, true)

    startBackgroundTask({
      toast,
      errorPrefix: 'AI 生成失败',
      run: async () => {
        const res = await fetch('/api/editor/ai-post-metadata', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            target,
            title: normalizedTitle,
            content,
            category,
            description,
            tags,
            currentSlug: normalizePostSlug(slug) || editSlug || '',
          }),
        })

        const data = await res.json().catch(() => ({})) as {
          error?: string
          value?: string | string[]
          image?: { url?: string }
        }

        if (!res.ok) {
          throw new Error(data.error || 'AI 生成失败')
        }

        return data
      },
      onSuccess: (data) => {
        if (target === 'summary') {
          const nextDescription = typeof data.value === 'string' ? data.value.trim() : ''
          if (!nextDescription) {
            throw new Error('摘要生成结果为空')
          }
          setDescription(nextDescription)
          markDirty({ description: nextDescription })
          return
        }

        if (target === 'tags') {
          const nextTags = Array.isArray(data.value)
            ? data.value.map((item) => String(item).trim()).filter(Boolean)
            : []

          if (nextTags.length === 0) {
            throw new Error('标签生成结果为空')
          }

          setTagInput('')
          setTags(nextTags)
          markDirty({ tags: nextTags })
          return
        }

        if (target === 'slug') {
          const nextSlug = typeof data.value === 'string' ? normalizePostSlug(data.value) : ''
          if (!nextSlug) {
            throw new Error('slug 生成结果为空')
          }

          setSlug(nextSlug)
          markDirty({ slug: nextSlug })
          return
        }

        const nextCoverImage = typeof data.image?.url === 'string' ? data.image.url : ''
        if (!nextCoverImage) {
          throw new Error('封面生成失败')
        }

        setCoverImage(nextCoverImage)
        markDirty({ coverImage: nextCoverImage })
      },
      onError: (message) => {
        setFeedback({ type: 'error', message })
      },
      onSettled: () => {
        setMetadataTargetPending(target, false)
      },
    })
  }

  // ── Save ──
  const handleSave = async () => {
    const editor = editorRef.current
    const normalizedTitle = title.trim()
    const normalizedSlug = normalizePostSlug(slug)
    if (!normalizedTitle) { setFeedback({ type: 'error', message: '先把文章标题写上。' }); return }
    if (!editor) { setFeedback({ type: 'error', message: '编辑器还没准备好。' }); return }
    const content = editor.getText({ blockSeparator: '\n\n' }).trim()
    const html = editor.getHTML()
    const hasContent = content || /<(img|video|audio|iframe)\s/.test(html)
    if (!hasContent) { setFeedback({ type: 'error', message: '正文还是空的。' }); return }
    const normalizedDescription = (description || buildAutoDescription(content) || '').trim()

    clearAutosaveTimers()
    abortAutosaveRequest()

    setSaving(true); setSaveState('saving'); setFeedback(null)

    try {
      const isEdit = editSlug !== null
      const url = isEdit ? `/api/admin/posts/${editSlug}` : '/api/posts'
      const method = isEdit ? 'PUT' : 'POST'

      let statusFields: { status: string; is_hidden: number; password?: string | null }
      if (publishStatus === 'encrypted') {
        statusFields = { status: 'published', is_hidden: 0, password: initialData?.password || generatePassword() }
      } else {
        const m = { public: { status: 'published', is_hidden: 0, password: null }, draft: { status: 'draft', is_hidden: 0, password: null }, unlisted: { status: 'published', is_hidden: 1, password: null } }
        statusFields = m[publishStatus as 'public' | 'draft' | 'unlisted']
      }

      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          slug: normalizedSlug || (isEdit ? editSlug : undefined),
          title: normalizedTitle, content, html, category,
          ...statusFields,
          tags, description: normalizedDescription, cover_image: coverImage || null,
        }),
      })
      const result = (await response.json()) as {
        success?: boolean
        slug?: string
        error?: string
      }
      if (!response.ok || !result.success) throw new Error(result.error || '保存失败')

      const persistedSlug: string | null = typeof result.slug === 'string'
        ? result.slug
        : (isEdit ? editSlug : null)
      const snapshot = buildAutosaveSnapshot({
        currentSlug: persistedSlug,
        nextSlug: persistedSlug || '',
        title: normalizedTitle,
        html,
        description: (description || buildAutoDescription(content) || '').trim(),
        category,
        tags,
        coverImage,
      })
      lastAutosaveSnapshotRef.current = snapshot

      setSaveState('saved')
      setLastSavedAt(Date.now())

      if (isEdit) {
        if (!description && normalizedDescription) {
          setDescription(normalizedDescription)
        }
        if (persistedSlug) {
          syncPersistedSlug(persistedSlug, editSlug, true)
        }
        setFeedback({ type: 'success', message: '文章已更新。', slug: persistedSlug || editSlug || undefined })
      } else {
        if (!description && normalizedDescription) {
          setDescription(normalizedDescription)
        }
        const msgs = { public: '已发布', draft: '草稿已保存', encrypted: '已发布（加密）', unlisted: '已发布（链接访问）' }
        setFeedback({ type: 'success', message: `${msgs[publishStatus]}`, slug: result.slug })
        setTitle('')
        latestTitleRef.current = ''
        lastAutosaveSnapshotRef.current = null
        editor.commands.clearContent()
      }
      setPublishPanelOpen(false)
    } catch (error) {
      setSaveState('error')
      setFeedback({ type: 'error', message: error instanceof Error ? error.message : '保存失败' })
    } finally {
      setSaving(false)
    }
  }

  const handleCopyWechat = async () => {
    const editor = editorRef.current
    const normalizedTitle = title.trim() || '无标题'

    if (!editor) {
      toast.error('编辑器还没准备好。')
      return
    }

    const content = editor.getText({ blockSeparator: '\n\n' }).trim()
    const html = editor.getHTML()
    const hasContent = content || /<(img|video|audio|iframe)\s/i.test(html)

    if (!hasContent) {
      toast.error('正文还是空的。')
      return
    }

    try {
      await copyAsWechatArticleFormat(normalizedTitle, html)
      toast.success('已复制公众号格式')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '复制公众号格式失败')
    }
  }

  const handleDownloadPdf = async () => {
    const editor = editorRef.current
    const normalizedTitle = title.trim() || '无标题'

    if (!editor) {
      toast.error('编辑器还没准备好。')
      return
    }

    const content = editor.getText({ blockSeparator: '\n\n' }).trim()
    const html = editor.getHTML()
    const hasContent = content || /<(img|video|audio|iframe)\s/i.test(html)

    if (!hasContent) {
      toast.error('正文还是空的。')
      return
    }

    try {
      await downloadArticleAsPdf(normalizedTitle, html)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '导出 PDF 失败')
    }
  }

  const handleOpenWechatPublish = () => {
    const editor = editorRef.current

    if (!editor) {
      toast.error('编辑器还没准备好。')
      return
    }

    const content = editor.getText({ blockSeparator: '\n\n' }).trim()
    const html = editor.getHTML()
    const hasContent = content || /<(img|video|audio|iframe)\s/i.test(html)

    if (!hasContent) {
      toast.error('正文还是空的。')
      return
    }

    setWechatPublishOpen(true)
  }

  // ── Tag input ──
  const [tagInput, setTagInput] = useState('')
  const addTag = (value: string) => {
    const t = value.trim().slice(0, 20)
    if (!t || tags.includes(t) || tags.length >= 10) return
    const nextTags = [...tags, t]
    setTags(nextTags)
    setTagInput('')
    markDirty({ tags: nextTags })
  }
  const removeTag = (idx: number) => {
    const nextTags = tags.filter((_, i) => i !== idx)
    setTags(nextTags)
    markDirty({ tags: nextTags })
  }

  // ── Auto resize title ──
  const autoResizeTitle = (el: HTMLTextAreaElement) => {
    resizeTextareaHeight(el)
  }

  useAutoResizeTextarea(titleRef)

  useEffect(() => {
    resizeTextareaHeight(titleRef.current)
  }, [title, sidebarOpen, draftReady])

  // ── Status config ──
  const STATUS_CONFIG = [
    { key: 'public' as const, label: '公开访问', desc: '所有人可见，出现在首页和搜索', Icon: Globe },
    { key: 'draft' as const, label: '草稿自见', desc: '仅自己可见，不会发布', Icon: Eye },
    { key: 'encrypted' as const, label: '加密访问', desc: '需要密码才能查看', Icon: Lock },
    { key: 'unlisted' as const, label: '链接访问', desc: '不在首页显示，但可通过链接访问', Icon: Link2 },
  ]

  // ── Save status display ──
  const saveStatusText = saveState === 'saved' ? `已保存 · ${relativeTime(lastSavedAt)}` :
    saveState === 'dirty' ? '未保存' : saveState === 'saving' ? '保存中…' : '保存失败'

  const saveStatusColor = saveState === 'saved' ? 'text-emerald-600' :
    saveState === 'error' ? 'text-orange-500' : 'text-[var(--stone-gray)]'

  const showSidebar = sidebarOpen
  const wechatSourceUrl = useMemo(() => {
    const currentSlug = normalizePostSlug(editSlug || slug)
    return currentSlug ? `https://${SITE_DISPLAY_URL}/${currentSlug}` : ''
  }, [editSlug, slug])

  return (
    <div className="min-h-screen bg-[var(--editor-app-bg)]">
      {/* ── Sticky Header ── */}
      <header className="sticky top-0 z-40 h-14 border-b border-[var(--editor-line)] bg-[color-mix(in_srgb,var(--background)_90%,transparent)] backdrop-blur-lg">
        <div className="flex h-full items-center gap-2 px-4">
          {/* Left: Back */}
          <Link
            href="/admin/posts"
            className="flex items-center gap-1 shrink-0 text-sm text-[var(--editor-muted)] hover:text-[var(--editor-ink)] transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            <span className="hidden sm:inline">文章列表</span>
          </Link>

          <div className="mx-1 h-4 w-px bg-[var(--editor-line)]" />

          {/* Center: Save status + Word count */}
          <div className="flex items-center gap-3 min-w-0 flex-1">
            <div className={`flex items-center gap-1.5 text-sm min-w-[140px] ${saveStatusColor}`}>
              <span className={`inline-block h-2 w-2 rounded-full shrink-0 ${
                saveState === 'saved' ? 'bg-emerald-500' :
                saveState === 'dirty' ? 'bg-gray-300' :
                saveState === 'saving' ? 'bg-gray-400 animate-pulse' : 'bg-orange-500'
              }`} />
              <span className="truncate">{saveStatusText}</span>
            </div>

            {charCount > 0 && (
              <>
                <div className="hidden sm:block h-4 w-px bg-[var(--editor-line)]" />
                <div className="hidden sm:flex items-center gap-2">
                  <span className="text-sm text-[var(--stone-gray)] whitespace-nowrap tabular-nums">
                    {charCount.toLocaleString()} 字 · {calcReadTime(charCount)}
                  </span>
                </div>
              </>
            )}
          </div>

          {/* Upload progress (overlay) */}
          {uploadingImage && (
            <div className="flex items-center gap-2 shrink-0">
              <div className="w-20 h-1.5 bg-[var(--editor-line)] rounded-full overflow-hidden">
                <div className="h-full bg-[var(--editor-accent)] transition-all duration-300" style={{ width: `${uploadProgress}%` }} />
              </div>
              <span className="text-xs text-[var(--editor-muted)] tabular-nums">{uploadProgress}%</span>
            </div>
          )}

          {/* Right: Actions */}
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={handleCopyWechat}
              className="inline-flex h-8 w-8 items-center justify-center rounded-md text-[var(--editor-muted)] hover:bg-[var(--editor-soft)] hover:text-[var(--editor-accent)] transition"
              title="复制公众号格式"
            >
              <Copy className="h-4 w-4" />
            </button>

            <button
              type="button"
              onClick={handleOpenWechatPublish}
              className="inline-flex h-8 w-8 items-center justify-center rounded-md text-[var(--editor-muted)] hover:bg-[var(--editor-soft)] hover:text-[var(--editor-accent)] transition"
              title="发布到公众号"
            >
              <Send className="h-4 w-4" />
            </button>

            <button
              type="button"
              onClick={handleDownloadPdf}
              className="inline-flex h-8 w-8 items-center justify-center rounded-md text-[var(--editor-muted)] hover:bg-[var(--editor-soft)] hover:text-[var(--editor-accent)] transition"
              title="下载 PDF"
            >
              <FileDown className="h-4 w-4" />
            </button>

            <button
              type="button"
              onClick={(e) => openDocumentAIModal(e.currentTarget)}
              className="inline-flex h-8 w-8 items-center justify-center rounded-md text-[var(--editor-muted)] hover:bg-[var(--editor-soft)] hover:text-[var(--editor-accent)] transition"
              title="Ask AI（基于标题和正文）"
            >
              <WandSparkles className="h-4 w-4" />
            </button>

            <button
              type="button"
              onClick={openDocumentImageModal}
              className="inline-flex h-8 w-8 items-center justify-center rounded-md text-[var(--editor-muted)] hover:bg-[var(--editor-soft)] hover:text-[var(--editor-accent)] transition"
              title="生成图片"
            >
              <ImageIcon className="h-4 w-4" />
            </button>

            {/* Sidebar toggle */}
            <button
              type="button"
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className="inline-flex h-8 w-8 items-center justify-center rounded-md text-[var(--editor-muted)] hover:bg-[var(--editor-soft)] transition"
              title={sidebarOpen ? '收起侧边栏' : '展开侧边栏'}
            >
              {sidebarOpen ? <PanelRightClose className="h-4 w-4" /> : <PanelRightOpen className="h-4 w-4" />}
            </button>

            <div className="mx-0.5 h-5 w-px bg-[var(--editor-line)]" />

            {/* Category selector */}
            <CategorySelector value={category} onChange={(val) => { setCategory(val); markDirty({ category: val }) }} />

            {/* Publish button + dropdown */}
            <div className="relative" ref={publishPanelRef}>
              <div className="inline-flex">
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={saving || uploadingImage}
                  className="inline-flex items-center gap-1.5 rounded-l-lg bg-[var(--editor-accent)] pl-3 pr-2 py-1.5 text-sm font-semibold text-white transition hover:brightness-105 disabled:opacity-60"
                >
                  <Globe className="h-3.5 w-3.5" />
                  {saving ? '保存中…' : editSlug ? '更新' : '发布'}
                </button>
                <button
                  type="button"
                  onClick={() => setPublishPanelOpen(!publishPanelOpen)}
                  className="inline-flex items-center rounded-r-lg bg-[var(--editor-accent)] px-1.5 py-1.5 text-white border-l border-white/25 hover:brightness-105 transition"
                >
                  <ChevronUp className={`h-3.5 w-3.5 transition-transform ${publishPanelOpen ? 'rotate-180' : ''}`} />
                </button>
              </div>

              {/* Publish panel dropdown */}
              {publishPanelOpen && (
                <div className="absolute right-0 top-full mt-2 w-72 rounded-xl border border-[var(--editor-line)] bg-[var(--editor-panel)] shadow-xl z-50 overflow-hidden">
                  <div className="px-4 pt-3 pb-2 text-xs font-semibold text-[var(--editor-muted)] uppercase tracking-wider">选择发布状态</div>
                  {STATUS_CONFIG.map(({ key, label, desc, Icon }) => {
                    const active = publishStatus === key
                    return (
                      <button
                        key={key}
                        type="button"
                        onClick={() => setPublishStatus(key)}
                        className={`w-full flex items-start gap-3 px-4 py-3 text-left hover:bg-[var(--editor-soft)] transition ${active ? 'bg-[var(--editor-accent)]/5' : ''}`}
                      >
                        <Icon className={`h-5 w-5 mt-0.5 shrink-0 ${active ? 'text-[var(--editor-accent)]' : 'text-[var(--editor-muted)]'}`} />
                        <div className="flex-1 min-w-0">
                          <div className={`text-sm font-medium ${active ? 'text-[var(--editor-accent)]' : 'text-[var(--editor-ink)]'}`}>{label}</div>
                          <div className="text-xs text-[var(--editor-muted)] mt-0.5">{desc}</div>
                        </div>
                        {active && <div className="w-2 h-2 rounded-full bg-[var(--editor-accent)] mt-1.5 shrink-0" />}
                      </button>
                    )
                  })}

                  <div className="border-t border-[var(--editor-line)] px-4 py-3">
                    <div className="flex justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => { setPublishStatus('draft'); handleSave() }}
                        disabled={saving}
                        className="px-3 py-1.5 text-sm text-[var(--editor-ink)] border border-[var(--editor-line)] rounded-lg hover:bg-[var(--editor-soft)] transition disabled:opacity-50"
                      >
                        保存草稿
                      </button>
                      <button
                        type="button"
                        onClick={handleSave}
                        disabled={saving}
                        className="px-3 py-1.5 text-sm font-semibold text-white bg-[var(--editor-accent)] rounded-lg hover:brightness-105 transition disabled:opacity-50"
                      >
                        {saving ? '保存中…' : editSlug ? '更新文章' : '发布'}
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Feedback bar */}
        {feedback && (
          <div className="border-t border-[var(--editor-line)] px-4 py-2">
            <div className={`flex items-center gap-2 rounded-md px-3 py-2 text-sm ${
              feedback.type === 'success' ? 'bg-emerald-50 text-emerald-800' : 'bg-rose-50 text-rose-800'
            }`}>
              <span>{feedback.message}</span>
              {feedback.slug && (
                <a href={`/${feedback.slug}`} className="font-medium underline underline-offset-2">打开文章</a>
              )}
              <button type="button" onClick={() => setFeedback(null)} className="ml-auto"><X className="h-3.5 w-3.5" /></button>
            </div>
          </div>
        )}
      </header>

      {/* Hidden file inputs */}
      <input ref={fileInputRef} type="file" accept="image/*" multiple className="hidden" onChange={e => { void handleSelectedFiles(e.target.files) }} />
      <input ref={fileUploadRef} type="file" accept="video/*,audio/*,.pdf,.zip,.rar,.7z,.epub,.mobi,.azw,.azw3,.txt,image/*" multiple className="hidden" onChange={e => { void handleSelectedFiles(e.target.files) }} />
      <input ref={coverInputRef} type="file" accept="image/*" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) void handleCoverUpload(f) }} />

      {/* ── Main layout: editor + sidebar ── */}
      <div className="flex">
        {/* Main editor area */}
        <main className="flex-1 min-w-0">
          <div className="mx-auto max-w-4xl px-4 pt-10 pb-8 sm:px-6">
            {/* Title input */}
            <div className="pb-4">
              <textarea
                ref={titleRef}
                placeholder="无标题"
                value={title}
                rows={1}
                onChange={(e) => {
                  const v = e.target.value
                  setTitle(v)
                  latestTitleRef.current = v
                  autoResizeTitle(e.target)
                  markDirty()
                  if (feedback?.type === 'error') setFeedback(null)
                }}
                onPaste={(e) => {
                  const files = extractFilesFromClipboard(e)
                  if (files.length === 0) return

                  e.preventDefault()
                  editorRef.current?.chain().focus().run()
                  void handleSelectedFiles(files)
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    editorRef.current?.chain().focus().run()
                  }
                }}
                className="editor-title-textarea block w-full appearance-none bg-transparent p-0 m-0 resize-none overflow-hidden border-0 rounded-none shadow-none outline-none ring-0 focus:border-0 focus:outline-none focus:ring-0 focus-visible:outline-none focus-visible:ring-0 text-4xl font-bold leading-tight tracking-tight text-[var(--editor-ink)] placeholder:text-[var(--stone-gray)]"
                style={{ minHeight: '52px' }}
              />
            </div>

            {/* Novel editor */}
            {!draftReady ? (
              <div className="editor-surface" />
            ) : (
              <EditorRoot>
                <div>
                  <EditorContent
                    initialContent={initialContent}
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    extensions={imageExtensions as any}
                    className="editor-surface"
                    immediatelyRender={false}
                    editorProps={buildEditorProps(
                      (file) => uploadImageAndGetUrl(file),
                      (file) => void insertNonImageFile(file),
                      'editor-main-prose',
                    )}
                    onCreate={({ editor }) => {
                      editorRef.current = editor
                      // eslint-disable-next-line @typescript-eslint/no-explicit-any
                      const st = editor.storage as any
                      setCharCount(st.characterCount?.characters?.() ?? 0)
                      if (initialData?.html) {
                        skipNextEditorUpdateRef.current = true
                        editor.commands.setContent(initialData.html)
                      } else {
                        skipNextEditorUpdateRef.current = false
                      }

                      if (initialData?.slug) {
                        lastAutosaveSnapshotRef.current = buildAutosaveSnapshot({
                          currentSlug: initialData.slug,
                          nextSlug: initialData.slug,
                          title: initialData.title || '无标题',
                          html: initialData.html || '',
                          description: (initialData.description || '').trim(),
                          category: initialData.category || '未分类',
                          tags: initialData.tags || [],
                          coverImage: initialData.cover_image || '',
                        })
                      } else {
                        lastAutosaveSnapshotRef.current = null
                      }
                    }}
                    onUpdate={({ editor }) => {
                      editorRef.current = editor

                      if (skipNextEditorUpdateRef.current) {
                        skipNextEditorUpdateRef.current = false
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        const st = editor.storage as any
                        setCharCount(st.characterCount?.characters?.() ?? 0)
                        return
                      }

                      scheduleDraftSave(latestTitleRef.current, editor)
                      // eslint-disable-next-line @typescript-eslint/no-explicit-any
                      const st = editor.storage as any
                      setCharCount(st.characterCount?.characters?.() ?? 0)
                    }}
                  >
                    <FormattingBubble />
                    <TableBubble />
                    <SlashMenu />
                  </EditorContent>
                </div>
              </EditorRoot>
            )}
          </div>
        </main>

        {/* ── Right Sidebar ── */}
        <aside
          className={`shrink-0 border-l border-[var(--editor-line)] bg-[var(--background)] overflow-y-auto overflow-x-hidden transition-all duration-200 ease-in-out ${
            showSidebar ? 'w-[280px]' : 'w-0 border-l-0'
          }`}
          style={{ position: 'sticky', top: '3.5rem', height: 'calc(100vh - 3.5rem)' }}
        >
          {showSidebar && (
            <div className="w-[280px] px-5 py-6 space-y-6">
              {/* Close button */}
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-[var(--stone-gray)] uppercase tracking-wider">文章设置</span>
                <button type="button" onClick={() => setSidebarOpen(false)} className="text-[var(--stone-gray)] hover:text-[var(--editor-ink)]">
                  <X className="h-4 w-4" />
                </button>
              </div>

              {/* Tags */}
              <div>
                <div className="mb-2 flex items-center justify-between gap-2">
                  <label className="block text-xs font-semibold tracking-wider text-[var(--stone-gray)]">标签</label>
                  <button
                    type="button"
                    onClick={() => void handleGenerateMetadata('tags')}
                    disabled={isMetadataTargetPending('tags')}
                    className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-[var(--editor-line)] bg-[var(--editor-panel)] text-[var(--stone-gray)] transition hover:border-[var(--editor-accent)]/40 hover:text-[var(--editor-accent)] disabled:cursor-not-allowed disabled:opacity-50"
                    title="AI 生成标签"
                    aria-label="AI 生成标签"
                  >
                    {isMetadataTargetPending('tags') ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <WandSparkles className="h-3.5 w-3.5" />}
                  </button>
                </div>
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {tags.map((tag, idx) => (
                    <span key={tag} className="inline-flex items-center gap-1 rounded-md bg-[var(--editor-accent)]/8 px-2 py-0.5 text-xs text-[var(--editor-accent)]">
                      {tag}
                      <button type="button" onClick={() => removeTag(idx)} className="hover:text-[var(--editor-ink)]">
                        <X className="h-3 w-3" />
                      </button>
                    </span>
                  ))}
                </div>
                {tags.length < 10 && (
                  <input
                    type="text"
                    value={tagInput}
                    onChange={e => setTagInput(e.target.value)}
                    onKeyDown={e => {
                      if ((e.key === 'Enter' || e.key === ',') && tagInput.trim()) {
                        e.preventDefault(); addTag(tagInput)
                      }
                      if (e.key === 'Backspace' && !tagInput && tags.length > 0) removeTag(tags.length - 1)
                    }}
                    placeholder="添加标签…"
                    className="w-full rounded-md border border-[var(--editor-line)] bg-[var(--editor-panel)] px-2.5 py-1.5 text-sm text-[var(--editor-ink)] outline-none focus:border-[var(--editor-accent)]"
                  />
                )}
              </div>

              {/* Description / Excerpt */}
              <div>
                <div className="mb-2 flex items-center justify-between gap-2">
                  <label className="block text-xs font-semibold tracking-wider text-[var(--stone-gray)]">摘要</label>
                  <button
                    type="button"
                    onClick={() => void handleGenerateMetadata('summary')}
                    disabled={isMetadataTargetPending('summary')}
                    className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-[var(--editor-line)] bg-[var(--editor-panel)] text-[var(--stone-gray)] transition hover:border-[var(--editor-accent)]/40 hover:text-[var(--editor-accent)] disabled:cursor-not-allowed disabled:opacity-50"
                    title="AI 生成摘要"
                    aria-label="AI 生成摘要"
                  >
                    {isMetadataTargetPending('summary') ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <WandSparkles className="h-3.5 w-3.5" />}
                  </button>
                </div>
                <textarea
                  rows={4}
                  value={description}
                  onChange={e => {
                    const nextDescription = e.target.value
                    setDescription(nextDescription)
                    markDirty({ description: nextDescription })
                  }}
                  placeholder="文章摘要（建议 ≤ 160 字）"
                  className="w-full rounded-md border border-[var(--editor-line)] bg-[var(--editor-panel)] px-2.5 py-2 text-sm text-[var(--editor-ink)] outline-none resize-none focus:border-[var(--editor-accent)]"
                />
                <div className="mt-1 text-right text-[10px] text-[var(--stone-gray)]">{description.length}/160</div>
              </div>

              {/* Cover Image */}
              <div>
                <div className="mb-2 flex items-center justify-between gap-2">
                  <label className="block text-xs font-semibold tracking-wider text-[var(--stone-gray)]">封面图</label>
                  <button
                    type="button"
                    onClick={() => void handleGenerateMetadata('cover')}
                    disabled={isMetadataTargetPending('cover')}
                    className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-[var(--editor-line)] bg-[var(--editor-panel)] text-[var(--stone-gray)] transition hover:border-[var(--editor-accent)]/40 hover:text-[var(--editor-accent)] disabled:cursor-not-allowed disabled:opacity-50"
                    title="AI 生成封面"
                    aria-label="AI 生成封面"
                  >
                    {isMetadataTargetPending('cover') ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <WandSparkles className="h-3.5 w-3.5" />}
                  </button>
                </div>
                {coverImage ? (
                  <div className="relative rounded-md overflow-hidden border border-[var(--editor-line)] group" style={{ height: 120 }}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={coverImage} alt="封面预览" className="w-full h-full object-cover" />
                    {/* 悬停时显示的操作按钮 */}
                    <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                      <button
                        type="button"
                        onClick={() => coverInputRef.current?.click()}
                        className="flex items-center justify-center w-9 h-9 rounded-full bg-[var(--editor-panel)] text-[var(--editor-ink)] hover:bg-[var(--editor-soft)] transition"
                        title="重新上传"
                      >
                        <ImageIcon className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setCoverImage('')
                          markDirty({ coverImage: '' })
                        }}
                        className="flex items-center justify-center w-9 h-9 rounded-full bg-[var(--editor-panel)] text-rose-600 hover:bg-[var(--editor-soft)] transition"
                        title="删除封面"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => coverInputRef.current?.click()}
                    onDrop={e => {
                      e.preventDefault()
                      const f = e.dataTransfer.files[0]
                      if (f?.type.startsWith('image/')) void handleCoverUpload(f)
                    }}
                    onDragOver={e => e.preventDefault()}
                    className="flex w-full flex-col items-center justify-center gap-2 rounded-md border-2 border-dashed border-[var(--editor-line)] py-8 text-[var(--stone-gray)] hover:border-[var(--editor-accent)]/40 hover:text-[var(--editor-accent)] transition"
                  >
                    <ImageIcon className="h-6 w-6" />
                    <span className="text-xs">点击或拖拽上传封面</span>
                  </button>
                )}
              </div>

              {/* Slug */}
              <div>
                <div className="mb-2 flex items-center justify-between gap-2">
                  <label className="block text-xs font-semibold tracking-wider text-[var(--stone-gray)]">链接</label>
                  <button
                    type="button"
                    onClick={() => void handleGenerateMetadata('slug')}
                    disabled={isMetadataTargetPending('slug')}
                    className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-[var(--editor-line)] bg-[var(--editor-panel)] text-[var(--stone-gray)] transition hover:border-[var(--editor-accent)]/40 hover:text-[var(--editor-accent)] disabled:cursor-not-allowed disabled:opacity-50"
                    title="AI 生成 slug"
                    aria-label="AI 生成 slug"
                  >
                    {isMetadataTargetPending('slug') ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <WandSparkles className="h-3.5 w-3.5" />}
                  </button>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-[var(--stone-gray)] shrink-0">slug:</span>
                  <input
                    type="text"
                    value={slug}
                    onFocus={() => {
                      slugInputFocusedRef.current = true
                    }}
                    onChange={e => {
                      const nextSlug = sanitizePostSlugInput(e.target.value)
                      setSlug(nextSlug)
                      markDirty({ slug: nextSlug })
                    }}
                    onBlur={e => {
                      slugInputFocusedRef.current = false
                      const normalizedSlug = normalizePostSlug(e.target.value)
                      if (normalizedSlug !== slug) {
                        setSlug(normalizedSlug)
                        markDirty({ slug: normalizedSlug })
                      }
                    }}
                    placeholder={editSlug || 'auto-generated'}
                    className="flex-1 rounded-md border border-[var(--editor-line)] bg-[var(--editor-panel)] px-2 py-1.5 text-sm text-[var(--editor-ink)] outline-none focus:border-[var(--editor-accent)]"
                  />
                </div>
                <div className="mt-1 text-[10px] text-[var(--stone-gray)]">
                  {SITE_DISPLAY_URL}/{normalizePostSlug(slug) || editSlug || '自动生成'}
                </div>
              </div>
            </div>
          )}
        </aside>
      </div>

      <WeChatPublishModal
        isOpen={wechatPublishOpen}
        onClose={() => setWechatPublishOpen(false)}
        title={title.trim() || '无标题'}
        html={editorRef.current?.getHTML() || ''}
        defaultDigest={description}
        defaultSourceUrl={wechatSourceUrl}
        defaultCoverImageUrl={resolvePostCoverImage({
          cover_image: coverImage,
          slug: normalizePostSlug(slug) || editSlug || title,
          title,
        })}
      />

      <InputModal open={inputModal.open} title={inputModal.title} placeholder={inputModal.placeholder} onConfirm={handleInputModalConfirm} onCancel={handleInputModalCancel} />

      <ImageGenerationModal
        open={imageModal.open}
        contextText={imageModal.contextText}
        historyScope="admin-editor"
        closeOnGenerate={false}
        onClose={closeImageModal}
        onInsert={insertGeneratedImage}
      />

      <ImageGenerationModal
        open={Boolean(referenceImageTarget)}
        contextText=""
        historyScope="admin-editor"
        referenceImageUrl={referenceImageTarget?.src}
        allowReplace
        defaultPlacementMode="replace"
        closeOnGenerate={false}
        generationMode="foreground"
        onClose={() => setReferenceImageTarget(null)}
        onInsert={(imageUrl, alt, placementMode) => {
          if (!referenceImageTarget) return
          applyImageActionResult(referenceImageTarget, imageUrl, alt, placementMode ?? 'replace')
          setReferenceImageTarget(null)
        }}
      />

      <ImageCropModal
        open={Boolean(cropImageTarget)}
        imageUrl={cropImageTarget?.src || ''}
        imageAlt={cropImageTarget?.alt}
        defaultPlacementMode="replace"
        onClose={() => setCropImageTarget(null)}
        onApply={async (file, placementMode) => {
          if (!cropImageTarget) return

          const uploaded = await uploadImageAndGetUrl(file)
          applyImageActionResult(cropImageTarget, uploaded, cropImageTarget.alt || file.name, placementMode)
          setCropImageTarget(null)
        }}
      />

      {editorRef.current && (
        <AIModal
          editor={editorRef.current}
          isOpen={aiModal.open}
          onClose={closeAiModal}
          selectedText={aiModal.selectedText}
          position={aiModal.position}
          selectionRange={aiModal.selectionRange}
          initialContext={aiModal.initialContext}
          documentTitle={aiModal.documentTitle}
          documentText={aiModal.documentText}
          historyScope="admin-editor"
          onApplyTitle={(nextTitle) => {
            latestTitleRef.current = nextTitle
            setTitle(nextTitle)
            markDirty()
          }}
        />
      )}
    </div>
  )
}
