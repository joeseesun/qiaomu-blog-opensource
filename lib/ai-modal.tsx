'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Check, Copy, History, Loader2, Sparkles } from 'lucide-react'
import type { EditorInstance } from 'novel'
import {
  appendStoredHistoryItem,
  LOCAL_HISTORY_UPDATED_EVENT,
  readStoredHistory,
  startBackgroundTask,
} from '@/lib/client-background-task'
import { renderMarkdownToHtml, replaceEditorRangeWithMarkdown } from '@/lib/editor-markdown'
import { useToast } from '@/components/Toast'

interface AiActionItem {
  id: number
  action_key: string
  label: string
  description: string
}

interface AiHistoryItem {
  id: string
  output: string
  promptLabel: string
  contextMode: 'selection' | 'document'
  selectionPreview: string
  documentTitle: string
  createdAt: number
}

interface DocumentQuickAction {
  id: string
  label: string
  prompt: string
  description: string
}

const DEFAULT_AI_ACTIONS: AiActionItem[] = [
  { id: 1, action_key: 'improve', label: '润色', description: '让表达更顺更自然' },
  { id: 2, action_key: 'shorten', label: '缩写', description: '压缩成更短版本' },
  { id: 3, action_key: 'expand', label: '扩写', description: '补充为更完整表述' },
  { id: 4, action_key: 'summarize', label: '总结', description: '提炼为清晰摘要' },
  { id: 5, action_key: 'translate_zh', label: '译成中文', description: '翻成简体中文' },
  { id: 6, action_key: 'translate_en', label: '译成英文', description: '翻成自然英文' },
]

const DOCUMENT_QUICK_ACTIONS: DocumentQuickAction[] = [
  {
    id: 'doc_summary',
    label: '总结全文',
    description: '提炼核心观点',
    prompt: '请基于下面的标题和正文，总结核心观点，输出 3-5 条 Markdown 列表，直接返回结果，不要解释。',
  },
  {
    id: 'doc_title',
    label: '生成标题',
    description: '给出更好的标题候选',
    prompt: '请基于下面的标题和正文，生成 5 个更好的中文标题，使用 Markdown 编号列表返回，直接返回结果，不要解释。',
  },
  {
    id: 'doc_description',
    label: '生成摘要',
    description: '写一段导语或摘要',
    prompt: '请基于下面的标题和正文，生成 1 段适合作为文章摘要或导语的文字，控制在 120-180 字，直接返回结果，不要解释。',
  },
]

const MAX_HISTORY_ITEMS = 8
const DEFAULT_HISTORY_SCOPE = 'default'

export function buildDocumentContextText(title: string, text: string) {
  const normalizedTitle = title.trim()
  const normalizedText = text.trim()
  const fullText = normalizedText.length > 12000
    ? `${normalizedText.slice(0, 12000)}\n\n[正文过长，以下内容已截断]`
    : normalizedText

  return [
    normalizedTitle ? `标题：${normalizedTitle}` : '',
    fullText ? `正文：\n${fullText}` : '',
  ].filter(Boolean).join('\n\n')
}

