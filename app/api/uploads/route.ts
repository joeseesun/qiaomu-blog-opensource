import { NextRequest, NextResponse } from 'next/server'
import { getAppCloudflareEnv } from '@/lib/cloudflare'
import { authenticateRequest } from '@/lib/admin-auth'
import { nanoid } from 'nanoid'
import { corsPreflight, isTrustedWriteOrigin, withCors } from '@/lib/server/cors'
import { linkMediaAssetToArticle, upsertMediaAsset, type MediaAssetSource } from '@/lib/repositories/media-assets'

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

const MAX_FILE_SIZE = 100 * 1024 * 1024 // 100MB (Cloudflare Workers limit)

const ALLOWED_TYPES: Record<string, string[]> = {
  image: ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml', 'image/avif'],
  audio: ['audio/mpeg', 'audio/wav', 'audio/ogg', 'audio/aac', 'audio/flac', 'audio/mp4'],
  video: ['video/mp4', 'video/webm', 'video/ogg', 'video/quicktime'],
  document: [
    'application/pdf',
    'application/zip', 'application/x-zip-compressed',
    'application/x-rar-compressed', 'application/x-rar',
    'application/x-7z-compressed',
    'application/epub+zip',
    'application/x-mobipocket-ebook',
    'application/vnd.amazon.ebook',
    'text/plain',
    'application/octet-stream',
  ],
}

const ALL_ALLOWED = Object.values(ALLOWED_TYPES).flat()

function readFlag(value: unknown): boolean {
  return typeof value === 'string' && ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase())
}

function getFileCategory(mimeType: string): string {
  for (const [cat, types] of Object.entries(ALLOWED_TYPES)) {
    if (types.includes(mimeType)) return cat
  }
  return 'document'
}

function sanitizeFilename(filename: string) {
  const trimmed = filename.trim().toLowerCase()
  const safe = trimmed.replace(/[^a-z0-9._-]+/g, '-').replace(/-+/g, '-')
  return safe || 'file'
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

function parsePositiveInteger(value: unknown) {
  const parsed = typeof value === 'number'
    ? value
    : typeof value === 'string'
      ? Number.parseInt(value, 10)
      : Number.NaN
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null
}

function normalizeUploadSource(value: FormDataEntryValue | null): MediaAssetSource {
  if (value === 'collage') return 'collage'
  if (value === 'cover_generator') return 'cover_generator'
  if (value === 'unsplash') return 'unsplash'
  return 'upload'
}

async function recordImageAsset(options: {
  db?: D1Database
  source: MediaAssetSource
  key: string
  encodedKey: string
  variants?: Record<string, string>
  mimeType: string | null
  sizeBytes: number
  alt: string
  postId: number | null
  slug: string
  role: 'inline' | 'cover'
}) {
  if (!options.db) return undefined

  try {
    const asset = await upsertMediaAsset(options.db, {
      source: options.source,
      r2Key: options.key,
      url: `/api/images/${options.encodedKey}`,
      variants: options.variants,
      mimeType: options.mimeType,
      sizeBytes: options.sizeBytes,
      alt: options.alt,
    })
    await linkMediaAssetToArticle(options.db, {
      assetId: asset.id,
      postId: options.postId,
      slug: options.slug,
      role: options.role,
    })
    return asset.id
  } catch (error) {
    console.warn('Media asset indexing failed:', error)
    return undefined
  }
}

async function calculateHash(file: File): Promise<string> {
  const buffer = await file.arrayBuffer()
  const hashBuffer = await crypto.subtle.digest('SHA-256', buffer)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 16)
}

