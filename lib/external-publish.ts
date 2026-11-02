import TurndownService from 'turndown'

export type ExternalPublishTarget = 'x' | 'zhihu'
export interface PublishArticle { title: string; html: string; hasContent: boolean; cover?: string; summary?: string }
export interface PublishProgress { state: 'running' | 'done' | 'error' | 'cancelled'; text?: string; url?: string; error?: { message?: string } }
const PUBLISH_CHANNEL = 'qiaomu-web-publish-v1'

export function draftUrl(target: ExternalPublishTarget, value?: string) {
  if (!value) return undefined
  try {
    const url = new URL(value)
    const hosts = target === 'x' ? ['x.com', 'twitter.com'] : ['zhuanlan.zhihu.com']
    return url.protocol === 'https:' && hosts.includes(url.hostname) && !url.username && !url.password ? url.href : undefined
  } catch { return undefined }
}

/** Direct same-page handoff to the extension's isolated content script. No local HTTP service. */
export function requestPublishExtension<T = unknown>(kind: 'ping' | 'start' | 'status' | 'cancel', payload?: unknown, signal?: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new DOMException('已停止', 'AbortError')); return }
    const id = crypto.randomUUID()
    const cleanup = () => { clearTimeout(timer); window.removeEventListener('message', receive); signal?.removeEventListener('abort', stop) }
    const stop = () => { cleanup(); reject(new DOMException('已停止', 'AbortError')) }
    const receive = (event: MessageEvent) => {
      const message = event.data
      if (event.source !== window || event.origin !== location.origin || message?.channel !== PUBLISH_CHANNEL || message.direction !== 'response' || message.id !== id) return
      cleanup()
      if (message.result?.error && typeof message.result.error === 'string') reject(new Error(message.result.error))
      else resolve(message.result as T)
    }
    const timer = setTimeout(() => { cleanup(); reject(new Error(kind === 'ping' ? '浏览器发布连接尚未就绪，请稍后重试。' : '浏览器发布连接超时，请检查平台草稿后重试。')) }, kind === 'start' ? 30_000 : 3000)
    window.addEventListener('message', receive)
    signal?.addEventListener('abort', stop, { once: true })
    window.postMessage({ channel: PUBLISH_CHANNEL, direction: 'request', id, kind, payload }, location.origin)
  })
}

/** Convert unsupported players only in the sending copy; never mutate the editor. */
export function normalizePublishEmbeds(doc: Document, base: string) {
  let converted = 0
  for (const node of Array.from(doc.querySelectorAll('video,audio,iframe,div[data-twitter-src]'))) {
    if (!doc.body.contains(node)) continue
    const source = node.getAttribute('data-twitter-src') || node.getAttribute('src') || node.querySelector('source')?.getAttribute('src') || node.closest('a[href]')?.getAttribute('href') || ''
    const paragraph = doc.createElement('p')
    try {
      const url = new URL(source, base)
      if (!source || !['https:', 'http:'].includes(url.protocol)) throw new Error('unsupported')
      if (['www.youtube.com', 'www.youtube-nocookie.com', 'youtube.com'].includes(url.hostname) && url.pathname.startsWith('/embed/')) { url.hostname = 'www.youtube.com'; const id = url.pathname.split('/')[2]; url.pathname = '/watch'; url.search = ''; url.searchParams.set('v', id) }
      if (url.hostname === 'player.bilibili.com' && url.searchParams.get('bvid')) { const id = url.searchParams.get('bvid'); url.hostname = 'www.bilibili.com'; url.pathname = `/video/${id}`; url.search = '' }
      const link = doc.createElement('a'); link.href = url.href
      link.textContent = node.getAttribute('title') || (node.tagName === 'AUDIO' ? '收听音频' : node.hasAttribute('data-twitter-src') ? '查看原帖' : '查看视频或原内容')
      paragraph.appendChild(link)
    } catch { paragraph.textContent = node.getAttribute('title') || '此媒体请查看原文。' }
    node.replaceWith(paragraph); converted += 1
  }
  return converted
}

