'use client'

import { PublishChannelMenu } from '@/components/PublishChannelMenu'

import Link from 'next/link'
import dynamic from 'next/dynamic'
import { useRef, useState, useCallback, useEffect, useMemo } from 'react'
import { Download, FileDown, ImageIcon, Pilcrow, WandSparkles } from 'lucide-react'
import {
  EditorContent,
  EditorInstance,
  EditorRoot,
} from 'novel'
import {
  createEditorExtensions,
  buildEditorProps,
  formatChineseCopywritingInEditor,
  type ChineseCopywritingScope,
  FormattingBubble,
  SlashMenu,
} from '@/lib/editor-extensions'
import { EditorTocRail } from '@/components/ArticleToc'
import { InputModal } from '@/components/InputModal'
import { CategorySelector } from '@/components/CategorySelector'
import { CopyFormatDropdown, downloadMarkdownFromHtml } from '@/components/DownloadMarkdown'
import { useToast } from '@/components/Toast'
import { EDITOR_IMAGE_OPTIMIZE_OPTIONS, optimizeImageForUpload } from '@/lib/client-image'
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
import {
  extractFilesFromClipboard,
  useEditorAuxiliaryModals,
  useEditorUploadTriggers,
} from '@/lib/editor-ui'
import type { EditorImageActionTarget } from '@/lib/resizable-image'
import { resolvePostCoverImage } from '@/lib/default-cover-images'
import { buildAutoDescription } from '@/lib/post-utils'
import { getSiteDisplayUrl } from '@/lib/site-config'
import { resizeTextareaHeight, useAutoResizeTextarea } from '@/lib/textarea-autosize'
import { focusEditorDocumentStart, isTitleEndEnter } from '@/lib/editor-title-navigation'
import { normalizeWechatPublishingHtml } from '@/lib/wechat-publishing-enhancements'
import {
  extractTocFromTiptapDoc,
  type ArticleTocItem,
} from '@/lib/article-toc'

const ImageGenerationModal = dynamic(() => import('@/components/ImageGenerationModal').then(m => m.ImageGenerationModal), { ssr: false })
const ImageCropModal = dynamic(() => import('@/components/ImageCropModal').then(m => m.ImageCropModal), { ssr: false })
const ImageToolModal = dynamic(() => import('@/components/ImageToolModal').then(m => m.ImageToolModal), { ssr: false })
const WeChatPublishModal = dynamic(() => import('@/components/WeChatPublishModal').then(m => m.WeChatPublishModal), { ssr: false })
const AIModal = dynamic(() => import('@/lib/ai-modal').then(m => m.AIModal), { ssr: false })

interface InlineArticleEditorProps {
  postId?: number | null
  slug: string
  title: string
  html: string
  category?: string | null
  coverImage?: string | null
  password?: string | null // 仅用于显示加密状态，不可编辑
  publishedAt?: number    // unix timestamp
  viewCount?: number
  content?: string        // plain text, for reading time
  onExitReading?: () => void
}

function syncInlineHeadingAnchors(root: HTMLElement | null, tocItems: ArticleTocItem[]) {
  if (!root || tocItems.length === 0) return

  const headings = Array.from(root.querySelectorAll<HTMLElement>('h1, h2, h3'))
  for (const [index, item] of tocItems.entries()) {
    const heading = headings[index]
    if (!heading) continue
    heading.id = item.id
  }
}

