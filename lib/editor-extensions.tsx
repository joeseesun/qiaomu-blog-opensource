'use client'

import {
  CharacterCount,
  Color,
  Command as SlashCommand,
  HighlightExtension,
  createSuggestionItems,
  EditorBubble,
  EditorCommand,
  EditorCommandEmpty,
  EditorCommandItem,
  EditorCommandList,
  EditorInstance,
  StarterKit,
  TaskItem,
  TaskList,
  TextStyle,
  TiptapLink,
  TiptapUnderline,
  createImageUpload,
  handleImagePaste,
  handleImageDrop,
  handleCommandNavigation,
  renderItems,
  type SuggestionItem,
  useEditor,
} from 'novel'
import { Table, TableRow, TableCell, TableHeader } from '@tiptap/extension-table'
import Youtube from '@tiptap/extension-youtube'
import GlobalDragHandle from 'tiptap-extension-global-drag-handle'
import AutoJoiner from 'tiptap-extension-auto-joiner'
import { Markdown } from 'tiptap-markdown'
import { DOMParser as PMDOMParser } from '@tiptap/pm/model'
import type { EditorView } from '@tiptap/pm/view'
import markdownit from 'markdown-it'
import { useEffect, useState } from 'react'
import {
  AlignLeft,
  ArrowDownToLine,
  ArrowLeftToLine,
  ArrowRightToLine,
  ArrowUpToLine,
  Check,
  CheckSquare,
  ChevronDown,
  Code2,
  Eraser,
  ExternalLink,
  Heading,
  Heading1,
  Heading2,
  Heading3,
  Highlighter,
  ImagePlus,
  List,
  ListOrdered,
  MoreHorizontal,
  Paintbrush2,
  Quote,
  RemoveFormatting,
  Sigma,
  Trash2,
  WandSparkles,
} from 'lucide-react'
import { TwitterNode } from './twitter-extension'
import { ResizableImage, type ResizableImageActionHandlers } from './resizable-image'
import { MathNode } from './math-extension'
import { AudioNode } from './audio-extension'
import { VideoNode } from './video-extension'
import {
  type InputModalDetail,
  type TriggerAIModalDetail,
  type TriggerImageGenerationDetail,
  TRIGGER_AI_MODAL_EVENT,
  TRIGGER_FILE_UPLOAD_EVENT,
  TRIGGER_IMAGE_GENERATION_EVENT,
  TRIGGER_IMAGE_UPLOAD_EVENT,
  TRIGGER_INPUT_MODAL_EVENT,
} from './editor-events'
import { shouldShowEditorBubble } from './editor-bubble'
import { createDefaultTableContent, hasMarkdownTable, normalizeUrl } from './editor-utils'

const md = markdownit({ html: true })

function CommandIcon({ label }: { label: string }) {
  return (
    <span className="inline-flex h-9 min-w-9 items-center justify-center rounded-md border border-[var(--editor-line)] bg-[var(--editor-panel)] px-2 text-[11px] font-semibold tracking-wide text-[var(--editor-ink)]">
      {label}
    </span>
  )
}

function BubbleIconButton({
  active = false,
  children,
  label,
  onClick,
}: {
  active?: boolean
  children: React.ReactNode
  label: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={`inline-flex h-8 min-w-8 items-center justify-center rounded-md px-2 text-sm font-medium transition ${
        active
          ? 'bg-[var(--editor-accent)] text-[var(--editor-accent-ink)]'
          : 'text-[var(--editor-ink)] hover:bg-[var(--editor-soft)]'
      }`}
    >
      {children}
    </button>
  )
}

function BubbleActionButton({
  children,
  onClick,
  tone = 'default',
}: {
  children: React.ReactNode
  onClick: () => void
  tone?: 'default' | 'primary'
}) {
  return (
    <button
      type="button"
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={`inline-flex items-center justify-center rounded-md px-3 py-1.5 text-sm transition ${
        tone === 'primary'
          ? 'bg-[var(--editor-accent)] text-[var(--editor-accent-ink)] hover:brightness-105'
          : 'border border-[var(--editor-line)] text-[var(--editor-ink)] hover:bg-[var(--editor-soft)]'
      }`}
    >
      {children}
    </button>
  )
}