async function handleUpload(req: NextRequest) {
  try {
    // 认证：Cookie OR Bearer Token
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

    const formData = await req.formData()
    const file = formData.get('file')
    const postId = parsePositiveInteger(formData.get('postId'))
    const slug = typeof formData.get('slug') === 'string' ? String(formData.get('slug')).trim() : ''
    const role = formData.get('role') === 'cover' ? 'cover' : 'inline'
    const source = normalizeUploadSource(formData.get('source'))

    if (!(file instanceof File)) {
      return NextResponse.json({ error: '缺少文件' }, { status: 400 })
    }

    // Check allowed file types (allow unknown types with common extensions)
    const ext = file.name.split('.').pop()?.toLowerCase() || ''
    const knownExts = ['zip', 'rar', '7z', 'epub', 'mobi', 'azw', 'azw3', 'pdf', 'txt', 'mp3', 'mp4', 'wav', 'ogg', 'webm', 'mov', 'flac', 'aac']
    if (!ALL_ALLOWED.includes(file.type) && !file.type.startsWith('image/') && !knownExts.includes(ext)) {
      return NextResponse.json({ error: `不支持的文件类型: ${file.type}` }, { status: 400 })
    }

    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: '文件不能超过 100MB' },
        { status: 400 }
      )
    }

    const category = getFileCategory(file.type)
    const now = new Date()
    const yyyy = now.getUTCFullYear()
    const mm = String(now.getUTCMonth() + 1).padStart(2, '0')

    // 小文件（<5MB）做 hash 去重；大文件跳过（hash 在 Workers 上太慢）
    const HASH_THRESHOLD = 5 * 1024 * 1024
    let key: string
    const cloudflareImagePipeline = category === 'image' && readFlag(env.ENABLE_CF_IMAGE_PIPELINE)

    if (file.size <= HASH_THRESHOLD) {
      const fileHash = await calculateHash(file)
      const dedupKey = `${category}/${yyyy}/${mm}/${fileHash}-${sanitizeFilename(file.name)}`

      const existing = await env.IMAGES.get(dedupKey)
      if (existing) {
        const encodedKey = dedupKey.split('/').map(encodeURIComponent).join('/')
        const variants = category === 'image' ? buildAssetUrls(encodedKey, cloudflareImagePipeline) : undefined
        const assetId = category === 'image'
          ? await recordImageAsset({
            db: env.DB,
            source,
            key: dedupKey,
            encodedKey,
            variants,
            mimeType: file.type || null,
            sizeBytes: file.size,
            alt: file.name,
            postId,
            slug,
            role,
          })
          : undefined
        return NextResponse.json({
          success: true,
          key: dedupKey,
          url: `/api/images/${encodedKey}`,
          type: category,
          name: file.name,
          size: file.size,
          deduplicated: true,
          delivery: cloudflareImagePipeline ? 'cloudflare' : 'origin',
          variants,
          assetId,
        })
      }
      key = dedupKey
    } else {
      // 大文件：nanoid key，不做 hash 去重
      key = `${category}/${yyyy}/${mm}/${nanoid(10)}-${sanitizeFilename(file.name)}`
    }

    // 确保文件使用正确的 MIME 类型
    let contentType = file.type
    if (!contentType || contentType === 'application/octet-stream') {
      const ext = file.name.split('.').pop()?.toLowerCase()
      if (ext === 'mov') contentType = 'video/quicktime'
      else if (ext === 'mp4') contentType = 'video/mp4'
      else if (ext === 'webm') contentType = 'video/webm'
      else if (ext === 'mp3') contentType = 'audio/mpeg'
      else if (ext === 'wav') contentType = 'audio/wav'
      else if (ext === 'pdf') contentType = 'application/pdf'
      else if (ext === 'zip') contentType = 'application/zip'
      else if (ext === 'rar') contentType = 'application/x-rar-compressed'
      else if (ext === '7z') contentType = 'application/x-7z-compressed'
      else if (ext === 'epub') contentType = 'application/epub+zip'
      else if (ext === 'mobi') contentType = 'application/x-mobipocket-ebook'
      else if (ext === 'azw' || ext === 'azw3') contentType = 'application/vnd.amazon.ebook'
      else if (ext === 'txt') contentType = 'text/plain'
    }

    await env.IMAGES.put(key, file, {
      httpMetadata: {
        contentType,
        cacheControl: 'public, max-age=31536000, immutable',
      },
      customMetadata: {
        originalName: file.name,
      },
    })

    const encodedKey = key.split('/').map(encodeURIComponent).join('/')
    const variants = category === 'image' ? buildAssetUrls(encodedKey, cloudflareImagePipeline) : undefined
    let assetId: number | undefined

    if (category === 'image' && env.DB) {
      assetId = await recordImageAsset({
        db: env.DB,
        source,
        key,
        encodedKey,
        variants,
        mimeType: contentType || null,
        sizeBytes: file.size,
        alt: file.name,
        postId,
        slug,
        role,
      })
    }

    return NextResponse.json({
      success: true,
      key,
      url: `/api/images/${encodedKey}`,
      type: category,
      name: file.name,
      size: file.size,
      delivery: cloudflareImagePipeline ? 'cloudflare' : 'origin',
      variants,
      assetId,
    })
  } catch (error) {
    console.error('Upload error:', error)
    return NextResponse.json(
      { error: '文件上传失败: ' + (error as Error).message },
      { status: 500 }
    )
  }
}

// www.qiaomu.ai/notes/ uploads memo media here with the admin cookie.
export function OPTIONS(req: NextRequest) {
  return corsPreflight(req, 'POST, OPTIONS')
}

export async function POST(req: NextRequest) {
  if (!isTrustedWriteOrigin(req)) {
    return withCors(req, NextResponse.json({ error: 'Forbidden origin' }, { status: 403 }))
  }
  return withCors(req, await handleUpload(req))
}