export function InlineArticleEditor({
  postId = null,
  slug,
  title: initialTitle,
  html,
  category,
  coverImage: initialCoverImage,
  password,
  publishedAt,
  viewCount,
  content,
  onExitReading,
}: InlineArticleEditorProps) {
  const normalizedInitialHtml = useMemo(() => normalizeWechatPublishingHtml(html), [html])
  const editorRef = useRef<EditorInstance | null>(null)
  const titleRef = useRef<HTMLTextAreaElement | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const fileUploadRef = useRef<HTMLInputElement>(null)
  const copywritingMenuRef = useRef<HTMLSpanElement | null>(null)
  const originalHtmlRef = useRef(normalizedInitialHtml)
  const originalTitleRef = useRef(initialTitle)
  const originalCoverImageRef = useRef(initialCoverImage || '')
  const titleValueRef = useRef(initialTitle)
  const [title, setTitle] = useState(initialTitle)
  const [selectedCategory, setSelectedCategory] = useState(category || '未分类')
  const originalCategoryRef = useRef(category || '未分类')
  const categoryValueRef = useRef(category || '未分类')
  const [coverImage, setCoverImage] = useState(initialCoverImage || '')
  const coverImageValueRef = useRef(initialCoverImage || '')
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [uploadingFile, setUploadingFile] = useState(false)
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null)
  const [charCount, setCharCount] = useState(0)
  const [referenceImageTarget, setReferenceImageTarget] = useState<EditorImageActionTarget | null>(null)
  const [cropImageTarget, setCropImageTarget] = useState<EditorImageActionTarget | null>(null)
  const [wechatPublishOpen, setWechatPublishOpen] = useState(false)
  const [copywritingMenuOpen, setCopywritingMenuOpen] = useState(false)
  const [tocItems, setTocItems] = useState<ArticleTocItem[]>([])
  const [activeTocId, setActiveTocId] = useState('')
  const [tocCollapsed, setTocCollapsed] = useState(false)
  const toast = useToast()
  const siteDisplayUrl = getSiteDisplayUrl()

  const checkDirty = useCallback((editor: EditorInstance, overrides?: {
    title?: string
    category?: string
    coverImage?: string
  }) => {
    const htmlChanged = editor.getHTML() !== originalHtmlRef.current
    const titleChanged = (overrides?.title ?? titleValueRef.current) !== originalTitleRef.current
    const catChanged = (overrides?.category ?? categoryValueRef.current) !== originalCategoryRef.current
    const coverChanged = (overrides?.coverImage ?? coverImageValueRef.current) !== originalCoverImageRef.current
    setDirty(htmlChanged || titleChanged || catChanged || coverChanged)
  }, [])

  useEffect(() => {
    titleValueRef.current = title
  }, [title])

  useEffect(() => {
    categoryValueRef.current = selectedCategory
  }, [selectedCategory])

  useEffect(() => {
    coverImageValueRef.current = coverImage
  }, [coverImage])

  useEffect(() => {
    if (!copywritingMenuOpen) return

    const handler = (event: MouseEvent) => {
      if (copywritingMenuRef.current && !copywritingMenuRef.current.contains(event.target as Node)) {
        setCopywritingMenuOpen(false)
      }
    }

    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [copywritingMenuOpen])

  const refreshToc = useCallback((editor: EditorInstance | null) => {
    const items = extractTocFromTiptapDoc(editor?.state.doc)
    setTocItems(items)
    setActiveTocId((currentId) => {
      if (items.length === 0) return ''
      if (currentId && items.some((item) => item.id === currentId)) return currentId
      return items[0]?.id || ''
    })
    window.requestAnimationFrame(() => {
      syncInlineHeadingAnchors(editor?.view.dom as HTMLElement | null, items)
    })
  }, [])

  const scrollToTocItem = useCallback((item: ArticleTocItem) => {
    setActiveTocId(item.id)

    const editor = editorRef.current
    if (!editor) return

    const rawPos = Number.isFinite(item.pos) ? Number(item.pos) : 1
    const selectionPos = Math.min(Math.max(rawPos + 1, 1), editor.state.doc.content.size)
    editor.chain().focus().setTextSelection(selectionPos).run()

    window.requestAnimationFrame(() => {
      try {
        const coords = editor.view.coordsAtPos(selectionPos)
        window.scrollTo({ top: Math.max(0, coords.top + window.scrollY - 82), behavior: 'smooth' })
        return
      } catch {}

      const target = editor.view.dom.querySelector<HTMLElement>(`#${CSS.escape(item.id)}`)
      if (target) {
        const top = target.getBoundingClientRect().top + window.scrollY - 82
        window.scrollTo({ top: Math.max(0, top), behavior: 'smooth' })
      }
    })
  }, [])

  const handleSave = async () => {
    const editor = editorRef.current
    if (!editor) return

    setSaving(true)
    setFeedback(null)

    try {
      const newHtml = editor.getHTML()
      const content = editor.getText({ blockSeparator: '\n\n' }).trim()
      const trimmedTitle = title.trim()
      if (!trimmedTitle) {
        setFeedback({ type: 'error', message: '标题不能为空' })
        setSaving(false)
        return
      }

      const res = await fetch(`/api/admin/posts/${slug}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: trimmedTitle,
          html: newHtml,
          content,
          category: selectedCategory,
          cover_image: coverImage || null,
          // 密码管理统一到后台，前台不再修改
        }),
      })

      const text = await res.text()
      let result: { success?: boolean; error?: string }
      try {
        result = JSON.parse(text)
      } catch {
        throw new Error(`服务器返回异常 (${res.status}): ${text.slice(0, 120)}`)
      }
      if (!res.ok || !result.success) throw new Error(result.error || '保存失败')

      originalHtmlRef.current = newHtml
      originalTitleRef.current = trimmedTitle
      originalCategoryRef.current = selectedCategory
      originalCoverImageRef.current = coverImage
      setDirty(false)
      setFeedback({ type: 'success', message: '已保存' })
      setTimeout(() => setFeedback(null), 2000)
    } catch (err) {
      setFeedback({ type: 'error', message: err instanceof Error ? err.message : '保存失败' })
    } finally {
      setSaving(false)
    }
  }

  const handleDiscard = () => {
    const editor = editorRef.current
    if (!editor) return
    editor.commands.setContent(originalHtmlRef.current)
    setTitle(originalTitleRef.current)
    setSelectedCategory(originalCategoryRef.current)
    setCoverImage(originalCoverImageRef.current)
    setDirty(false)
    setFeedback(null)
  }

  const getCurrentExport = () => {
    const editor = editorRef.current
    const normalizedTitle = titleValueRef.current.trim() || '无标题'
    const currentHtml = editor?.getHTML() || originalHtmlRef.current
    const currentText = editor?.getText({ blockSeparator: '\n\n' }).trim() || ''
    const hasContent = currentText || /<(img|video|audio|iframe)\s/i.test(currentHtml)

    return {
      title: normalizedTitle,
      html: currentHtml,
      text: currentText,
      hasContent: Boolean(hasContent),
    }
  }

  const handleDownloadMarkdown = () => {
    const current = getCurrentExport()
    if (!current.hasContent) {
      toast.error('正文还是空的。')
      return
    }
    downloadMarkdownFromHtml(current.title, current.html)
  }

  const getCurrentAssetArticleTarget = useCallback(() => ({
    postId,
    slug,
  }), [postId, slug])

  const handleDownloadPdf = async () => {
    const current = getCurrentExport()
    if (!current.hasContent) {
      toast.error('正文还是空的。')
      return
    }

    try {
      const { downloadArticleAsPdf } = await import('@/lib/wechat-copy')
      await downloadArticleAsPdf(current.title, current.html)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '导出 PDF 失败')
    }
  }

  const handleOpenWechatPublish = () => {
    const current = getCurrentExport()
    if (!current.hasContent) {
      toast.error('正文还是空的。')
      return
    }
    setWechatPublishOpen(true)
  }

  const handleFormatCopywriting = useCallback((scope: ChineseCopywritingScope) => {
    const editor = editorRef.current
    if (!editor) {
      toast.error('编辑器还没准备好。')
      return
    }

    const changed = formatChineseCopywritingInEditor(editor, scope)
    setCopywritingMenuOpen(false)

    if (!changed) {
      toast.info(scope === 'document' ? '全文排版已是整理状态' : '当前段落已是整理状态')
      return
    }

    checkDirty(editor)
    toast.success(scope === 'document' ? '已整理全文排版' : '已整理当前段落')
  }, [checkDirty, toast])

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

    checkDirty(editor)
  }, [checkDirty])

  // Image-only upload: returns URL for Novel's UploadImagesPlugin
  const uploadImageAndGetUrl = async (file: File): Promise<string> => {
    setUploadingFile(true)
    setFeedback(null)
    try {
      const optimizedFile = await optimizeImageForUpload(file, EDITOR_IMAGE_OPTIMIZE_OPTIONS)
      const result = await uploadEditorFile(optimizedFile, undefined, {
        ...getCurrentAssetArticleTarget(),
        role: 'inline',
        source: 'upload',
      })
      const editor = editorRef.current
      if (editor) checkDirty(editor)
      return result.url
    } catch (error) {
      setFeedback({
        type: 'error',
        message: error instanceof Error ? error.message : '图片上传失败',
      })
      throw error
    } finally {
      setUploadingFile(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  // Non-image file upload (video, audio, documents) with text placeholder
  const insertNonImageFile = async (file: File) => {
    // Images from file picker route through the image upload path
    if (file.type.startsWith('image/')) {
      try {
        const url = await uploadImageAndGetUrl(file)
        const editor = editorRef.current
        if (editor) editor.chain().focus().setImage({ src: url, alt: file.name }).run()
      } catch { /* error already shown via feedback */ }
      return
    }

    const editor = editorRef.current

    if (!editor) {
      setFeedback({ type: 'error', message: '编辑器还没准备好，请稍后再试。' })
      return
    }

    setUploadingFile(true)
    setFeedback(null)

    // 插入占位符
    const placeholderMarker = createUploadPlaceholderMarker()
    insertUploadPlaceholder(editor, file, placeholderMarker)

    try {
      const result = await uploadEditorFile(file)

      removeUploadPlaceholder(editor, placeholderMarker)
      insertUploadedFileIntoEditor(editor, file, result)

      checkDirty(editor)
    } catch (error) {
      console.error(error)
      // 移除占位符
      try { removeUploadPlaceholder(editor, placeholderMarker) } catch {}
      setFeedback({
        type: 'error',
        message: error instanceof Error ? error.message : '文件上传失败',
      })
    } finally {
      setUploadingFile(false)
      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
      if (fileUploadRef.current) {
        fileUploadRef.current.value = ''
      }
    }
  }

  const insertGeneratedImage = useCallback((imageUrl: string, alt: string) => {
    const editor = editorRef.current
    if (!editor) return
    insertGeneratedImageAtPosition(editor, imageUrl, alt, imageModal.insertPos)

    checkDirty(editor)
    closeImageModal()
  }, [checkDirty, closeImageModal, imageModal.insertPos])

  const imageExtensions = useMemo(() => createEditorExtensions({
    imageActions: {
      onSetCover: (target) => {
        setCoverImage(target.src)
        if (editorRef.current) {
          checkDirty(editorRef.current, { coverImage: target.src })
        }
        setFeedback({ type: 'success', message: '已设为封面，记得保存' })
        window.setTimeout(() => setFeedback((current) => current?.type === 'success' ? null : current), 1600)
      },
      onOpenReferenceImage: (target) => {
        setReferenceImageTarget(target)
      },
      onOpenCrop: (target) => {
        setCropImageTarget(target)
      },
    },
  }), [checkDirty])

  const handleSelectedFiles = async (files: FileList | File[] | null | undefined) => {
    const queue = files ? Array.from(files) : []
    for (const file of queue) {
      await insertNonImageFile(file)
    }
  }

  const insertCollageImage = async (file: File, targetInsertPos: number | null) => {
    const editor = editorRef.current
    if (!editor) {
      setFeedback({ type: 'error', message: '编辑器还没准备好，请稍后再试。' })
      return
    }

    setUploadingFile(true)
    setFeedback(null)

    try {
      const result = await uploadEditorFile(file, undefined, {
        ...getCurrentAssetArticleTarget(),
        role: 'inline',
        source: 'collage',
      })
      insertGeneratedImageAtPosition(editor, result.url, file.name || '拼图', targetInsertPos)
      checkDirty(editor)
    } catch (error) {
      setFeedback({
        type: 'error',
        message: error instanceof Error ? error.message : '拼图上传失败',
      })
      throw error
    } finally {
      setUploadingFile(false)
    }
  }

  const autoResizeTitle = (el: HTMLTextAreaElement) => {
    resizeTextareaHeight(el)
  }

  useAutoResizeTextarea(titleRef)

  useEffect(() => {
    resizeTextareaHeight(titleRef.current)
  }, [title])

  const syncEditorState = useCallback((editor: EditorInstance) => {
    checkDirty(editor)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const st = editor.storage as any
    setCharCount(st.characterCount?.characters?.() ?? 0)
    refreshToc(editor)
  }, [checkDirty, refreshToc])

  const handleEditorCompositionEnd = useCallback(() => {
    const editor = editorRef.current
    if (!editor) return
    syncEditorState(editor)
  }, [syncEditorState])

  const editorProps = buildEditorProps(
    (file) => uploadImageAndGetUrl(file),
    (file) => void insertNonImageFile(file),
    'inline-main-prose',
    handleEditorCompositionEnd,
  )
  const currentExport = getCurrentExport()
  const estimatedCharCount = charCount || content?.length || 0

  return (
    <>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(event) => {
          void handleSelectedFiles(event.target.files)
        }}
      />
      <input
        ref={fileUploadRef}
        type="file"
        accept="video/*,audio/*,.pdf,.zip,.rar,.7z,.epub,.mobi,.azw,.azw3,.txt,image/*"
        multiple
        className="hidden"
        onChange={(event) => {
          void handleSelectedFiles(event.target.files)
        }}
      />

      {/* 右上角固顶状态栏：模式切换 + 保存 */}
      <div className="fixed top-16 right-4 sm:right-6 z-50 flex items-center gap-2 rounded-lg border border-[var(--editor-line)] bg-[var(--editor-panel)] backdrop-blur px-3 py-2 shadow-lg text-xs">
        {onExitReading ? (
          <>
            <button
              type="button"
              onClick={onExitReading}
              className="px-2 py-1 rounded-md border border-[var(--editor-line)] text-[var(--editor-ink)] hover:bg-[var(--editor-soft)] transition"
            >
              阅读
            </button>
            <Link
              href={`/editor?edit=${encodeURIComponent(slug)}`}
              className="px-2 py-1 rounded-md border border-[var(--editor-line)] text-[var(--editor-ink)] hover:bg-[var(--editor-soft)] transition"
            >
              后台
            </Link>
          </>
        ) : null}
        {feedback ? (
          <span className={`font-medium ${feedback.type === 'success' ? 'text-emerald-600' : 'text-rose-600'}`}>
            {feedback.message}
          </span>
        ) : dirty ? (
          <>
            {onExitReading && <span className="text-[var(--editor-line)]" aria-hidden>|</span>}
            <button
              type="button"
              onClick={handleDiscard}
              disabled={saving}
              className="px-2 py-1 rounded-md border border-[var(--editor-line)] text-[var(--editor-ink)] hover:bg-[var(--editor-soft)] transition disabled:opacity-50"
            >
              放弃
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="px-2 py-1 rounded-md bg-[var(--editor-ink)] text-white font-medium hover:brightness-110 transition disabled:opacity-50"
            >
              {saving ? '保存中…' : '保存'}
            </button>
          </>
        ) : uploadingFile ? (
          <span className="text-[var(--editor-muted)]">上传中…</span>
        ) : null}
      </div>

      <div>
        <EditorTocRail
          items={tocItems}
          collapsed={tocCollapsed}
          onCollapsedChange={setTocCollapsed}
          activeId={activeTocId}
          onActiveIdChange={setActiveTocId}
          onItemSelect={scrollToTocItem}
          root={editorRef.current?.view.dom as HTMLElement | null}
          variant="article-fixed"
        />

        <div className="min-w-0 flex-1">
          {/* 可编辑标题 */}
          <textarea
            ref={titleRef}
            rows={1}
            value={title}
            onChange={(e) => {
              const next = e.target.value
              setTitle(next)
              autoResizeTitle(e.target)
              if (editorRef.current) checkDirty(editorRef.current, { title: next })
            }}
            onPaste={(e) => {
              const files = extractFilesFromClipboard(e)
              if (files.length === 0) return
              e.preventDefault()
              editorRef.current?.chain().focus().run()
              void handleSelectedFiles(files)
            }}
            onKeyDown={(event) => {
              if (!isTitleEndEnter(event) || !editorRef.current) return
              event.preventDefault()
              focusEditorDocumentStart(editorRef.current)
            }}
            className="editor-title-textarea mb-2 block w-full resize-none overflow-hidden border-0 bg-transparent p-0 text-2xl font-bold leading-tight text-[var(--editor-ink)] outline-none shadow-none focus:outline-none focus-visible:outline-none sm:text-4xl"
            placeholder="文章标题"
          />

          <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--stone-gray)] mb-6">
            <CategorySelector
              value={selectedCategory}
              onChange={(val) => {
                setSelectedCategory(val)
                if (editorRef.current) checkDirty(editorRef.current, { category: val })
              }}
            />
            {publishedAt && (
              <>
                <span aria-hidden>·</span>
                <time>
                  {new Date(publishedAt * 1000).toLocaleDateString('zh-CN', {
                    year: 'numeric',
                    month: 'short',
                    day: 'numeric',
                  })}
                </time>
              </>
            )}
            {viewCount !== undefined && (
              <>
                <span aria-hidden>·</span>
                <span>{viewCount} 次阅读</span>
              </>
            )}
            {estimatedCharCount > 0 && (
              <>
                <span aria-hidden>·</span>
                <span>约 {Math.max(1, Math.ceil(estimatedCharCount / 400))} 分钟</span>
              </>
            )}
            {estimatedCharCount > 0 && (
              <>
                <span aria-hidden>·</span>
                <span className="tabular-nums">{estimatedCharCount.toLocaleString()} 字</span>
              </>
            )}
            <span className="inline-flex items-center gap-1">
              <button
                type="button"
                onClick={handleDownloadMarkdown}
                className="inline-flex h-6 w-6 items-center justify-center rounded text-[var(--stone-gray)] transition hover:bg-[var(--editor-accent)]/8 hover:text-[var(--editor-accent)]"
                title="下载 Markdown"
                aria-label="下载 Markdown"
              >
                <Download className="h-3.5 w-3.5" />
              </button>
              <CopyFormatDropdown
                getTitle={() => getCurrentExport().title}
                getHtml={() => getCurrentExport().html}
                hasContent={() => getCurrentExport().hasContent}
                buttonClassName="inline-flex h-6 w-6 items-center justify-center rounded text-[var(--stone-gray)] transition hover:bg-[var(--editor-accent)]/8 hover:text-[var(--editor-accent)]"
                iconClassName="h-3.5 w-3.5"
              />
              <PublishChannelMenu
                onWechat={handleOpenWechatPublish}
                getArticle={() => ({ ...getCurrentExport(), cover: coverImage, summary: '' })}
                buttonClassName="inline-flex h-6 w-6 items-center justify-center rounded text-[var(--stone-gray)] transition hover:bg-[var(--editor-accent)]/8 hover:text-[var(--editor-accent)]"
                iconClassName="h-3.5 w-3.5"
              />
              <button
                type="button"
                onClick={handleDownloadPdf}
                className="inline-flex h-6 w-6 items-center justify-center rounded text-[var(--stone-gray)] transition hover:bg-[var(--editor-accent)]/8 hover:text-[var(--editor-accent)]"
                title="下载 PDF"
                aria-label="下载 PDF"
              >
                <FileDown className="h-3.5 w-3.5" />
              </button>
              <span className="relative inline-flex" ref={copywritingMenuRef}>
                <button
                  type="button"
                  onClick={() => setCopywritingMenuOpen((open) => !open)}
                  className="inline-flex h-6 w-6 items-center justify-center rounded text-[var(--stone-gray)] transition hover:bg-[var(--editor-accent)]/8 hover:text-[var(--editor-accent)]"
                  title="中文排版整理"
                  aria-label="中文排版整理"
                  aria-expanded={copywritingMenuOpen}
                  aria-haspopup="menu"
                >
                  <Pilcrow className="h-3.5 w-3.5" />
                </button>
                {copywritingMenuOpen && (
                  <span className="absolute right-0 top-7 z-50 block min-w-32 rounded-lg border border-[var(--editor-line)] bg-[var(--editor-panel)] p-1 shadow-[0_14px_30px_rgba(37,32,24,0.14)]">
                    <button
                      type="button"
                      onClick={() => handleFormatCopywriting('block')}
                      className="flex w-full items-center rounded-md px-3 py-2 text-left text-sm text-[var(--editor-ink)] transition hover:bg-[var(--editor-soft)]"
                    >
                      当前段落
                    </button>
                    <button
                      type="button"
                      onClick={() => handleFormatCopywriting('document')}
                      className="flex w-full items-center rounded-md px-3 py-2 text-left text-sm text-[var(--editor-ink)] transition hover:bg-[var(--editor-soft)]"
                    >
                      全文
                    </button>
                  </span>
                )}
              </span>
              <button
                type="button"
                onClick={(e) => openDocumentAIModal(e.currentTarget)}
                className="inline-flex h-6 w-6 items-center justify-center rounded text-[var(--stone-gray)] transition hover:bg-[var(--editor-accent)]/8 hover:text-[var(--editor-accent)]"
                title="Ask AI（基于标题和正文）"
                aria-label="Ask AI（基于标题和正文）"
              >
                <WandSparkles className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => openDocumentImageModal('generate')}
                className="inline-flex h-6 w-6 items-center justify-center rounded text-[var(--stone-gray)] transition hover:bg-[var(--editor-accent)]/8 hover:text-[var(--editor-accent)]"
                title="图片工具"
                aria-label="图片工具"
              >
                <ImageIcon className="h-3.5 w-3.5" />
              </button>
            </span>
            {password && (
              <>
                <span aria-hidden>·</span>
                <div className="flex items-center gap-1.5">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
                    <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
                  </svg>
                  <span>已加密</span>
                </div>
              </>
            )}
          </div>

          <EditorRoot>
            <EditorContent
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              extensions={imageExtensions as any}
              className="editor-surface inline-editor"
              immediatelyRender={false}
              editorProps={editorProps}
              onCreate={({ editor }) => {
                editorRef.current = editor
                editor.commands.setContent(normalizedInitialHtml)
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const st = editor.storage as any
                setCharCount(st.characterCount?.characters?.() ?? 0)
                refreshToc(editor)
              }}
              onUpdate={({ editor }) => {
                editorRef.current = editor
                if (editor.view.composing) return

                syncEditorState(editor)
              }}
            >
              <FormattingBubble />
              <SlashMenu />
            </EditorContent>
          </EditorRoot>
        </div>
      </div>

      <InputModal
        open={inputModal.open}
        title={inputModal.title}
        placeholder={inputModal.placeholder}
        onConfirm={handleInputModalConfirm}
        onCancel={handleInputModalCancel}
      />

      {wechatPublishOpen && (
        <WeChatPublishModal
          isOpen={wechatPublishOpen}
          onClose={() => setWechatPublishOpen(false)}
          title={currentExport.title}
          html={currentExport.html}
          defaultDigest={buildAutoDescription(currentExport.text || content || '')}
          defaultSourceUrl={`https://${siteDisplayUrl}/${slug}`}
          defaultCoverImageUrl={resolvePostCoverImage({
            cover_image: coverImage,
            slug,
            title: currentExport.title,
          })}
        />
      )}

      {imageModal.open && (
        <ImageToolModal
          key={`${imageModal.open ? 'open' : 'closed'}-${imageModal.mode}`}
          open={imageModal.open}
          mode={imageModal.mode}
          contextText={imageModal.contextText}
          historyScope="inline-article"
          insertPos={imageModal.insertPos}
          postId={postId}
          slug={slug}
          onClose={closeImageModal}
          onInsertImage={insertGeneratedImage}
          onInsertCollage={insertCollageImage}
        />
      )}

      {Boolean(referenceImageTarget) && (
        <ImageGenerationModal
          open={Boolean(referenceImageTarget)}
          contextText=""
          historyScope="inline-article"
          referenceImageUrl={referenceImageTarget?.src}
          allowReplace
          defaultPlacementMode="replace"
          closeOnGenerate={false}
          generationMode="foreground"
          postId={postId}
          slug={slug}
          onClose={() => setReferenceImageTarget(null)}
          onInsert={(imageUrl, alt, placementMode) => {
            if (!referenceImageTarget) return
            applyImageActionResult(referenceImageTarget, imageUrl, alt, placementMode ?? 'replace')
            setReferenceImageTarget(null)
          }}
        />
      )}

      {Boolean(cropImageTarget) && (
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
      )}

      {aiModal.open && editorRef.current && (
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
          historyScope="inline-article"
          onApplyTitle={(nextTitle) => {
            setTitle(nextTitle)
            if (titleRef.current) {
              titleRef.current.value = nextTitle
              autoResizeTitle(titleRef.current)
            }
            if (editorRef.current) checkDirty(editorRef.current, { title: nextTitle })
          }}
        />
      )}
    </>
  )
}