function BubblePanelButton({
  active = false,
  icon,
  label,
  onClick,
}: {
  active?: boolean
  icon: React.ReactNode
  label: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition ${
        active
          ? 'bg-[var(--editor-accent)]/10 text-[var(--editor-accent)]'
          : 'text-[var(--editor-ink)] hover:bg-[var(--editor-soft)]'
      }`}
    >
      <span className="flex h-4 w-4 items-center justify-center">{icon}</span>
      <span>{label}</span>
      {active ? <Check className="ml-auto h-3.5 w-3.5 text-[var(--editor-accent)]" /> : null}
    </button>
  )
}

type BubbleMode = 'main' | 'text' | 'link' | 'color' | 'more'
type BubbleColorTarget = 'text' | 'highlight'

const TEXT_OPTIONS: Array<{
  id: string
  label: string
  icon: React.ReactNode
  isActive: (editor: EditorInstance) => boolean
  apply: (editor: EditorInstance) => void
}> = [
  {
    id: 'paragraph',
    label: '正文',
    icon: <AlignLeft className="h-4 w-4" />,
    isActive: (editor) => editor.isActive('paragraph'),
    apply: (editor) => editor.chain().focus().setParagraph().run(),
  },
  {
    id: 'h1',
    label: '标题 1',
    icon: <Heading1 className="h-4 w-4" />,
    isActive: (editor) => editor.isActive('heading', { level: 1 }),
    apply: (editor) => editor.chain().focus().setHeading({ level: 1 }).run(),
  },
  {
    id: 'h2',
    label: '标题 2',
    icon: <Heading2 className="h-4 w-4" />,
    isActive: (editor) => editor.isActive('heading', { level: 2 }),
    apply: (editor) => editor.chain().focus().setHeading({ level: 2 }).run(),
  },
  {
    id: 'h3',
    label: '标题 3',
    icon: <Heading3 className="h-4 w-4" />,
    isActive: (editor) => editor.isActive('heading', { level: 3 }),
    apply: (editor) => editor.chain().focus().setHeading({ level: 3 }).run(),
  },
  {
    id: 'bullet',
    label: '项目列表',
    icon: <List className="h-4 w-4" />,
    isActive: (editor) => editor.isActive('bulletList'),
    apply: (editor) => editor.chain().focus().toggleBulletList().run(),
  },
  {
    id: 'ordered',
    label: '编号列表',
    icon: <ListOrdered className="h-4 w-4" />,
    isActive: (editor) => editor.isActive('orderedList'),
    apply: (editor) => editor.chain().focus().toggleOrderedList().run(),
  },
  {
    id: 'task',
    label: '待办列表',
    icon: <CheckSquare className="h-4 w-4" />,
    isActive: (editor) => editor.isActive('taskList'),
    apply: (editor) => editor.chain().focus().toggleTaskList().run(),
  },
  {
    id: 'quote',
    label: '引用',
    icon: <Quote className="h-4 w-4" />,
    isActive: (editor) => editor.isActive('blockquote'),
    apply: (editor) => editor.chain().focus().setParagraph().toggleBlockquote().run(),
  },
  {
    id: 'codeBlock',
    label: '代码块',
    icon: <Code2 className="h-4 w-4" />,
    isActive: (editor) => editor.isActive('codeBlock'),
    apply: (editor) => editor.chain().focus().toggleCodeBlock().run(),
  },
]

const TEXT_COLORS = [
  { label: '默认', value: '' },
  { label: '紫色', value: '#9333ea' },
  { label: '红色', value: '#e11d48' },
  { label: '黄色', value: '#ca8a04' },
  { label: '蓝色', value: '#2563eb' },
  { label: '绿色', value: '#16a34a' },
  { label: '橙色', value: '#ea580c' },
  { label: '灰色', value: '#6b7280' },
]

const BG_COLORS = [
  { label: '默认', value: '' },
  { label: '紫色', value: '#f3e8ff' },
  { label: '红色', value: '#ffe4e6' },
  { label: '黄色', value: '#fef9c3' },
  { label: '蓝色', value: '#dbeafe' },
  { label: '绿色', value: '#dcfce7' },
  { label: '橙色', value: '#ffedd5' },
  { label: '灰色', value: '#f3f4f6' },
]

export {
  TRIGGER_AI_MODAL_EVENT,
  TRIGGER_FILE_UPLOAD_EVENT,
  TRIGGER_IMAGE_GENERATION_EVENT,
  TRIGGER_IMAGE_UPLOAD_EVENT,
  TRIGGER_INPUT_MODAL_EVENT,
} from './editor-events'
export type {
  InputModalDetail,
  TriggerAIModalDetail,
  TriggerImageGenerationDetail,
} from './editor-events'

export const suggestionItems = createSuggestionItems([
  { title: '正文', description: '切回普通段落继续写作。', searchTerms: ['text', 'paragraph', 'p'], icon: <CommandIcon label="T" />, command: ({ editor, range }) => { editor.chain().focus().deleteRange(range).setParagraph().run() } },
  { title: '二级标题', description: '插入中等层级的小节标题。', searchTerms: ['heading', 'h2', 'subtitle'], icon: <CommandIcon label="H2" />, command: ({ editor, range }) => { editor.chain().focus().deleteRange(range).setHeading({ level: 2 }).run() } },
  { title: '三级标题', description: '插入更细一级的小标题。', searchTerms: ['heading', 'h3', 'small'], icon: <CommandIcon label="H3" />, command: ({ editor, range }) => { editor.chain().focus().deleteRange(range).setHeading({ level: 3 }).run() } },
  { title: '项目列表', description: '创建无序列表。', searchTerms: ['bullet', 'list', 'unordered'], icon: <CommandIcon label="•" />, command: ({ editor, range }) => { editor.chain().focus().deleteRange(range).toggleBulletList().run() } },
  { title: '编号列表', description: '创建带顺序的编号列表。', searchTerms: ['ordered', 'list', 'number'], icon: <CommandIcon label="1." />, command: ({ editor, range }) => { editor.chain().focus().deleteRange(range).toggleOrderedList().run() } },
  { title: '待办列表', description: '插入可以勾选的任务清单。', searchTerms: ['todo', 'task', 'checkbox'], icon: <CommandIcon label="[]" />, command: ({ editor, range }) => { editor.chain().focus().deleteRange(range).toggleTaskList().run() } },
  { title: '引用', description: '高亮一段需要单独强调的话。', searchTerms: ['quote', 'blockquote'], icon: <CommandIcon label='"' />, command: ({ editor, range }) => { editor.chain().focus().deleteRange(range).setParagraph().toggleBlockquote().run() } },
  { title: '代码块', description: '插入一段多行代码。', searchTerms: ['code', 'snippet', 'codeblock'], icon: <CommandIcon label="</>" />, command: ({ editor, range }) => { editor.chain().focus().deleteRange(range).toggleCodeBlock().run() } },
  { title: '表格', description: '插入一个 3×3 的表格。', searchTerms: ['table', 'grid'], icon: <CommandIcon label="▦" />, command: ({ editor, range }) => { editor.chain().focus().deleteRange(range).insertContent(createDefaultTableContent()).run() } },
  { title: '分隔线', description: '用一条线把内容切成两个段落。', searchTerms: ['divider', 'hr', 'line'], icon: <CommandIcon label="—" />, command: ({ editor, range }) => { editor.chain().focus().deleteRange(range).setHorizontalRule().run() } },
  {
    title: '生成图片',
    description: '调用 AI 生图并插入当前位置。',
    searchTerms: ['generate', 'image', 'ai', 'illustration', '生图', '生成图片', '插图', 'mondo'],
    icon: <CommandIcon label="AI" />,
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).run()

      window.dispatchEvent(new CustomEvent<TriggerImageGenerationDetail>(TRIGGER_IMAGE_GENERATION_EVENT, {
        detail: {
          insertPos: range.from,
          selectedText: '',
        },
      }))
    },
  },
  {
    title: '图片',
    description: '从本地上传图片。',
    searchTerms: ['image', 'photo', 'picture', 'upload', '图片'],
    icon: <CommandIcon label="🖼" />,
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).run()
      window.dispatchEvent(new CustomEvent(TRIGGER_IMAGE_UPLOAD_EVENT))
    },
  },
  {
    title: 'YouTube',
    description: '嵌入 YouTube 视频。',
    searchTerms: ['youtube', 'video', '视频'],
    icon: <CommandIcon label="▶" />,
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).run()
      window.dispatchEvent(new CustomEvent<InputModalDetail>(TRIGGER_INPUT_MODAL_EVENT, {
        detail: {
          title: '嵌入 YouTube 视频',
          placeholder: '请粘贴 YouTube 视频链接',
          callback: (url) => editor.commands.setYoutubeVideo({ src: url }),
        },
      }))
    },
  },
  {
    title: 'Twitter',
    description: '嵌入 Twitter/X 推文。',
    searchTerms: ['twitter', 'tweet', 'x', '推文'],
    icon: <CommandIcon label="𝕏" />,
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).run()
      window.dispatchEvent(new CustomEvent<InputModalDetail>(TRIGGER_INPUT_MODAL_EVENT, {
        detail: {
          title: '嵌入 Twitter/X 推文',
          placeholder: '请粘贴推文链接',
          callback: (url) => editor.commands.insertContent({ type: 'twitter', attrs: { src: url } }),
        },
      }))
    },
  },
  {
    title: '上传文件',
    description: '上传视频、音频、PDF、电子书等文件。',
    searchTerms: ['file', 'upload', 'video', 'audio', 'pdf', 'epub', '文件', '视频', '音频', '上传'],
    icon: <CommandIcon label="📎" />,
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).run()
      window.dispatchEvent(new CustomEvent(TRIGGER_FILE_UPLOAD_EVENT))
    },
  },
  {
    title: '数学公式',
    description: '插入 LaTeX 数学公式。',
    searchTerms: ['math', 'formula', 'latex', 'katex', '公式', '数学'],
    icon: <CommandIcon label="∑" />,
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).run()
      editor.commands.insertContent({
        type: 'mathBlock',
        attrs: { latex: '', displayMode: true },
      })
    },
  },
] satisfies SuggestionItem[])

const slashCommand = SlashCommand.configure({
  suggestion: { items: () => suggestionItems, render: renderItems },
})

export interface EditorExtensionOptions {
  imageActions?: ResizableImageActionHandlers
}

export function createEditorExtensions(options: EditorExtensionOptions = {}) {
  return [
    StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
    TextStyle,
    Color,
    HighlightExtension,
    CharacterCount,
    ResizableImage.configure({ imageActions: options.imageActions ?? {} } as never),
    TiptapUnderline,
    TiptapLink.configure({ openOnClick: false, autolink: true, linkOnPaste: true }),
    TaskList,
    TaskItem.configure({ nested: true }),
    Table.configure({ resizable: true, HTMLAttributes: { class: 'tiptap-table' } }),
    TableRow,
    TableCell,
    TableHeader,
    Youtube.configure({
      inline: false,
      ccLanguage: 'zh',
      interfaceLanguage: 'zh',
    }),
    TwitterNode,
    MathNode,
    AudioNode,
    VideoNode,
    Markdown.configure({ html: true, transformPastedText: true, transformCopiedText: true }),
    GlobalDragHandle.configure({
      dragHandleWidth: 24,
      scrollTreshold: 100,
    }),
    AutoJoiner.configure({
      elementsToJoin: ['bulletList', 'orderedList'],
    }),
    slashCommand,
  ]
}

export const editorExtensions = createEditorExtensions()

export function buildEditorProps(
  onImageUpload?: (file: File) => Promise<string>,
  onNonImageFile?: (file: File) => void,
  contentClassName = '',
) {
  const collectFiles = (listLike: FileList | File[] | null | undefined) => {
    if (!listLike) return [] as File[]

    const files = Array.from(listLike)
    const seen = new Set<string>()

    return files.filter((file) => {
      const key = `${file.name}:${file.size}:${file.type}:${file.lastModified}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
  }

  const getClipboardFiles = (event: ClipboardEvent) => {
    const files: File[] = []
    const items = event.clipboardData?.items

    if (items) {
      for (const item of Array.from(items)) {
        if (item.kind !== 'file') continue
        const file = item.getAsFile()
        if (file) files.push(file)
      }
    }

    return collectFiles(files.length > 0 ? files : event.clipboardData?.files)
  }

  const getDroppedFiles = (event: DragEvent) => collectFiles(event.dataTransfer?.files)

  // 不传 validateFn — Novel 有 bug，validateFn 返回 void 会导致上传被跳过
  const uploadFn = onImageUpload
    ? createImageUpload({
        onUpload: async (file) => {
          const url = await onImageUpload(file)
          return url
        },
      })
    : undefined

  return {
    handlePaste: (view: EditorView, event: ClipboardEvent) => {
      const files = getClipboardFiles(event)
      if (files.length > 0) {
        if (onNonImageFile) {
          event.preventDefault()
          event.stopPropagation()
          files.forEach((currentFile) => onNonImageFile(currentFile))
          return true
        }

        const [file] = files

        // Image files: validate then use Novel's upload with visual placeholder
        if (files.length === 1 && file.type.startsWith('image/') && file.size <= 100 * 1024 * 1024 && uploadFn) {
          if (handleImagePaste(view, event, uploadFn)) return true
        }

        // Fallback: block native browser behavior when file upload isn't handled
        event.preventDefault()
        event.stopPropagation()
        return true
      }

      const plainText = event.clipboardData?.getData('text/plain') ?? ''
      if (hasMarkdownTable(plainText)) {
        event.preventDefault()
        const html = md.render(plainText)
        const { state, dispatch } = view
        const wrapper = document.createElement('div')
        wrapper.innerHTML = html
        const slice = PMDOMParser.fromSchema(state.schema).parseSlice(wrapper)
        const tr = state.tr.replaceSelection(slice)
        dispatch(tr)
        return true
      }

      const htmlContent = event.clipboardData?.getData('text/html') ?? ''
      if (htmlContent && (
        htmlContent.includes('<style') ||
        htmlContent.includes('class=') ||
        htmlContent.includes('mso-') ||
        htmlContent.includes('data-') ||
        /style\s*=\s*["'][^"']*["']/.test(htmlContent)
      )) {
        event.preventDefault()
        const wrapper = document.createElement('div')
        wrapper.innerHTML = htmlContent
        const allElements = wrapper.querySelectorAll('*')
        allElements.forEach((el) => {
          el.removeAttribute('style')
          el.removeAttribute('class')
          el.removeAttribute('id')
          Array.from(el.attributes).forEach((attr) => {
            if (attr.name.startsWith('data-')) {
              el.removeAttribute(attr.name)
            }
          })
        })

        wrapper.querySelectorAll('style').forEach((el) => el.remove())

        const { state, dispatch } = view
        const slice = PMDOMParser.fromSchema(state.schema).parseSlice(wrapper)
        const tr = state.tr.replaceSelection(slice)
        dispatch(tr)
        return true
      }

      return false
    },
    handleDrop: (view: EditorView, event: DragEvent, _slice: unknown, moved: boolean) => {
      const files = getDroppedFiles(event)
      if (files.length === 0) return false

      if (onNonImageFile) {
        event.preventDefault()
        event.stopPropagation()
        files.forEach((currentFile) => onNonImageFile(currentFile))
        return true
      }

      const [file] = files

      // Image files: validate then use Novel's upload with visual placeholder
      if (files.length === 1 && file.type.startsWith('image/') && file.size <= 100 * 1024 * 1024 && uploadFn) {
        if (handleImageDrop(view, event, moved, uploadFn)) return true
      }

      // Fallback: block native browser behavior when file upload isn't handled
      event.preventDefault()
      event.stopPropagation()
      return true
    },
    handleDOMEvents: {
      keydown: (_view: unknown, event: KeyboardEvent) => handleCommandNavigation(event),
      click: (_view: unknown, event: MouseEvent) => {
        if (event.metaKey || event.ctrlKey) {
          const target = event.target as HTMLElement
          const anchor = target.closest('a[href]')
          if (anchor) {
            event.preventDefault()
            window.open((anchor as HTMLAnchorElement).href, '_blank', 'noopener')
          }
        }
      },
    },
    attributes: { class: ['novel-prose', contentClassName].filter(Boolean).join(' ') },
  }
}