export function formatHistoryTime(timestamp: number) {
  try {
    return new Date(timestamp).toLocaleString('zh-CN', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return ''
  }
}

export function createHistoryStorageKey(scope: string) {
  return `qmblog:ask-ai-history:${scope || DEFAULT_HISTORY_SCOPE}`
}

export function extractTitleCandidate(markdown: string) {
  const firstLine = markdown
    .split('\n')
    .map((line) => line.trim())
    .find(Boolean)

  if (!firstLine) return ''

  return firstLine
    .replace(/^[-*+]\s+/, '')
    .replace(/^\d+[.)]\s+/, '')
    .replace(/^#+\s+/, '')
    .replace(/[*_`~]/g, '')
    .trim()
    .slice(0, 120)
}

interface AIModalProps {
  editor: EditorInstance
  isOpen: boolean
  onClose: () => void
  selectedText: string
  position: { top: number; left: number } | null
  selectionRange?: { from: number; to: number } | null
  documentTitle?: string
  documentText?: string
  initialContext?: 'selection' | 'document'
  historyScope?: string
  onApplyTitle?: (title: string) => void
}

export function AIModal({
  editor,
  isOpen,
  onClose,
  selectedText,
  position,
  selectionRange,
  documentTitle = '',
  documentText = '',
  initialContext = 'selection',
  historyScope = DEFAULT_HISTORY_SCOPE,
  onApplyTitle,
}: AIModalProps) {
  const toast = useToast()
  const [aiActions, setAiActions] = useState<AiActionItem[]>(DEFAULT_AI_ACTIONS)
  const [aiLoading, setAiLoading] = useState(false)
  const [aiOutput, setAiOutput] = useState('')
  const [aiError, setAiError] = useState('')
  const [customPrompt, setCustomPrompt] = useState('')
  const [copied, setCopied] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [historyItems, setHistoryItems] = useState<AiHistoryItem[]>([])
  const [historyReady, setHistoryReady] = useState(false)
  const [contextMode, setContextMode] = useState<'selection' | 'document'>('selection')
  const aiLoadingRef = useRef(false)
  const modalRef = useRef<HTMLDivElement>(null)
  const outputScrollRef = useRef<HTMLDivElement>(null)
  const abortControllerRef = useRef<AbortController | null>(null)
  const historyStorageKey = useMemo(
    () => createHistoryStorageKey(historyScope),
    [historyScope],
  )

  const hasSelectionContext = selectedText.trim().length > 0
  const hasDocumentContext = documentTitle.trim().length > 0 || documentText.trim().length > 0

  const effectiveContext = hasSelectionContext
    ? contextMode
    : 'document'

  const effectiveInputText = effectiveContext === 'selection'
    ? selectedText.trim()
    : buildDocumentContextText(documentTitle, documentText)

  const syncHistoryItems = useCallback(() => {
    setHistoryItems(readStoredHistory<AiHistoryItem>(historyStorageKey).slice(0, MAX_HISTORY_ITEMS))
    setHistoryReady(true)
  }, [historyStorageKey])

  const requestClose = useCallback(() => {
    abortControllerRef.current?.abort()
    abortControllerRef.current = null
    aiLoadingRef.current = false
    setAiLoading(false)
    setAiOutput('')
    setAiError('')
    setCustomPrompt('')
    setCopied(false)
    setHistoryOpen(false)
    onClose()
  }, [onClose])

  const storeHistoryItem = useCallback((output: string, promptLabel: string) => {
    const normalizedOutput = output.trim()
    if (!normalizedOutput) return

    appendStoredHistoryItem<AiHistoryItem>(
      historyStorageKey,
      {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        output: normalizedOutput,
        promptLabel,
        contextMode: effectiveContext,
        selectionPreview: selectedText.trim().slice(0, 80),
        documentTitle: documentTitle.trim(),
        createdAt: Date.now(),
      },
      {
        maxItems: MAX_HISTORY_ITEMS,
      },
    )
  }, [documentTitle, effectiveContext, historyStorageKey, selectedText])

  useEffect(() => {
    fetch('/api/editor/ai-actions')
      .then((r) => r.json() as Promise<{ actions?: AiActionItem[] }>)
      .then((data: { actions?: AiActionItem[] }) => {
        if (Array.isArray(data.actions) && data.actions.length > 0) setAiActions(data.actions)
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    if (!historyReady) return
    try {
      window.localStorage.setItem(
        historyStorageKey,
        JSON.stringify(historyItems.slice(0, MAX_HISTORY_ITEMS)),
      )
    } catch {}
  }, [historyItems, historyReady, historyStorageKey])

  useEffect(() => {
    if (!isOpen) return
    const frame = window.requestAnimationFrame(() => {
      syncHistoryItems()
    })
    return () => window.cancelAnimationFrame(frame)
  }, [historyStorageKey, isOpen, syncHistoryItems])

  useEffect(() => {
    const handleHistoryUpdated = (event: Event) => {
      const detail = (event as CustomEvent<{ storageKey?: string; items?: AiHistoryItem[] }>).detail
      if (detail?.storageKey !== historyStorageKey || !Array.isArray(detail.items)) return
      setHistoryItems(detail.items.slice(0, MAX_HISTORY_ITEMS))
      setHistoryReady(true)
    }

    window.addEventListener(LOCAL_HISTORY_UPDATED_EVENT, handleHistoryUpdated)
    return () => window.removeEventListener(LOCAL_HISTORY_UPDATED_EVENT, handleHistoryUpdated)
  }, [historyStorageKey])

  useEffect(() => {
    if (!isOpen) return
    const handler = (e: MouseEvent) => {
      if (modalRef.current && !modalRef.current.contains(e.target as Node)) {
        requestClose()
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [isOpen, requestClose])

  useEffect(() => {
    if (!isOpen) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') requestClose()
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [isOpen, requestClose])

  useEffect(() => {
    if (!isOpen) return
    const previousOverflow = document.body.style.overflow
    const previousOverscroll = document.body.style.overscrollBehavior
    document.body.style.overflow = 'hidden'
    document.body.style.overscrollBehavior = 'none'
    return () => {
      document.body.style.overflow = previousOverflow
      document.body.style.overscrollBehavior = previousOverscroll
    }
  }, [isOpen])

  useEffect(() => {
    if (!isOpen || !aiLoading) return
    const scroller = outputScrollRef.current
    if (!scroller) return
    scroller.scrollTop = scroller.scrollHeight
  }, [aiOutput, aiLoading, isOpen])

  useEffect(() => {
    if (isOpen) {
      const frame = window.requestAnimationFrame(() => {
        setAiOutput('')
        setAiError('')
        setCustomPrompt('')
        setCopied(false)
        setHistoryOpen(false)
        setContextMode(
          hasSelectionContext
            ? initialContext
            : 'document',
        )
      })
      return () => window.cancelAnimationFrame(frame)
    }

    abortControllerRef.current?.abort()
    abortControllerRef.current = null
    aiLoadingRef.current = false
    const frame = window.requestAnimationFrame(() => {
      setAiLoading(false)
    })
    return () => window.cancelAnimationFrame(frame)
  }, [hasSelectionContext, initialContext, isOpen])

  const applyAiAction = (actionKey: string, customInput?: string, actionLabel?: string) => {
    if (!effectiveInputText || aiLoadingRef.current) return

    const promptLabel = actionLabel || customInput || '自定义提问'

    requestClose()

    startBackgroundTask({
      toast,
      errorPrefix: 'AI 处理失败',
      run: async () => {
        const res = await fetch('/api/editor/ai', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: actionKey,
            text: effectiveInputText,
            ...(customInput ? { customPrompt: customInput } : {}),
          }),
        })

        if (!res.ok) {
          const errData = await res.json().catch(() => ({ error: 'AI 处理失败' })) as { error?: string }
          throw new Error(errData.error || 'AI 处理失败')
        }

        if (!res.body) throw new Error('无响应流')
        const reader = res.body.getReader()
        if (!reader) throw new Error('无法读取响应流')

        const decoder = new TextDecoder()
        let output = ''
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          output += decoder.decode(value, { stream: true })
        }
        output += decoder.decode()

        if (!output.trim()) throw new Error('AI 返回为空')
        return output
      },
      onSuccess: (output) => {
        storeHistoryItem(output, promptLabel)
      },
    })
  }

  const handleCustomSubmit = () => {
    if (!customPrompt.trim() || aiLoading) return
    applyAiAction('custom', customPrompt.trim(), customPrompt.trim())
    setCustomPrompt('')
  }

  const insertAiBelow = (content = aiOutput) => {
    const normalized = content.trim()
    if (!normalized || !selectionRange) return
    replaceEditorRangeWithMarkdown(editor, normalized, { from: selectionRange.to, to: selectionRange.to })
    requestClose()
  }

  const replaceWithAi = (content = aiOutput) => {
    const normalized = content.trim()
    if (!normalized || !selectionRange) return
    replaceEditorRangeWithMarkdown(editor, normalized, selectionRange)
    requestClose()
  }

  const insertAtCursor = (content = aiOutput) => {
    const normalized = content.trim()
    if (!normalized) return
    replaceEditorRangeWithMarkdown(editor, normalized)
    requestClose()
  }

  const applyAiAsTitle = (content = aiOutput) => {
    const nextTitle = extractTitleCandidate(content)
    if (!nextTitle || !onApplyTitle) return
    onApplyTitle(nextTitle)
    requestClose()
  }

  const copyToClipboard = async (content = aiOutput) => {
    const normalized = content.trim()
    if (!normalized) return
    try {
      await navigator.clipboard.writeText(normalized)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {}
  }

  if (!isOpen || !position) return null

  const viewportH = typeof window !== 'undefined' ? window.innerHeight : 800
  const maxTop = viewportH - 80
  const clampedTop = Math.min(position.top, maxTop)
  const showAbove = position.top > viewportH * 0.65

  return (
    <div
      ref={modalRef}
      className="fixed z-50 w-[520px] rounded-xl border border-[var(--editor-line)] bg-white shadow-[0_20px_50px_rgba(0,0,0,0.15)] flex flex-col"
      style={{
        ...(showAbove
          ? { bottom: `${viewportH - position.top + 16}px` }
          : { top: `${clampedTop}px` }),
        left: `${Math.max(280, Math.min(position.left, (typeof window !== 'undefined' ? window.innerWidth : 1200) - 280))}px`,
        transform: 'translateX(-50%)',
        maxHeight: `${Math.min(viewportH - 80, 620)}px`,
        overscrollBehavior: 'contain',
      }}
    >
      <div className="p-4 space-y-3 overflow-y-auto overscroll-contain flex-1">
        <div className="flex items-center justify-between gap-3">
          <div className="text-xs font-medium text-[var(--editor-muted)]">
            {effectiveContext === 'selection' ? '当前默认作用于选中文本' : '当前默认作用于标题和正文'}
          </div>
          {historyItems.length > 0 && (
            <button
              type="button"
              onClick={() => setHistoryOpen((value) => !value)}
              className="inline-flex items-center gap-1 rounded-full border border-[var(--editor-line)] px-2.5 py-1 text-xs text-[var(--editor-ink)] hover:bg-[var(--editor-soft)] transition"
              title={historyOpen ? '收起历史生成' : '查看最近的 AI 生成记录'}
              aria-label={historyOpen ? '收起历史生成' : '查看最近的 AI 生成记录'}
            >
              <History className="h-3.5 w-3.5" />
              历史生成
            </button>
          )}
        </div>

        {hasSelectionContext && hasDocumentContext && (
          <div className="flex items-center gap-2 rounded-lg bg-[var(--editor-soft)] p-1">
            <button
              type="button"
              onClick={() => setContextMode('selection')}
              className={`flex-1 rounded-md px-3 py-1.5 text-sm transition ${
                effectiveContext === 'selection'
                  ? 'bg-white text-[var(--editor-ink)] shadow-sm'
                  : 'text-[var(--editor-muted)] hover:text-[var(--editor-ink)]'
              }`}
            >
              选中文本
            </button>
            <button
              type="button"
              onClick={() => setContextMode('document')}
              className={`flex-1 rounded-md px-3 py-1.5 text-sm transition ${
                effectiveContext === 'document'
                  ? 'bg-white text-[var(--editor-ink)] shadow-sm'
                  : 'text-[var(--editor-muted)] hover:text-[var(--editor-ink)]'
              }`}
            >
              标题 + 正文
            </button>
          </div>
        )}

        <div className="relative">
          <div className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none">
            <Sparkles className="h-4 w-4 text-[var(--editor-accent)]" />
          </div>
          <input
            type="text"
            autoFocus
            placeholder={
              effectiveContext === 'selection'
                ? 'Ask AI 处理选中文本...'
                : 'Ask AI 基于标题和正文回答或生成...'
            }
            value={customPrompt}
            onChange={(e) => setCustomPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                handleCustomSubmit()
              }
            }}
            disabled={aiLoading}
            className="w-full rounded-lg border border-[var(--editor-line)] bg-white pl-10 pr-3 py-2.5 text-sm text-[var(--editor-ink)] placeholder:text-[var(--stone-gray)] outline-none focus:border-[var(--editor-accent)] focus:ring-1 focus:ring-[var(--editor-accent)] disabled:opacity-50"
          />
        </div>
        <div className="text-[11px] text-[var(--editor-muted)]">
          提交后会在后台生成，完成后可在历史里复制、插入或再次应用。
        </div>

        {!aiOutput && !aiLoading && !historyOpen && (
          <div>
            <div className="mb-2 text-xs font-medium text-[var(--editor-muted)]">
              {effectiveContext === 'selection' ? '快捷操作' : '基于全文的快捷操作'}
            </div>
            <div className="flex flex-wrap gap-2">
              {effectiveContext === 'selection'
                ? aiActions.map((action) => (
                  <button
                    key={action.id}
                    type="button"
                    onClick={() => applyAiAction(action.action_key, undefined, action.label)}
                    disabled={aiLoading}
                    className="rounded-full border border-[var(--editor-line)] bg-white px-4 py-1.5 text-sm text-[var(--editor-ink)] transition hover:border-[var(--editor-accent)] hover:bg-[var(--editor-soft)] disabled:opacity-50"
                    title={action.description}
                  >
                    {action.label}
                  </button>
                ))
                : DOCUMENT_QUICK_ACTIONS.map((action) => (
                  <button
                    key={action.id}
                    type="button"
                    onClick={() => applyAiAction('custom', action.prompt, action.label)}
                    disabled={aiLoading || !hasDocumentContext}
                    className="rounded-full border border-[var(--editor-line)] bg-white px-4 py-1.5 text-sm text-[var(--editor-ink)] transition hover:border-[var(--editor-accent)] hover:bg-[var(--editor-soft)] disabled:opacity-50"
                    title={action.description}
                  >
                    {action.label}
                  </button>
                ))}
            </div>
          </div>
        )}

        {historyOpen && historyItems.length > 0 && (
          <div className="space-y-2 rounded-xl border border-[var(--editor-line)] bg-[var(--editor-panel)] p-3">
            <div className="text-xs font-medium text-[var(--editor-muted)]">最近生成</div>
            <div className="space-y-2">
              {historyItems.map((item) => (
                <div key={item.id} className="rounded-lg border border-[var(--editor-line)] bg-white p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-[var(--editor-ink)]">
                        {item.promptLabel}
                      </div>
                      <div className="mt-0.5 text-xs text-[var(--editor-muted)]">
                        {item.contextMode === 'selection'
                          ? `选区 · ${item.selectionPreview || '无选中文本'}`
                          : `全文 · ${item.documentTitle || '无标题'}`}
                      </div>
                    </div>
                    <div className="shrink-0 text-[10px] text-[var(--editor-muted)]">
                      {formatHistoryTime(item.createdAt)}
                    </div>
                  </div>
                  <div className="mt-2 line-clamp-3 text-sm text-[var(--editor-ink)] whitespace-pre-wrap">
                    {item.output}
                  </div>
                  <div className="mt-3 flex flex-wrap justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => copyToClipboard(item.output)}
                      className="rounded-lg border border-[var(--editor-line)] px-3 py-1.5 text-sm text-[var(--editor-ink)] hover:bg-[var(--editor-soft)] transition"
                    >
                      复制
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (effectiveContext === 'selection' && selectionRange) {
                          insertAiBelow(item.output)
                          return
                        }
                        insertAtCursor(item.output)
                      }}
                      className="rounded-lg border border-[var(--editor-line)] px-3 py-1.5 text-sm text-[var(--editor-ink)] hover:bg-[var(--editor-soft)] transition"
                    >
                      插入
                    </button>
                    {item.contextMode === 'document' && onApplyTitle && (
                      <button
                        type="button"
                        onClick={() => applyAiAsTitle(item.output)}
                        className="rounded-lg border border-[var(--editor-line)] px-3 py-1.5 text-sm text-[var(--editor-ink)] hover:bg-[var(--editor-soft)] transition"
                      >
                        使用首行作标题
                      </button>
                    )}
                    {effectiveContext === 'selection' && selectionRange && (
                      <button
                        type="button"
                        onClick={() => replaceWithAi(item.output)}
                        className="rounded-lg bg-[var(--editor-accent)] px-3 py-1.5 text-sm font-medium text-white hover:brightness-105 transition"
                      >
                        替换
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {aiLoading && (
          <div className="flex items-center gap-2 rounded-lg bg-[var(--editor-soft)] px-3 py-2.5 text-sm text-[var(--editor-muted)]">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span>AI 正在生成...</span>
          </div>
        )}

        {aiError && (
          <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
            {aiError}
          </div>
        )}

        {aiOutput && (
          <div className="space-y-2">
            <div className="relative rounded-lg border border-[var(--editor-line)] bg-[var(--editor-panel)]">
              <div
                ref={outputScrollRef}
                className="max-h-72 overflow-y-auto overscroll-contain px-3 py-2"
              >
                <div
                  className="rich-content text-sm text-[var(--editor-ink)]"
                  dangerouslySetInnerHTML={{ __html: renderMarkdownToHtml(aiOutput) }}
                />
              </div>
              <button
                type="button"
                onClick={() => copyToClipboard()}
                className="absolute top-2 right-2 flex items-center justify-center h-7 w-7 rounded-md bg-white/80 backdrop-blur border border-[var(--editor-line)] text-[var(--editor-muted)] hover:text-[var(--editor-ink)] hover:bg-white transition"
                title={copied ? '已复制' : '复制生成内容'}
                aria-label={copied ? '已复制' : '复制生成内容'}
              >
                {copied ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
              </button>
            </div>
            <div className="flex flex-wrap justify-end gap-2">
              {effectiveContext === 'selection' && selectionRange ? (
                <>
                  <button
                    type="button"
                    onClick={() => insertAiBelow()}
                    className="rounded-lg border border-[var(--editor-line)] px-3 py-1.5 text-sm font-medium text-[var(--editor-ink)] hover:bg-[var(--editor-soft)] transition"
                  >
                    插入下方
                  </button>
                  <button
                    type="button"
                    onClick={() => replaceWithAi()}
                    className="rounded-lg bg-[var(--editor-accent)] px-3 py-1.5 text-sm font-medium text-white hover:brightness-105 transition"
                  >
                    替换选区
                  </button>
                </>
              ) : (
                <>
                  {onApplyTitle && (
                    <button
                      type="button"
                      onClick={() => applyAiAsTitle()}
                      className="rounded-lg border border-[var(--editor-line)] px-3 py-1.5 text-sm font-medium text-[var(--editor-ink)] hover:bg-[var(--editor-soft)] transition"
                    >
                      使用首行作标题
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => insertAtCursor()}
                    className="rounded-lg bg-[var(--editor-accent)] px-3 py-1.5 text-sm font-medium text-white hover:brightness-105 transition"
                  >
                    插入到光标处
                  </button>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
