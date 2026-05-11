import { NextRequest, NextResponse } from 'next/server'
import { getAppCloudflareEnv } from '@/lib/cloudflare'
import { authenticateRequest } from '@/lib/admin-auth'
import { nanoid } from 'nanoid'

type ImageBucket = {
  put: (
    key: string,
    value: File | ArrayBuffer | ArrayBufferView | ReadableStream,
    options?: {
      httpMetadata?: {
        contentType?: string
        cacheControl?: string
      }
      customMetadata?: Record<string, string>
    }
  ) => Promise<void>
  get: (key: string) => Promise<{ customMetadata?: Record<string, string> } | null>
}

type RuntimeEnv = {
  IMAGES?: ImageBucket
  ENABLE_CF_IMAGE_PIPELINE?: string
}

const MAX_IMAGE_SIZE = 25 * 1024 * 1024 // 25MB — remote fetch to R2
const FETCH_TIMEOUT_MS = 15_000

const ALLOWED_IMAGE_TYPES = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/svg+xml',
  'image/avif',
]

const EXT_TO_MIME: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  avif: 'image/avif',
}

function readFlag(value: unknown): boolean {
  return typeof value === 'string' && ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase())
}

function sanitizeFilename(filename: string) {
  const trimmed = filename.trim().toLowerCase()
  const safe = trimmed.replace(/[^a-z0-9._-]+/g, '-').replace(/-+/g, '-')
  return safe || 'image'
}

function buildAssetUrls(encodedKey: string, cloudflareEnabled: boolean) {
  const baseUrl = `/api/images/${encodedKey}`
  return {
    raw: baseUrl,
    content: cloudflareEnabled ? `${baseUrl}?w=1600&q=85&format=webp` : baseUrl,
    thumb: cloudflareEnabled ? `${baseUrl}?w=960&q=82&format=webp` : baseUrl,
    cover: cloudflareEnabled ? `${baseUrl}?w=1600&h=900&fit=cover&q=84&format=webp` : baseUrl,
  }
}

async function sha256Hex(buffer: ArrayBuffer): Promise<string> {
  const hashBuffer = await crypto.subtle.digest('SHA-256', buffer)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 16)
}

function extractFilenameFromUrl(url: URL): string {
  const last = url.pathname.split('/').pop() || 'image'
  const clean = last.split('?')[0].split('#')[0]
  return clean || 'image'
}

function inferContentType(rawType: string | null, url: URL): string | null {
  const normalized = (rawType || '').toLowerCase().split(';')[0].trim()
  if (normalized && ALLOWED_IMAGE_TYPES.includes(normalized)) return normalized

  const name = extractFilenameFromUrl(url)
  const ext = name.split('.').pop()?.toLowerCase() || ''
  if (ext && EXT_TO_MIME[ext]) return EXT_TO_MIME[ext]
  return null
}