export function FormattingBubble() {
  const { editor } = useEditor()
  const [mode, setMode] = useState<BubbleMode>('main')
  const [colorTarget, setColorTarget] = useState<BubbleColorTarget>('text')
  const [linkValue, setLinkValue] = useState('')

  useEffect(() => {
    if (!editor) return

    const onSelectionUpdate = () => {
      const href = (editor.getAttributes('link').href as string | undefined) ?? ''
      setLinkValue(href)
      setMode('main')
      setColorTarget('text')
    }

    editor.on('selectionUpdate', onSelectionUpdate)
    return () => {
      editor.off('selectionUpdate', onSelectionUpdate)
    }
  }, [editor])

  if (!editor) return null

  const openAIModal = () => {
    const { from, to } = editor.state.selection
    const selectedText = editor.state.doc.textBetween(from, to, '\n').trim()

    if (!selectedText) return

    // 获取选中文本的位置
    const { view } = editor
    const start = view.coordsAtPos(from)
    const end = view.coordsAtPos(to)

    // 计算 modal 位置（选中文本下方居中）
    const position = {
      top: end.bottom + 8,
      left: (start.left + end.right) / 2,
    }

    // 触发事件打开 AI Modal
    window.dispatchEvent(
      new CustomEvent<TriggerAIModalDetail>(TRIGGER_AI_MODAL_EVENT, {
        detail: {
          selectedText,
          position,
          selectionRange: { from, to },
        },
      })
    )

    // 关闭 Bubble Menu - 清除选区会自动隐藏
    setTimeout(() => {
      editor.commands.setTextSelection(to)
    }, 50)
  }

  const openImageGenerationModal = () => {
    const { from, to } = editor.state.selection
    const selectedText = editor.state.doc.textBetween(from, to, '\n').trim()

    if (!selectedText) return

    window.dispatchEvent(
      new CustomEvent<TriggerImageGenerationDetail>(TRIGGER_IMAGE_GENERATION_EVENT, {
        detail: {
          insertPos: to,
          selectedText,
        },
      }),
    )

    setTimeout(() => {
      editor.commands.setTextSelection(to)
    }, 50)
  }

  const currentTextOption = TEXT_OPTIONS.find((o) => o.isActive(editor))
  const currentColor = (editor.getAttributes('textStyle').color as string | undefined) ?? ''
  const currentHighlight = (editor.getAttributes('highlight').color as string | undefined) ?? ''
  const colorOptions = colorTarget === 'text' ? TEXT_COLORS : BG_COLORS
  const activeColorValue = colorTarget === 'text' ? currentColor : currentHighlight

  const toggleMode = (next: BubbleMode) => setMode((prev) => (prev === next ? 'main' : next))

  return (
    <EditorBubble
      tippyOptions={{ placement: 'top', interactive: true, maxWidth: 'none' }}
      shouldShow={({ editor: currentEditor }) => {
        return shouldShowEditorBubble(currentEditor.state.selection, currentEditor.isEditable)
      }}
      className="overflow-hidden rounded-xl border border-[var(--editor-line)] bg-white shadow-[0_12px_30px_rgba(37,32,24,0.12)]"
    >
      {/* ── 工具栏（始终可见）── */}
      <div className="flex items-center gap-0.5 p-1">

        {/* Ask AI */}
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={openAIModal}
          className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm font-semibold transition bg-[var(--editor-accent)]/8 text-[var(--editor-accent)] hover:bg-[var(--editor-accent)]/15"
        >
          <WandSparkles className="h-3.5 w-3.5" />
          Ask AI
        </button>

        <BubbleIconButton label="生成图片" onClick={openImageGenerationModal}>
          <ImagePlus className="h-4 w-4" />
        </BubbleIconButton>

        <div className="mx-0.5 h-5 w-px bg-[var(--editor-line)]" />

        {/* Text type selector */}
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => toggleMode('text')}
          className={`inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm transition ${
            mode === 'text' ? 'bg-[var(--editor-soft)]' : 'hover:bg-[var(--editor-soft)]'
          }`}
        >
          <span className="text-[var(--editor-muted)]">
            {currentTextOption?.icon ?? <AlignLeft className="h-4 w-4" />}
          </span>
          <span className="font-medium text-[var(--editor-ink)]">
            {currentTextOption?.label ?? '正文'}
          </span>
          <ChevronDown className="h-3.5 w-3.5 text-[var(--editor-muted)]" />
        </button>

        {/* Link */}
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => toggleMode('link')}
          className={`inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm font-medium transition ${
            mode === 'link' || editor.isActive('link')
              ? 'bg-[var(--editor-soft)] text-[var(--editor-accent)]'
              : 'text-[var(--editor-ink)] hover:bg-[var(--editor-soft)]'
          }`}
        >
          <ExternalLink className="h-4 w-4" />
          Link
        </button>

        <div className="mx-0.5 h-5 w-px bg-[var(--editor-line)]" />

        {/* Format */}
        <BubbleIconButton active={editor.isActive('bold')} label="粗体 (Cmd+B)" onClick={() => editor.chain().focus().toggleBold().run()}>
          <strong>B</strong>
        </BubbleIconButton>
        <BubbleIconButton active={editor.isActive('underline')} label="下划线 (Cmd+U)" onClick={() => editor.chain().focus().toggleUnderline().run()}>
          <span className="underline">U</span>
        </BubbleIconButton>
        <BubbleIconButton active={editor.isActive('highlight')} label="高亮" onClick={() => editor.chain().focus().toggleHighlight().run()}>
          <Highlighter className="h-4 w-4" />
        </BubbleIconButton>

        {/* More */}
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => toggleMode('more')}
          className={`inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-sm transition ${
            mode === 'more' ? 'bg-[var(--editor-soft)]' : 'hover:bg-[var(--editor-soft)]'
          }`}
          title="更多"
        >
          <MoreHorizontal className="h-4 w-4 text-[var(--editor-muted)]" />
        </button>

        {/* Clear */}
        <BubbleIconButton label="清除格式" onClick={() => editor.chain().focus().clearNodes().unsetAllMarks().run()}>
          <RemoveFormatting className="h-4 w-4" />
        </BubbleIconButton>
      </div>

      {/* ── 下拉面板区域 ── */}
      {mode !== 'main' && (
        <div className="border-t border-[var(--editor-line)]">

          {/* Text type dropdown */}
          {mode === 'text' && (
            <div className="min-w-[200px] p-1">
              {TEXT_OPTIONS.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => { option.apply(editor); setMode('main') }}
                  className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm transition hover:bg-[var(--editor-soft)]"
                >
                  <span className="flex h-5 w-5 items-center justify-center text-[var(--editor-muted)]">
                    {option.icon}
                  </span>
                  <span className="flex-1 text-left text-[var(--editor-ink)]">{option.label}</span>
                  {option.isActive(editor) && (
                    <Check className="h-4 w-4 text-[var(--editor-accent)]" />
                  )}
                </button>
              ))}
            </div>
          )}

          {/* Link panel */}
          {mode === 'link' && (
            <div className="min-w-[280px] space-y-2 p-2">
              <input
                value={linkValue}
                onChange={(e) => setLinkValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && linkValue.trim()) {
                    editor.chain().focus().extendMarkRange('link').setLink({ href: normalizeUrl(linkValue.trim()) }).run()
                    setMode('main')
                  }
                }}
                placeholder="https://"
                autoFocus
                className="w-full rounded-md border border-[var(--editor-line)] px-3 py-2 text-sm text-[var(--editor-ink)] outline-none focus:border-[var(--editor-accent)]"
              />
              <div className="flex items-center justify-between gap-2">
                <BubbleActionButton
                  onClick={() => {
                    editor.chain().focus().extendMarkRange('link').unsetLink().run()
                    setLinkValue('')
                    setMode('main')
                  }}
                >
                  <span className="inline-flex items-center gap-1.5">
                    <Eraser className="h-4 w-4" />
                    移除
                  </span>
                </BubbleActionButton>
                <BubbleActionButton
                  tone="primary"
                  onClick={() => {
                    if (!linkValue.trim()) return
                    editor.chain().focus().extendMarkRange('link').setLink({ href: normalizeUrl(linkValue.trim()) }).run()
                    setMode('main')
                  }}
                >
                  <span className="inline-flex items-center gap-1.5">
                    <ExternalLink className="h-4 w-4" />
                    应用
                  </span>
                </BubbleActionButton>
              </div>
            </div>
          )}

          {/* Color panel */}
          {mode === 'color' && (
            <div className="min-w-[248px] p-2">
              <div className="flex items-center gap-2 rounded-lg bg-[var(--editor-soft)] p-1">
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => setColorTarget('text')}
                  className={`flex-1 rounded-md px-3 py-1.5 text-sm transition ${
                    colorTarget === 'text'
                      ? 'bg-white text-[var(--editor-ink)] shadow-sm'
                      : 'text-[var(--editor-muted)] hover:text-[var(--editor-ink)]'
                  }`}
                >
                  文字
                </button>
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => setColorTarget('highlight')}
                  className={`flex-1 rounded-md px-3 py-1.5 text-sm transition ${
                    colorTarget === 'highlight'
                      ? 'bg-white text-[var(--editor-ink)] shadow-sm'
                      : 'text-[var(--editor-muted)] hover:text-[var(--editor-ink)]'
                  }`}
                >
                  背景
                </button>
              </div>

              <div className="mt-3 grid grid-cols-4 gap-2">
                {colorOptions.map((colorOption) => {
                  const isActive = colorOption.value === ''
                    ? !activeColorValue
                    : activeColorValue?.toLowerCase() === colorOption.value.toLowerCase()

                  return (
                    <button
                      key={`${colorTarget}-${colorOption.label}`}
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => {
                        const chain = editor.chain().focus()

                        if (colorTarget === 'text') {
                          if (!colorOption.value) chain.unsetColor().run()
                          else chain.setColor(colorOption.value).run()
                        } else if (!colorOption.value) {
                          chain.unsetHighlight().run()
                        } else {
                          chain.setHighlight({ color: colorOption.value }).run()
                        }

                        setMode('main')
                      }}
                      className={`flex flex-col items-center gap-1 rounded-xl border px-1.5 py-2 transition ${
                        isActive
                          ? 'border-[var(--editor-accent)] bg-[var(--editor-accent)]/8'
                          : 'border-[var(--editor-line)] hover:bg-[var(--editor-soft)]'
                      }`}
                      title={colorOption.label}
                    >
                      <span
                        className="flex h-7 w-7 items-center justify-center rounded-lg border border-black/10 text-xs font-bold"
                        style={colorTarget === 'text'
                          ? {
                              color: colorOption.value || 'var(--editor-ink)',
                              background: colorOption.value ? `${colorOption.value}18` : 'white',
                            }
                          : {
                              background: colorOption.value || 'white',
                              color: 'var(--editor-ink)',
                            }}
                      >
                        A
                      </span>
                      <span className="text-[10px] text-[var(--editor-muted)]">
                        {colorOption.label.replace('色', '')}
                      </span>
                    </button>
                  )
                })}
              </div>

              <div className="mt-3 flex items-center justify-between gap-3">
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => setMode('more')}
                  className="text-xs font-medium text-[var(--editor-muted)] transition hover:text-[var(--editor-ink)]"
                >
                  返回更多
                </button>
                <div className="text-[11px] text-[var(--editor-muted)]">
                  {colorTarget === 'text' ? '选择文字颜色' : '选择背景颜色'}
                </div>
              </div>
            </div>
          )}

          {/* More panel */}
          {mode === 'more' && (
            <div className="min-w-[220px] p-2">
              <div className="grid grid-cols-2 gap-1">
                <BubblePanelButton
                  active={editor.isActive('italic')}
                  icon={<em className="font-serif">I</em>}
                  label="斜体"
                  onClick={() => {
                    editor.chain().focus().toggleItalic().run()
                    setMode('main')
                  }}
                />
                <BubblePanelButton
                  active={editor.isActive('code')}
                  icon={<span className="font-mono text-xs">{'<>'}</span>}
                  label="行内代码"
                  onClick={() => {
                    editor.chain().focus().toggleCode().run()
                    setMode('main')
                  }}
                />
                <BubblePanelButton
                  active={editor.isActive('strike')}
                  icon={<span className="line-through">S</span>}
                  label="删除线"
                  onClick={() => {
                    editor.chain().focus().toggleStrike().run()
                    setMode('main')
                  }}
                />
                <BubblePanelButton
                  active={Boolean(currentColor || currentHighlight)}
                  icon={<Paintbrush2 className="h-4 w-4" />}
                  label="文字与背景"
                  onClick={() => {
                    setColorTarget(currentHighlight ? 'highlight' : 'text')
                    setMode('color')
                  }}
                />
              </div>

              <div className="mt-2 border-t border-[var(--editor-line)] pt-2">
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  setMode('main')
                  window.dispatchEvent(new CustomEvent<InputModalDetail>(TRIGGER_INPUT_MODAL_EVENT, {
                    detail: {
                      title: '插入 LaTeX 数学公式',
                      placeholder: 'E = mc^2',
                      callback: (latex) => {
                        editor.commands.insertContent({
                          type: 'mathBlock',
                          attrs: { latex, displayMode: true },
                        })
                      },
                    },
                  }))
                }}
                className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-[var(--editor-ink)] transition hover:bg-[var(--editor-soft)]"
              >
                <Sigma className="h-4 w-4" />
                <span>数学公式</span>
              </button>
              </div>
            </div>
          )}
        </div>
      )}
    </EditorBubble>
  )
}

