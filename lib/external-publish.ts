import TurndownService from 'turndown'

export type ExternalPublishTarget = 'x' | 'zhihu'
export interface PublishArticle { title: string; html: string; hasContent: boolean; cover?: string; summary?: string }
export interface PublishProgress { state: 'running' | 'done' | 'error' | 'cancelled'; text?: string; url?: string; error?: { message?: string } }
const PUBLISH_CHANNEL = 'qiaomu-web-publish-v1'

/** Rasterize only the sending copy. SVG is supported by the blog but not draft uploads. */
async function preparePublishImage(blob: Blob, signal: AbortSignal): Promise<Blob> {
  if (blob.type.split(';')[0].trim().toLowerCase() !== 'image/svg+xml') return blob
  signal.throwIfAborted()
  const url = URL.createObjectURL(blob)
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image()
      const cleanup = () => { img.onload = null; img.onerror = null; signal.removeEventListener('abort', abort) }
      const abort = () => { cleanup(); img.src = ''; reject(signal.reason) }
      img.onload = () => { cleanup(); resolve(img) }
      img.onerror = () => { cleanup(); reject(new Error('SVG 图片转换失败，请重新上传图片后再发送。')) }
      signal.addEventListener('abort', abort, { once: true })
      img.src = url
    })
    signal.throwIfAborted()
    const width = image.naturalWidth
    const height = image.naturalHeight
    if (!width || !height || width * height > 32 * 1024 * 1024) throw new Error('SVG 图片尺寸无效或过大，请缩小后再发送。')
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d')
    if (!context) throw new Error('无法转换 SVG 图片，请使用支持画布的浏览器。')
    context.drawImage(image, 0, 0)
    const png = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(value => value ? resolve(value) : reject(new Error('SVG 图片转换失败，请重新上传图片后再发送。')), 'image/png')
    })
    signal.throwIfAborted()
    return png
  } finally { URL.revokeObjectURL(url) }
}

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

/** X treats a standalone MP4 link as an upload request. Keep exported video links inline. */
export function keepVideoLinksInline(doc: Document, base: string) {
  for (const link of Array.from(doc.querySelectorAll('a[href]'))) {
    try {
      const url = new URL(link.getAttribute('href') || '', base)
      if (!['http:', 'https:'].includes(url.protocol) || !/\.mp4$/i.test(url.pathname)) continue
      const block = link.closest('p,div,li,blockquote') || link.parentElement
      const text = block?.textContent?.trim() || ''
      if (!link.textContent?.trim()) continue
      if (text === link.textContent.trim()) link.parentNode?.insertBefore(doc.createTextNode('视频：'), link)
    } catch { /* Invalid links are removed by the common URL sanitizer. */ }
  }
}