export async function POST(req: NextRequest) {
  try {
    const env = (await getAppCloudflareEnv()) as RuntimeEnv & { DB?: D1Database }
    const isAuthenticated = await authenticateRequest(req, env?.DB)

    if (!isAuthenticated) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    if (!env?.IMAGES) {
      return NextResponse.json(
        { error: '图片存储未配置，请用 Cloudflare preview/runtime 启动。' },
        { status: 500 }
      )
    }

    const body = await req.json().catch(() => null) as { url?: unknown } | null
    const rawUrl = typeof body?.url === 'string' ? body.url.trim() : ''

    if (!rawUrl) {
      return NextResponse.json({ error: '缺少 url' }, { status: 400 })
    }

    let sourceUrl: URL
    try {
      sourceUrl = new URL(rawUrl)
    } catch {
      return NextResponse.json({ error: 'url 格式非法' }, { status: 400 })
    }

    if (sourceUrl.protocol !== 'http:' && sourceUrl.protocol !== 'https:') {
      return NextResponse.json({ error: '仅支持 http/https' }, { status: 400 })
    }

    // Fetch without Referer to bypass hotlink-protection; no cookies.
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)

    let remote: Response
    try {
      remote = await fetch(sourceUrl.toString(), {
        method: 'GET',
        redirect: 'follow',
        signal: controller.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; channing-blog-importer/1.0)',
          'Accept': 'image/*;q=0.95,*/*;q=0.1',
        },
      })
    } catch (err) {
      clearTimeout(timer)
      const message = err instanceof Error && err.name === 'AbortError' ? '远程拉取超时' : '远程拉取失败'
      return NextResponse.json({ error: message }, { status: 502 })
    }
    clearTimeout(timer)

    if (!remote.ok) {
      return NextResponse.json(
        { error: `远程返回 ${remote.status}` },
        { status: 502 }
      )
    }

    const contentType = inferContentType(remote.headers.get('content-type'), sourceUrl)
    if (!contentType) {
      return NextResponse.json({ error: '不支持的图片类型' }, { status: 415 })
    }

    const contentLengthHeader = remote.headers.get('content-length')
    if (contentLengthHeader && Number(contentLengthHeader) > MAX_IMAGE_SIZE) {
      return NextResponse.json({ error: '图片超过 25MB 限制' }, { status: 413 })
    }

    const buffer = await remote.arrayBuffer()
    if (buffer.byteLength === 0) {
      return NextResponse.json({ error: '远程内容为空' }, { status: 502 })
    }
    if (buffer.byteLength > MAX_IMAGE_SIZE) {
      return NextResponse.json({ error: '图片超过 25MB 限制' }, { status: 413 })
    }

    const now = new Date()
    const yyyy = now.getUTCFullYear()
    const mm = String(now.getUTCMonth() + 1).padStart(2, '0')
    const cloudflareImagePipeline = readFlag(env.ENABLE_CF_IMAGE_PIPELINE)

    const originalName = extractFilenameFromUrl(sourceUrl)
    const fileHash = await sha256Hex(buffer)
    const safeName = sanitizeFilename(originalName)
    const dedupKey = `image/${yyyy}/${mm}/${fileHash}-${safeName}`

    const existing = await env.IMAGES.get(dedupKey)
    if (existing) {
      const encodedKey = dedupKey.split('/').map(encodeURIComponent).join('/')
      return NextResponse.json({
        success: true,
        key: dedupKey,
        url: `/api/images/${encodedKey}`,
        type: 'image',
        name: originalName,
        size: buffer.byteLength,
        deduplicated: true,
        sourceUrl: sourceUrl.toString(),
        delivery: cloudflareImagePipeline ? 'cloudflare' : 'origin',
        variants: buildAssetUrls(encodedKey, cloudflareImagePipeline),
      })
    }

    // Fallback if hash collided with unusual filename — append nanoid.
    const key = dedupKey || `image/${yyyy}/${mm}/${nanoid(10)}-${safeName}`

    await env.IMAGES.put(key, buffer, {
      httpMetadata: {
        contentType,
        cacheControl: 'public, max-age=31536000, immutable',
      },
      customMetadata: {
        originalName,
        sourceUrl: sourceUrl.toString(),
        importedAt: now.toISOString(),
      },
    })

    const encodedKey = key.split('/').map(encodeURIComponent).join('/')
    return NextResponse.json({
      success: true,
      key,
      url: `/api/images/${encodedKey}`,
      type: 'image',
      name: originalName,
      size: buffer.byteLength,
      sourceUrl: sourceUrl.toString(),
      delivery: cloudflareImagePipeline ? 'cloudflare' : 'origin',
      variants: buildAssetUrls(encodedKey, cloudflareImagePipeline),
    })
  } catch (error) {
    console.error('Import from URL error:', error)
    return NextResponse.json(
      { error: '远程图片导入失败: ' + (error as Error).message },
      { status: 500 }
    )
  }
}
