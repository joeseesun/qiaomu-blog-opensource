import TurndownService from 'turndown'

export type ExternalPublishTarget = 'x' | 'zhihu'
export interface PublishArticle { title: string; html: string; hasContent: boolean; cover?: string; summary?: string }
export interface PublishProgress { state: 'running' | 'done' | 'error' | 'cancelled'; text?: string; url?: string; error?: { message?: string } }
export const PUBLISH_BRIDGE_URL = 'http://127.0.0.1:19876'

export function draftUrl(target: ExternalPublishTarget, value?: string) {
  if (!value) return undefined
  try {
    const url = new URL(value)
    const hosts = target === 'x' ? ['x.com', 'twitter.com'] : ['zhuanlan.zhihu.com']
    return url.protocol === 'https:' && hosts.includes(url.hostname) && !url.username && !url.password ? url.href : undefined
  } catch { return undefined }
}

export async function bridgeRequest(path: string, init: RequestInit = {}) {
  let response: Response
  try { response = await fetch(`${PUBLISH_BRIDGE_URL}${path}`, { ...init, signal: init.signal ?? AbortSignal.timeout(8000) }) }
  catch { throw new Error('未连接本机发布桥接。请先运行 npm run publish:bridge，并允许浏览器访问本地网络。') }
  const result = await response.json()
  if (!response.ok) throw new Error(result.error || '发布桥接请求失败')
  return result
}

/** Build the same v1 job consumed by Qiaomu Publish's Clipper adapter. Images never go through a cloud relay. */
export async function prepareExternalArticle(target: ExternalPublishTarget, article: PublishArticle, signal: AbortSignal) {
  const title = article.title.trim()
  if (!title || !article.hasContent) throw new Error('请先填写标题和正文。')
  if (target === 'zhihu' && Array.from(title).length > 100) throw new Error('知乎标题不能超过 100 字。')
  const doc = new DOMParser().parseFromString(article.html, 'text/html')
  if (doc.querySelector('video,audio,iframe')) throw new Error('正文包含视频、音频或嵌入内容，请先替换为图片或链接再发送。')
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
  for (const node of doc.querySelectorAll('img')) {
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
  return { job: { v: 1, id: crypto.randomUUID(), target, title, noteName: title, content, assets: assets.map(({ id, name, mime, bytes }) => ({ id, name, mime, bytes })) }, assets }
}
