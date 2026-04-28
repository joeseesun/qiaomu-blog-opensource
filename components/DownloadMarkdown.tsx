'use client'

import { useToast } from '@/components/Toast'
import { copyAsWechatArticleFormat, downloadArticleAsPdf } from '@/lib/wechat-copy'
import { Copy, FileDown } from 'lucide-react'
import TurndownService from 'turndown'

const URL_ATTRIBUTES = [
  ['img', 'src'],
  ['a', 'href'],
  ['audio', 'src'],
  ['video', 'src'],
  ['source', 'src'],
] as const

function shouldRewriteUrl(value: string) {
  if (!value) return false
  const trimmed = value.trim()

  if (!trimmed || trimmed.startsWith('#')) return false
  if (/^(?:[a-z]+:|\/\/)/i.test(trimmed)) return false

  return true
}

function absolutizeHtmlUrls(html: string) {
  const parser = new DOMParser()
  const doc = parser.parseFromString(html, 'text/html')
  const baseUrl = window.location.origin

  for (const [selector, attribute] of URL_ATTRIBUTES) {
    for (const element of doc.querySelectorAll<HTMLElement>(selector)) {
      const value = element.getAttribute(attribute)
      if (!value || !shouldRewriteUrl(value)) continue
      element.setAttribute(attribute, new URL(value, baseUrl).toString())
    }
  }

  return doc.body.innerHTML
}

export function DownloadMarkdown({ title, html }: { title: string; html: string }) {
  const toast = useToast()

  const handleDownload = () => {
    const td = new TurndownService({
      headingStyle: 'atx',
      bulletListMarker: '-',
      codeBlockStyle: 'fenced',
    })
    const normalizedHtml = absolutizeHtmlUrls(html)
    // 保留图片标签（turndown 默认就支持 img → ![](src)）
    const markdown = td.turndown(normalizedHtml)
    const blob = new Blob([`# ${title}\n\n${markdown}`], { type: 'text/markdown;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${title}.md`
    a.click()
    URL.revokeObjectURL(url)
  }

  const handleCopyWechat = async () => {
    try {
      await copyAsWechatArticleFormat(title, html)
      toast.success('已复制公众号格式')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '复制公众号格式失败')
    }
  }

  const handleDownloadPdf = async () => {
    try {
      await downloadArticleAsPdf(title, html)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '导出 PDF 失败')
    }
  }

  return (
    <span className="inline-flex items-center gap-1">
      <button
        onClick={handleDownload}
        title="下载 Markdown"
        aria-label="下载 Markdown"
        className="inline-flex items-center justify-center rounded p-1 text-[var(--stone-gray)] hover:text-[var(--editor-accent)] hover:bg-[var(--editor-accent)]/8 transition-colors"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <polyline points="7 10 12 15 17 10" />
          <line x1="12" y1="15" x2="12" y2="3" />
        </svg>
      </button>
      <button
        onClick={handleCopyWechat}
        title="复制公众号格式"
        aria-label="复制公众号格式"
        className="inline-flex items-center justify-center rounded p-1 text-[var(--stone-gray)] hover:text-[var(--editor-accent)] hover:bg-[var(--editor-accent)]/8 transition-colors"
      >
        <Copy className="h-3.5 w-3.5" />
      </button>
      <button
        onClick={handleDownloadPdf}
        title="下载 PDF"
        aria-label="下载 PDF"
        className="inline-flex items-center justify-center rounded p-1 text-[var(--stone-gray)] hover:text-[var(--editor-accent)] hover:bg-[var(--editor-accent)]/8 transition-colors"
      >
        <FileDown className="h-3.5 w-3.5" />
      </button>
    </span>
  )
}
