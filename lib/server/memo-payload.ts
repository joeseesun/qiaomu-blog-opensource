import { isMemoVisibility, type MemoWriteInput } from '@/lib/repositories/memos'

const MAX_HTML_LENGTH = 200_000

// Memos are written by the admin only, but the HTML is rendered on www.qiaomu.ai as-is,
// so drop scripts and inline event handlers as a second line of defence.
export function sanitizeMemoHtml(html: string) {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, '')
    .replace(/<script\b[^>]*\/?>/gi, '')
    .replace(/\s+on[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/(href|src)\s*=\s*(["']?)\s*javascript:[^"'\s>]*\2/gi, '$1="#"')
}

export function htmlToPlainText(html: string) {
  return html
    .replace(/<a\b[^>]*class="note-file"[^>]*>[\s\S]*?<\/a>/gi, '')
    .replace(/<(br|\/p|\/li|\/h[1-6]|\/blockquote|\/pre)\b[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export function parseMemoWritePayload(body: unknown): { ok: true; input: MemoWriteInput } | { ok: false; error: string } {
  if (!body || typeof body !== 'object') return { ok: false, error: '请求体必须是 JSON 对象' }
  const payload = body as Record<string, unknown>
  const input: MemoWriteInput = {}

  if (payload.html !== undefined) {
    if (typeof payload.html !== 'string') return { ok: false, error: 'html 必须是字符串' }
    if (payload.html.length > MAX_HTML_LENGTH) return { ok: false, error: '内容过长' }
    input.html = sanitizeMemoHtml(payload.html)
    input.text = typeof payload.text === 'string' ? payload.text.trim() : htmlToPlainText(input.html)
  }

  if (payload.visibility !== undefined) {
    if (!isMemoVisibility(payload.visibility)) return { ok: false, error: 'visibility 只能是 private、unlisted 或 public' }
    input.visibility = payload.visibility
  }

  if (payload.syndication !== undefined) {
    if (!payload.syndication || typeof payload.syndication !== 'object' || Array.isArray(payload.syndication)) {
      return { ok: false, error: 'syndication 必须是对象' }
    }
    input.syndication = Object.fromEntries(
      Object.entries(payload.syndication as Record<string, unknown>)
        .filter((entry): entry is [string, string] => typeof entry[1] === 'string')
        .slice(0, 20),
    )
  }

  return { ok: true, input }
}
