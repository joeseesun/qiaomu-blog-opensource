import { describe, expect, it } from 'vitest'
import { draftUrl } from '@/lib/external-publish'

describe('draft receipt links', () => {
  it('accepts only HTTPS URLs for the selected platform', () => {
    expect(draftUrl('x', 'https://x.com/i/articles/123')).toBe('https://x.com/i/articles/123')
    expect(draftUrl('zhihu', 'https://zhuanlan.zhihu.com/p/123')).toBe('https://zhuanlan.zhihu.com/p/123')
    for (const url of ['javascript:alert(1)', 'http://x.com/a', 'https://x.com.evil.example/', 'https://user:password@x.com/a', 'https://zhuanlan.zhihu.com/p/1']) expect(draftUrl('x', url)).toBeUndefined()
  })
})

// Turndown already depends on Domino; use the same installed DOM in Node regression tests.
import { createRequire } from 'node:module'
import { afterEach, vi } from 'vitest'
import { normalizePublishEmbeds, prepareExternalArticle, requestPublishExtension } from '@/lib/external-publish'
const domino = createRequire(import.meta.url)('@mixmark-io/domino') as { createWindow: (html: string) => { document: Document } }
function documentOf(html: string) {
  const doc = domino.createWindow(html).document
  // Domino's NodeList is array-like, while real browsers also make it iterable.
  const nodes = doc.querySelectorAll('*')
  const prototype = Object.getPrototypeOf(nodes)
  if (!prototype[Symbol.iterator]) prototype[Symbol.iterator] = Array.prototype[Symbol.iterator]
  return doc
}
afterEach(() => vi.unstubAllGlobals())
describe('automatic content preparation', () => {
  it('turns audio/video, YouTube, Bilibili and tweet embeds into useful links', () => {
    const doc = documentOf('<video src="/movie.mp4"></video><audio><source src="/podcast.mp3"></audio><iframe src="https://www.youtube.com/embed/abc123"></iframe><iframe src="https://player.bilibili.com/player.html?bvid=BV123"></iframe><div data-twitter-src="https://x.com/vista8/status/123"></div>')
    expect(normalizePublishEmbeds(doc, 'https://blog.qiaomu.ai/test')).toBe(5)
    expect(doc.querySelector('video,audio,iframe,[data-twitter-src]')).toBeFalsy()
    const urls = Array.from(doc.querySelectorAll('a')).map(node => node.getAttribute('href'))
    expect(urls).toEqual(['https://blog.qiaomu.ai/movie.mp4', 'https://blog.qiaomu.ai/podcast.mp3', 'https://www.youtube.com/watch?v=abc123', 'https://www.bilibili.com/video/BV123', 'https://x.com/vista8/status/123'])
  })
  it('does not turn invalid media addresses into executable links', () => {
    const doc = documentOf('<iframe src="javascript:alert(1)"></iframe><video></video>')
    expect(normalizePublishEmbeds(doc, 'https://blog.qiaomu.ai/test')).toBe(2)
    expect(doc.querySelector('a,iframe,video')).toBeFalsy()
    expect(doc.body.textContent).toContain('此媒体请查看原文')
  })
  it('prepares both platforms without requiring manual edits or touching the source article', async () => {
    vi.stubGlobal('DOMParser', class { parseFromString(html: string) { return documentOf(html) } })
    vi.stubGlobal('location', { href: 'https://blog.qiaomu.ai/editor' })
    const article = { title: '测试', html: '<p>正文</p><iframe src="https://www.youtube.com/embed/abc"></iframe>', hasContent: true }
    const html = article.html
    const zhihu = await prepareExternalArticle('zhihu', article, new AbortController().signal)
    expect(zhihu.convertedEmbeds).toBe(1)
    expect(zhihu.job.content.html).toContain('https://www.youtube.com/watch?v=abc')
    const x = await prepareExternalArticle('x', article, new AbortController().signal)
    expect(x.job.content.markdown).toContain('https://www.youtube.com/watch?v=abc')
    expect(article.html).toBe(html)
  })
})
describe('direct extension handoff', () => {
  it('uses same-page messages and accepts only its own matching extension reply', async () => {
    const win = new EventTarget() as EventTarget & { postMessage: (value: unknown, origin: string) => void }
    vi.stubGlobal('window', win)
    vi.stubGlobal('location', { origin: 'https://blog.qiaomu.ai' })
    const emit = (data: unknown, origin: string, source: unknown) => { const event = new Event('message'); Object.assign(event, { data, origin, source }); win.dispatchEvent(event) }
    win.postMessage = (request: unknown, origin: string) => {
      const message = request as { id: string; channel: string; direction: string; kind: string }
      expect(origin).toBe('https://blog.qiaomu.ai')
      expect(message.kind).toBe('ping')
      queueMicrotask(() => {
        const reply = { ...message, direction: 'response', result: { v: 1 } }
        emit(reply, 'https://evil.example', win)
        emit({ ...reply, id: 'wrong' }, origin, win)
        emit(reply, origin, win)
      })
    }
    const network = vi.fn(); vi.stubGlobal('fetch', network)
    await expect(requestPublishExtension('ping')).resolves.toEqual({ v: 1 })
    expect(network).not.toHaveBeenCalled()
  })
})
