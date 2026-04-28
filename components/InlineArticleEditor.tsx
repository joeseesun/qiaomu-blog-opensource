'use client'

import Link from 'next/link'
import { useRef, useState, useCallback, useEffect, useMemo } from 'react'
import { ImageIcon, WandSparkles } from 'lucide-react'
import {
  EditorContent,
  EditorInstance,
  EditorRoot,
} from 'novel'
import {
  createEditorExtensions,
  buildEditorProps,
  FormattingBubble,
  SlashMenu,
} from '@/lib/editor-extensions'
import { InputModal } from '@/components/InputModal'
import { CategorySelector } from '@/components/CategorySelector'
import { DownloadMarkdown } from '@/components/DownloadMarkdown'
import { ImageGenerationModal } from '@/components/ImageGenerationModal'
import { ImageCropModal } from '@/components/ImageCropModal'
import { AIModal } from '@/lib/ai-modal'
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
import { resizeTextareaHeight, useAutoResizeTextarea } from '@/lib/textarea-autosize'

interface InlineArticleEditorProps {
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

export function InlineArticleEditor({
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
  const editorRef = useRef<EditorInstance | null>(null)
  const titleRef = useRef<HTMLTextAreaElement | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const fileUploadRef = useRef<HTMLInputElement>(null)
  const originalHtmlRef = useRef(html)
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
      const result = await uploadEditorFile(optimizedFile)
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

  const autoResizeTitle = (el: HTMLTextAreaElement) => {
    resizeTextareaHeight(el)
  }

  useAutoResizeTextarea(titleRef)

  useEffect(() => {
    resizeTextareaHeight(titleRef.current)
  }, [title])

  const editorProps = buildEditorProps(
    (file) => uploadImageAndGetUrl(file),
    (file) => void insertNonImageFile(file),
    'inline-main-prose',
  )

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

      {/* 右上角固顶状态栏：字数 + 保存 */}
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
              href="/admin"
              className="px-2 py-1 rounded-md border border-[var(--editor-line)] text-[var(--editor-ink)] hover:bg-[var(--editor-soft)] transition"
            >
              后台
            </Link>
          </>
        ) : null}
        {charCount > 0 && (
          <span className="tabular-nums text-[var(--stone-gray)]">
            {charCount.toLocaleString()} 字
          </span>
        )}
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={(e) => openDocumentAIModal(e.currentTarget)}
            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-[var(--editor-muted)] transition hover:bg-[var(--editor-soft)] hover:text-[var(--editor-accent)]"
            title="Ask AI（基于标题和正文）"
            aria-label="Ask AI（基于标题和正文）"
          >
            <WandSparkles className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={openDocumentImageModal}
            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-[var(--editor-muted)] transition hover:bg-[var(--editor-soft)] hover:text-[var(--editor-accent)]"
            title="生成图片"
            aria-label="生成图片"
          >
            <ImageIcon className="h-3.5 w-3.5" />
          </button>
        </div>
        {feedback ? (
          <span className={`font-medium ${feedback.type === 'success' ? 'text-emerald-600' : 'text-rose-600'}`}>
            {feedback.message}
          </span>
        ) : dirty ? (
          <>
            {charCount > 0 && <span className="text-[var(--editor-line)]" aria-hidden>|</span>}
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
        className="editor-title-textarea mb-2 block w-full resize-none overflow-hidden border-0 bg-transparent p-0 text-2xl font-bold leading-tight text-[var(--editor-ink)] outline-none shadow-none focus:outline-none focus-visible:outline-none sm:text-4xl"
        style={{ fontFamily: 'Georgia, "Noto Serif SC", serif' }}
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
        {content && (
          <>
            <span aria-hidden>·</span>
            <span>约 {Math.max(1, Math.ceil(content.length / 400))} 分钟</span>
          </>
        )}
        <DownloadMarkdown title={title} html={html} />
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
            editor.commands.setContent(html)
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const st = editor.storage as any
            setCharCount(st.characterCount?.characters?.() ?? 0)
          }}
          onUpdate={({ editor }) => {
            editorRef.current = editor
            checkDirty(editor)
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const st = editor.storage as any
            setCharCount(st.characterCount?.characters?.() ?? 0)
          }}
        >
          <FormattingBubble />
          <SlashMenu />
        </EditorContent>
      </EditorRoot>

      <InputModal
        open={inputModal.open}
        title={inputModal.title}
        placeholder={inputModal.placeholder}
        onConfirm={handleInputModalConfirm}
        onCancel={handleInputModalCancel}
      />

      <ImageGenerationModal
        open={imageModal.open}
        contextText={imageModal.contextText}
        historyScope="inline-article"
        onClose={closeImageModal}
        onInsert={insertGeneratedImage}
      />

      <ImageGenerationModal
        open={Boolean(referenceImageTarget)}
        contextText=""
        historyScope="inline-article"
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