/** Build the same v1 job consumed by Qiaomu Publish's Clipper adapter. Images never go through a cloud relay. */
export async function prepareExternalArticle(target: ExternalPublishTarget, article: PublishArticle, signal: AbortSignal) {
  const title = article.title.trim()
  if (!title || !article.hasContent) throw new Error('请先填写标题和正文。')
  if (target === 'zhihu' && Array.from(title).length > 100) throw new Error('知乎标题不能超过 100 字。')
  const doc = new DOMParser().parseFromString(article.html, 'text/html')
  const convertedEmbeds = normalizePublishEmbeds(doc, location.href)
  doc.querySelectorAll('script,style,object,embed').forEach(node => node.remove())
  doc.querySelectorAll('*').forEach(node => {
    for (const attribute of [...node.attributes]) if (/^on/i.test(attribute.name) || ['srcset', 'style'].includes(attribute.name)) node.removeAttribute(attribute.name)
  })
  doc.querySelectorAll('a[href]').forEach(node => {
    try { const url = new URL(node.getAttribute('href')!, location.href); if (!['https:', 'http:'].includes(url.protocol)) node.removeAttribute('href'); else node.setAttribute('href', url.href) } catch { node.removeAttribute('href') }
  })
  const assets: { id: string; name: string; mime: string; bytes: number; base64: string }[] = []
  const cache = new Map<string, string>()
  let total = 0
  const image = async (source: string) => {
    const url = new URL(source, location.href)
    if (!['https:', 'http:', 'data:', 'blob:'].includes(url.protocol)) throw new Error('图片地址无效')
    const cached = cache.get(url.href); if (cached) return cached
    const response = await fetch(url.href, { signal, credentials: 'same-origin' })
    if (!response.ok) throw new Error('图片读取失败，请先将外链图片保存到博客。')
    const blob = await response.blob()
    if (!/^image\/(png|jpeg|webp|gif)$/.test(blob.type)) throw new Error('请将图片转为 PNG、JPEG、WebP 或 GIF 后再发送。')
    if (blob.size > 20 * 1024 * 1024 || (total += blob.size) > 40 * 1024 * 1024) throw new Error('图片过大：单张最多 20 MB，合计最多 40 MB。')
    const bytes = new Uint8Array(await blob.arrayBuffer())
    let binary = ''
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
    const id = `image-${assets.length + 1}`
    assets.push({ id, name: `${id}.${blob.type.split('/')[1]}`, mime: blob.type, bytes: blob.size, base64: btoa(binary) })
    cache.set(url.href, id); return id
  }
  for (const node of Array.from(doc.querySelectorAll('img'))) {
    const source = node.getAttribute('src')
    if (!source) throw new Error('正文有图片缺少地址，请删除或重新插入。')
    node.setAttribute('src', `${target === 'x' ? 'https://qm-image.local/' : 'qp-asset://'}${await image(source)}`)
  }
  const cover = article.cover ? await image(article.cover) : undefined
  const content: { markdown?: string; html?: string; cover?: string; summary?: string } = { cover, summary: article.summary }
  if (target === 'x') {
    if (doc.querySelectorAll('img,table').length + (cover ? 1 : 0) > 25) throw new Error('X 文章的图片与表格合计请控制在 25 个以内。')
    const td = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced' })
    td.keep(['table'])
    content.markdown = `---\ntitle: ${JSON.stringify(title)}\n${cover ? `cover: ${JSON.stringify(`https://qm-image.local/${cover}`)}\n` : ''}---\n\n${td.turndown(doc.body.innerHTML)}`
  } else content.html = doc.body.innerHTML
  return { job: { v: 1, id: crypto.randomUUID(), target, title, noteName: title, content, assets: assets.map(({ id, name, mime, bytes }) => ({ id, name, mime, bytes })) }, assets, convertedEmbeds }
}
