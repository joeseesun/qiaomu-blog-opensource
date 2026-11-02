import { describe, expect, it } from 'vitest'
import { generateMemoSlug } from '@/lib/repositories/memos'
import { htmlToPlainText, parseMemoWritePayload, sanitizeMemoHtml } from '@/lib/server/memo-payload'
import { resolveLoginRedirect } from '@/lib/login-redirect'

describe('memo payload', () => {
  it('strips scripts, inline handlers and javascript: urls', () => {
    const html = sanitizeMemoHtml('<p onclick="x()">a</p><script>alert(1)</script><a href="javascript:alert(1)">b</a><img src=x onerror=alert(1)>')
    expect(html).not.toMatch(/script|onclick|onerror|javascript:/i)
    expect(html).toContain('<p>a</p>')
  })

  it('derives plain text from html when text is missing', () => {
    expect(htmlToPlainText('<p>第一行</p><p>a &amp; b<br>c</p>')).toBe('第一行\na & b\nc')
    const parsed = parseMemoWritePayload({ html: '<p>hi</p>' })
    expect(parsed.ok && parsed.input.text).toBe('hi')
    expect(htmlToPlainText('<p>看附件</p><a class="note-file" href="/x.pdf" download="">x.pdf · 1 KB</a>')).toBe('看附件')
  })

  it('validates visibility', () => {
    expect(parseMemoWritePayload({ visibility: 'public' }).ok).toBe(true)
    expect(parseMemoWritePayload({ visibility: 'secret' }).ok).toBe(false)
  })

  it('generates short url-safe slugs', () => {
    const slug = generateMemoSlug(Date.UTC(2026, 9, 28))
    expect(slug).toMatch(/^[0-9a-z]{10}$/)
  })
})

describe('resolveLoginRedirect', () => {
  it('allows local paths and the www notes page only', () => {
    expect(resolveLoginRedirect('/admin/posts')).toBe('/admin/posts')
    expect(resolveLoginRedirect('https://www.qiaomu.ai/notes/')).toBe('https://www.qiaomu.ai/notes/')
    expect(resolveLoginRedirect('//evil.example')).toBe('/admin')
    expect(resolveLoginRedirect('https://evil.example/')).toBe('/admin')
    expect(resolveLoginRedirect(null)).toBe('/admin')
  })
})