/** Convert unsupported players only in the sending copy; never mutate the editor. */
export function normalizePublishEmbeds(doc: Document, base: string, keepMp4 = false) {
  let converted = 0
  for (const node of Array.from(doc.querySelectorAll('video,audio,iframe,div[data-twitter-src]'))) {
    if (!doc.body.contains(node)) continue
    const source = node.getAttribute('data-twitter-src') || node.getAttribute('src') || node.querySelector('source')?.getAttribute('src') || node.closest('a[href]')?.getAttribute('href') || ''
    const paragraph = doc.createElement('p')
    try {
      const url = new URL(source, base)
      if (!source || !['https:', 'http:'].includes(url.protocol)) throw new Error('unsupported')
      if (keepMp4 && node.tagName === 'VIDEO' && /\.mp4$/i.test(url.pathname)) { node.setAttribute('src', url.href); continue }
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
export async function prepareExternalArticle(target: ExternalPublishTarget, article: PublishArticle, signal: AbortSignal, onProgress?: (text: string) => void) {
  const title = article.title.trim()
  if (!title || !article.hasContent) throw new Error('请先填写标题和正文。')
  if (target === 'zhihu' && Array.from(title).length > 100) throw new Error('知乎标题不能超过 100 字。')
  const doc = new DOMParser().parseFromString(article.html, 'text/html')
  const convertedEmbeds = normalizePublishEmbeds(doc, location.href, target === 'x')
  let videoCount = 0
  let videoFallbacks = 0
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
  const image = async (source: string, video = false) => {
    const url = new URL(source, location.href)
    if (!['https:', 'http:', 'data:', 'blob:'].includes(url.protocol)) throw new Error('图片地址无效')
    const cached = cache.get(url.href); if (cached) return cached
    onProgress?.(`正在读取${video ? '视频' : '图片'} ${assets.length + 1}…`)
    const response = await fetch(url.href, { signal, credentials: 'same-origin' })
    if (!response.ok) throw new Error('图片读取失败，请先将外链图片保存到博客。')
    let blob = await response.blob()
    if (blob.size > (video ? 32 : 20) * 1024 * 1024) throw new Error('媒体文件超过本次自动传输容量')
    if (!video) blob = await preparePublishImage(blob, signal)
    if (video ? blob.type !== 'video/mp4' : !/^image\/(png|jpeg|webp|gif)$/.test(blob.type)) throw new Error('请将图片转为 PNG、JPEG、WebP 或 GIF 后再发送。')
    if (blob.size > (video ? 32 : 20) * 1024 * 1024 || total + blob.size > 40 * 1024 * 1024) throw new Error('媒体文件超过本次自动传输容量')
    total += blob.size
    const bytes = new Uint8Array(await blob.arrayBuffer())
    let binary = ''
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
    const id = `${video ? 'video' : 'image'}-${assets.length + 1}`
    assets.push({ id, name: `${id}.${blob.type.split('/')[1]}`, mime: blob.type, bytes: blob.size, base64: btoa(binary) })
    cache.set(url.href, id); return id
  }
  for (const node of Array.from(doc.querySelectorAll('img'))) {
    const source = node.getAttribute('src')
    if (!source) throw new Error('正文有图片缺少地址，请删除或重新插入。')
    node.setAttribute('src', `${target === 'x' ? 'https://qm-image.local/' : 'qp-asset://'}${await image(source)}`)
  }
  if (target === 'x') {
    // Existing MP4 download cards are also article videos; preserve their position.
    for (const link of Array.from(doc.querySelectorAll('a[href]'))) {
      try {
        const url = new URL(link.getAttribute('href') || '', location.href)
        if (!['https:', 'http:'].includes(url.protocol) || !/\.mp4$/i.test(url.pathname) || !link.textContent?.trim() || link.querySelector('img')) continue
        const video = doc.createElement('video'); video.setAttribute('src', url.href); video.setAttribute('title', link.textContent.trim()); link.replaceWith(video)
      } catch { /* The common sanitizer handles malformed links. */ }
    }
    for (const video of Array.from(doc.querySelectorAll('video'))) {
      const source = video.getAttribute('src') || ''
      try {
        const id = await image(source, true)
        video.setAttribute('src', `https://qm-image.local/${id}`); videoCount += 1
      } catch (error) {
        if (signal.aborted) throw error
        const link = doc.createElement('a'); link.setAttribute('href', source); link.textContent = video.getAttribute('title') || '查看视频'; video.replaceWith(link); videoFallbacks += 1
      }
    }
  }
  const cover = article.cover ? await image(article.cover) : undefined
  const content: { markdown?: string; html?: string; cover?: string; summary?: string } = { cover, summary: article.summary }
  if (target === 'x') {
    if (doc.querySelectorAll('img,video,table').length + (cover ? 1 : 0) > 25) throw new Error('X 文章的图片与表格合计请控制在 25 个以内。')
    keepVideoLinksInline(doc, location.href)
    const td = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced' })
    td.keep(['table'])
    td.addRule('article-video', { filter: 'video', replacement: (_content, node) => `\n\n<video src="${node.getAttribute('src')}"></video>\n\n` })
    content.markdown = `---\ntitle: ${JSON.stringify(title)}\n${cover ? `cover: ${JSON.stringify(`https://qm-image.local/${cover}`)}\n` : ''}---\n\n${td.turndown(doc.body.innerHTML)}`
  } else content.html = doc.body.innerHTML
  return { job: { v: 1, id: crypto.randomUUID(), target, title, noteName: title, content, assets: assets.map(({ id, name, mime, bytes }) => ({ id, name, mime, bytes })) }, assets, convertedEmbeds, videoCount, videoFallbacks }
}