export function TableBubble() {
  const { editor } = useEditor()
  if (!editor) return null

  // novel's useEditor type does not surface @tiptap/extension-table command
  // augmentation on chain(); cast once locally so each call is concise.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tc = () => (editor.chain().focus() as any)

  return (
    <EditorBubble
      tippyOptions={{ placement: 'top', interactive: true, maxWidth: 'none' }}
      shouldShow={({ editor: currentEditor }) => {
        if (!currentEditor.isEditable) return false
        if (!currentEditor.state.selection.empty) return false
        return currentEditor.isActive('table')
      }}
      className="overflow-hidden rounded-xl border border-[var(--editor-line)] bg-white shadow-[0_12px_30px_rgba(37,32,24,0.12)]"
    >
      <div className="flex items-center gap-0.5 p-1">
        <BubbleIconButton label="在上方插入行" onClick={() => tc().addRowBefore().run()}>
          <ArrowUpToLine className="h-4 w-4" />
        </BubbleIconButton>
        <BubbleIconButton label="在下方插入行" onClick={() => tc().addRowAfter().run()}>
          <ArrowDownToLine className="h-4 w-4" />
        </BubbleIconButton>
        <BubbleIconButton label="在左侧插入列" onClick={() => tc().addColumnBefore().run()}>
          <ArrowLeftToLine className="h-4 w-4" />
        </BubbleIconButton>
        <BubbleIconButton label="在右侧插入列" onClick={() => tc().addColumnAfter().run()}>
          <ArrowRightToLine className="h-4 w-4" />
        </BubbleIconButton>
        <span className="mx-1 h-5 w-px bg-[var(--editor-line)]" />
        <BubbleIconButton label="删除当前行" onClick={() => tc().deleteRow().run()}>
          <span className="text-xs font-medium">删行</span>
        </BubbleIconButton>
        <BubbleIconButton label="删除当前列" onClick={() => tc().deleteColumn().run()}>
          <span className="text-xs font-medium">删列</span>
        </BubbleIconButton>
        <span className="mx-1 h-5 w-px bg-[var(--editor-line)]" />
        <BubbleIconButton label="切换表头行" onClick={() => tc().toggleHeaderRow().run()}>
          <Heading className="h-4 w-4" />
        </BubbleIconButton>
        <BubbleIconButton label="删除整个表格" onClick={() => tc().deleteTable().run()}>
          <Trash2 className="h-4 w-4" />
        </BubbleIconButton>
      </div>
    </EditorBubble>
  )
}

export type DraftSaveStatus = 'idle' | 'saving' | 'saved'

export function EditorFooter({ saveStatus }: { saveStatus: DraftSaveStatus }) {
  const { editor } = useEditor()
  if (!editor) return null

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const storage = editor.storage as any
  const chars: number = storage.characterCount?.characters?.() ?? 0

  return (
    <div className="pointer-events-none absolute right-4 top-3 flex items-center gap-2 z-10">
      <span className="rounded-full bg-[var(--editor-soft)] px-2.5 py-1 text-[11px] tabular-nums text-[var(--stone-gray)]">
        {chars.toLocaleString()} 字
      </span>
      <span className={`rounded-full px-2.5 py-1 text-[11px] transition-opacity duration-300 ${
        saveStatus === 'idle' ? 'opacity-0' : 'opacity-100'
      } ${
        saveStatus === 'saving'
          ? 'bg-[var(--editor-soft)] text-[var(--stone-gray)]'
          : 'bg-emerald-50 text-emerald-600'
      }`}>
        {saveStatus === 'saving' ? '正在保存…' : '已保存'}
      </span>
    </div>
  )
}

export function SlashMenu() {
  return (
    <EditorCommand className="z-50 h-auto max-h-[340px] w-80 overflow-y-auto rounded-md border border-[var(--editor-line)] bg-white p-1 shadow-[0_20px_40px_rgba(37,32,24,0.14)]">
      <EditorCommandEmpty className="px-3 py-2 text-sm text-[var(--editor-muted)]">没找到匹配项</EditorCommandEmpty>
      <EditorCommandList>
        {suggestionItems.map((item) => (
          <EditorCommandItem key={item.title} value={item.title} keywords={item.searchTerms} onCommand={(props) => item.command?.(props)} className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-left transition hover:bg-[var(--editor-soft)] aria-selected:bg-[var(--editor-soft)]">
            {item.icon}
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-[var(--editor-ink)]">{item.title}</p>
              <p className="truncate text-xs text-[var(--editor-muted)]">{item.description}</p>
            </div>
          </EditorCommandItem>
        ))}
      </EditorCommandList>
    </EditorCommand>
  )
}
