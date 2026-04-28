import OpenAI from 'openai'
import type { ImagesResponse } from 'openai/resources/images'
import { nanoid } from 'nanoid'
import {
  ensureAiImageConfigInfrastructure,
  getDefaultImageActionSeed,
  resolveAiImageProfileConfig,
} from '@/lib/ai-image-config'
import {
  buildAspectRatioPromptHint,
  buildResolutionPromptHint,
  deriveLegacyQualityFromResolution,
  deriveLegacySizeFromAspectRatio,
  normalizeAiImageAspectRatio,
  normalizeAiImageResolution,
  type AIImageAspectRatio,
  type AIImageResolution,
} from '@/lib/ai-image-options'
import {
  buildWorkersAiRunUrl,
  isWorkersAiBaseUrl,
  normalizeBaseUrl,
  resolveAiConfigSecret,
} from '@/lib/ai-provider-profiles'

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
}

export interface AIImageEnv {
  AI_CONFIG_ENCRYPTION_SECRET?: string
  ADMIN_TOKEN_SALT?: string
  ENABLE_CF_IMAGE_PIPELINE?: string
}

interface GenerateEditorImageInput {
  action: string
  actionPrompt?: string
  actionLabel?: string
  userPrompt?: string
  articleTitle?: string
  contextText?: string
  referenceImageUrl?: string
  aspectRatio?: string
  resolution?: string
  profileId?: number | null
  db: D1Database
  env?: AIImageEnv
  images: ImageBucket
}

interface ResolvedImageAction {
  action_key: string
  label: string
  prompt: string
  aspect_ratio: AIImageAspectRatio
  resolution: AIImageResolution
  size: string
  quality: string
  profile_id: number | null
}

export interface GeneratedEditorImage {
  key: string
  url: string
  variants: {
    raw: string
    content: string
    thumb: string
    cover: string
  }
  prompt: string
  revisedPrompt: string
  alt: string
  actionLabel: string
  aspectRatio: AIImageAspectRatio
  resolution: AIImageResolution
  size: string
  profileName: string
  model: string
}

function readFlag(value: unknown): boolean {
  return typeof value === 'string' && ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase())
}

function sanitizeFilename(filename: string) {
  const trimmed = filename.trim().toLowerCase()
  const safe = trimmed.replace(/[^a-z0-9._-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')
  return safe || 'image'
}

function inferExtensionFromContentType(contentType: string | null) {
  const normalized = (contentType || '').toLowerCase()
  if (normalized.includes('png')) return 'png'
  if (normalized.includes('jpeg') || normalized.includes('jpg')) return 'jpg'
  if (normalized.includes('webp')) return 'webp'
  return 'png'
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

function getNowPrefix() {
  const now = new Date()
  const yyyy = now.getUTCFullYear()
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0')
  return { yyyy, mm }
}

function toBytesFromBase64(input: string): Uint8Array {
  const normalized = input.trim()
  if (!normalized) return new Uint8Array()

  const BufferCtor = (globalThis as unknown as {
    Buffer?: {
      from: (input: string, encoding: string) => Uint8Array
    }
  }).Buffer

  if (BufferCtor) {
    return new Uint8Array(BufferCtor.from(normalized, 'base64'))
  }

  const binary = atob(normalized)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

function buildContextText(articleTitle?: string, contextText?: string) {
  const sections: string[] = []
  const normalizedTitle = (articleTitle || '').trim()
  const normalizedContext = (contextText || '').trim()

  if (normalizedTitle) sections.push(`文章标题：${normalizedTitle}`)
  if (normalizedContext) sections.push(`当前位置上下文：${normalizedContext.slice(0, 500)}`)

  return sections.join('\n')
}

function buildUserFacingPrompt(userPrompt?: string, articleTitle?: string, contextText?: string) {
  const normalizedPrompt = (userPrompt || '').trim()
  if (normalizedPrompt) return normalizedPrompt
  return buildContextText(articleTitle, contextText)
}

function buildFinalImagePrompt(
  actionPrompt: string | undefined,
  userPrompt?: string,
  articleTitle?: string,
  contextText?: string,
  aspectRatio?: string,
  resolution?: string,
) {
  const contentPrompt = buildUserFacingPrompt(userPrompt, articleTitle, contextText)
  if (!contentPrompt) {
    throw new Error('请输入图片主题，或在正文中提供足够的上下文')
  }

  const sections = []
  if (actionPrompt?.trim()) sections.push(actionPrompt.trim())
  sections.push(`主题与内容：\n${contentPrompt}`)

  const context = buildContextText(articleTitle, contextText)
  if (context && context !== contentPrompt) {
    sections.push(`补充上下文（仅用于理解主题，不要把这些文字直接渲染进图片，除非用户明确要求）：\n${context}`)
  }

  const aspectRatioHint = buildAspectRatioPromptHint(aspectRatio)
  if (aspectRatioHint) {
    sections.push(`构图比例要求：\n${aspectRatioHint}`)
  }

  const resolutionHint = buildResolutionPromptHint(resolution)
  if (resolutionHint) {
    sections.push(`输出精度偏好：\n${resolutionHint}`)
  }

  sections.push('输出要求：构图完整、主题清晰、适合中文文章配图。除非用户明确要求，不要在图片中加入可读文字、logo、签名或水印；如果当前模型不支持精确比例或分辨率，请优先遵守构图比例意图与细节等级。')
  return sections.join('\n\n')
}

function buildAltText(
  revisedPrompt: string,
  userPrompt?: string,
  articleTitle?: string,
  fallbackLabel?: string,
) {
  const candidate = revisedPrompt.trim() || (userPrompt || '').trim() || (articleTitle || '').trim() || fallbackLabel || 'AI 生成配图'
  return candidate.slice(0, 120)
}

function resolveRequestedSize(
  aspectRatio?: string,
  legacySize?: string,
) {
  return deriveLegacySizeFromAspectRatio(aspectRatio, legacySize)
}

function resolveRequestedQuality(
  resolution?: string,
  legacyQuality?: string,
) {
  return deriveLegacyQualityFromResolution(resolution, legacyQuality)
}

function parseWorkersAiErrorMessage(
  resStatus: number,
  resStatusText: string,
  rawBody: string,
) {
  try {
    if (rawBody) {
      const parsed = JSON.parse(rawBody) as {
        errors?: Array<{ message?: string }>
        error?: { message?: string } | string
        message?: string
      }

      const firstWorkersError = parsed.errors?.find((item) => typeof item?.message === 'string' && item.message.trim())
      if (firstWorkersError?.message) {
        return firstWorkersError.message.trim()
      }

      if (typeof parsed.error === 'object' && parsed.error?.message) {
        return parsed.error.message.trim()
      }

      if (typeof parsed.error === 'string' && parsed.error.trim()) {
        return parsed.error.trim()
      }

      if (typeof parsed.message === 'string' && parsed.message.trim()) {
        return parsed.message.trim()
      }
    }
  } catch {
    // ignore parse error
  }

  const fallbackRaw = rawBody.trim()
  if (fallbackRaw) return fallbackRaw.slice(0, 500)
  return `HTTP ${resStatus}: ${resStatusText}`
}

export function resolveWorkersAiImageSize(
  aspectRatio: AIImageAspectRatio,
  resolution: AIImageResolution,
) {
  const sizeTier = resolution === '4k' ? 1536 : resolution === '2k' ? 1344 : 1024
  const normalizedAspectRatio = normalizeAiImageAspectRatio(aspectRatio)
  const [ratioWidth, ratioHeight] = (normalizedAspectRatio === 'auto' ? '16:9' : normalizedAspectRatio)
    .split(':')
    .map((item) => Number(item))

  if (!Number.isFinite(ratioWidth) || !Number.isFinite(ratioHeight) || ratioWidth <= 0 || ratioHeight <= 0) {
    return { width: sizeTier, height: Math.round(sizeTier * 9 / 16) }
  }

  if (ratioWidth >= ratioHeight) {
    return {
      width: sizeTier,
      height: Math.max(512, Math.round(sizeTier * ratioHeight / ratioWidth)),
    }
  }

  return {
    width: Math.max(512, Math.round(sizeTier * ratioWidth / ratioHeight)),
    height: sizeTier,
  }
}

async function resolveImageAction(
  db: D1Database,
  action: string,
): Promise<ResolvedImageAction | null> {
  if (action === 'custom') return null

  const row = await db.prepare(`
    SELECT action_key, label, prompt, aspect_ratio, resolution, size, quality, profile_id
    FROM ai_image_actions
    WHERE action_key = ? AND is_enabled = 1
  `).bind(action).first<ResolvedImageAction>()

  if (!row) {
    throw new Error('不支持的图片快捷提示')
  }

  return row
}

async function runGenerateWithFallback(
  client: OpenAI,
  config: {
    apiKey: string
    baseURL: string
    providerType?: string
  },
  params: {
    model: string
    prompt: string
    size: string
    quality: string
  },
): Promise<ImagesResponse> {
  const attempts: Array<Record<string, unknown>> = [
    {
      model: params.model,
      prompt: params.prompt,
      n: 1,
      size: params.size,
      quality: params.quality,
      output_format: 'webp',
      background: 'auto',
    },
    {
      model: params.model,
      prompt: params.prompt,
      n: 1,
      size: params.size,
      quality: params.quality,
    },
    {
      model: params.model,
      prompt: params.prompt,
      n: 1,
      size: params.size,
    },
    {
      model: params.model,
      prompt: params.prompt,
      n: 1,
    },
  ]

  let lastError: Error | null = null

  for (const body of attempts) {
    try {
      return await client.images.generate(body as never) as ImagesResponse
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error))
    }
  }

  if (shouldRetryWithMultipartFallback(lastError, config.providerType)) {
    return runGenerateMultipartFallback(config, params, lastError)
  }

  throw lastError || new Error('图片生成失败')
}

async function runEditWithFallback(
  client: OpenAI,
  params: {
    image: File | Array<File>
    inputFidelity?: 'high' | 'low'
    model: string
    prompt: string
    quality: string
    size: string
  },
) {
  const attempts: Array<Record<string, unknown>> = [
    {
      model: params.model,
      prompt: params.prompt,
      image: params.image,
      size: params.size,
      quality: params.quality,
      input_fidelity: params.inputFidelity ?? 'high',
      output_format: 'webp',
      background: 'auto',
    },
    {
      model: params.model,
      prompt: params.prompt,
      image: params.image,
      size: params.size,
      quality: params.quality,
      output_format: 'webp',
      background: 'auto',
    },
    {
      model: params.model,
      prompt: params.prompt,
      image: params.image,
      size: params.size,
      quality: params.quality,
    },
    {
      model: params.model,
      prompt: params.prompt,
      image: params.image,
      size: params.size,
    },
    {
      model: params.model,
      prompt: params.prompt,
      image: params.image,
    },
  ]

  let lastError: Error | null = null

  for (const body of attempts) {
    try {
      return await client.images.edit(body as never) as ImagesResponse
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error))
    }
  }

  throw lastError || new Error('参考图生成失败')
}

function parseOpenAiCompatImageErrorMessage(
  resStatus: number,
  resStatusText: string,
  rawBody: string,
) {
  try {
    if (rawBody) {
      const parsed = JSON.parse(rawBody) as {
        errors?: Array<{ message?: string }>
        error?: { message?: string } | string
        message?: string
      }

      const firstError = parsed.errors?.find((item) => typeof item?.message === 'string' && item.message.trim())
      if (firstError?.message) {
        return firstError.message.trim()
      }

      if (typeof parsed.error === 'object' && parsed.error?.message) {
        return parsed.error.message.trim()
      }

      if (typeof parsed.error === 'string' && parsed.error.trim()) {
        return parsed.error.trim()
      }

      if (typeof parsed.message === 'string' && parsed.message.trim()) {
        return parsed.message.trim()
      }
    }
  } catch {
    // ignore parse error
  }

  const fallbackRaw = rawBody.trim()
  if (fallbackRaw) return fallbackRaw.slice(0, 500)
  return `HTTP ${resStatus}: ${resStatusText}`
}

function shouldRetryWithMultipartFallback(error: Error | null, providerType?: string) {
  if ((providerType || '').trim() === 'openai_images') return true
  if (!error) return false

  const normalized = error.message.toLowerCase()
  return normalized.includes('multipart')
    || normalized.includes('form-data')
    || normalized.includes("required properties at '/' are 'multipart'")
}

async function runGenerateMultipartFallback(
  config: {
    apiKey: string
    baseURL: string
  },
  params: {
    model: string
    prompt: string
    size: string
    quality: string
  },
  previousError: Error | null,
) {
  const endpoint = `${normalizeBaseUrl(config.baseURL)}/images/generations`
  const attempts: Array<Record<string, string>> = [
    {
      model: params.model,
      prompt: params.prompt,
      n: '1',
      size: params.size,
      quality: params.quality,
      response_format: 'b64_json',
      output_format: 'webp',
      background: 'auto',
    },
    {
      model: params.model,
      prompt: params.prompt,
      n: '1',
      size: params.size,
      quality: params.quality,
      response_format: 'b64_json',
    },
    {
      model: params.model,
      prompt: params.prompt,
      n: '1',
      size: params.size,
      quality: params.quality,
    },
    {
      model: params.model,
      prompt: params.prompt,
      n: '1',
      size: params.size,
    },
    {
      model: params.model,
      prompt: params.prompt,
      n: '1',
    },
  ]

  let lastError = previousError

  for (const fields of attempts) {
    const formData = new FormData()
    for (const [key, value] of Object.entries(fields)) {
      if (value.trim()) {
        formData.append(key, value)
      }
    }

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
        },
        body: formData,
        signal: AbortSignal.timeout(120000),
      })

      const rawBody = await response.text().catch(() => '')
      if (!response.ok) {
        throw new Error(parseOpenAiCompatImageErrorMessage(response.status, response.statusText, rawBody))
      }

      const parsed = rawBody ? JSON.parse(rawBody) : null
      if (!parsed || !Array.isArray(parsed.data) || parsed.data.length === 0) {
        throw new Error('图片接口未返回结果')
      }

      return parsed as ImagesResponse
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error))
    }
  }

  throw lastError || new Error('图片生成失败')
}

async function extractGeneratedImagePayload(
  response: ImagesResponse,
): Promise<{
  bytes: Uint8Array
  contentType: string
  extension: string
  revisedPrompt: string
}> {
  const payload = response.data?.[0]
  if (!payload) {
    throw new Error('图片接口未返回结果')
  }

  if (payload.b64_json) {
    const bytes = toBytesFromBase64(payload.b64_json)
    if (bytes.length === 0) {
      throw new Error('图片数据为空')
    }
    return {
      bytes,
      contentType: 'image/webp',
      extension: 'webp',
      revisedPrompt: (payload.revised_prompt || '').trim(),
    }
  }

  if (payload.url) {
    const res = await fetch(payload.url, { signal: AbortSignal.timeout(30000) })
    if (!res.ok) {
      throw new Error(`拉取生成图片失败：HTTP ${res.status}`)
    }
    const bytes = new Uint8Array(await res.arrayBuffer())
    const contentType = res.headers.get('content-type') || 'image/png'
    const extension = contentType.includes('webp')
      ? 'webp'
      : contentType.includes('jpeg')
        ? 'jpg'
        : 'png'

    return {
      bytes,
      contentType,
      extension,
      revisedPrompt: (payload.revised_prompt || '').trim(),
    }
  }

  throw new Error('图片接口未返回可用内容')
}

function inferImageTypeFromBytes(bytes: Uint8Array) {
  const isPng = bytes.length >= 4
    && bytes[0] === 0x89
    && bytes[1] === 0x50
    && bytes[2] === 0x4e
    && bytes[3] === 0x47

  if (isPng) {
    return { contentType: 'image/png', extension: 'png' }
  }

  const isJpeg = bytes.length >= 3
    && bytes[0] === 0xff
    && bytes[1] === 0xd8
    && bytes[2] === 0xff

  if (isJpeg) {
    return { contentType: 'image/jpeg', extension: 'jpg' }
  }

  const isWebp = bytes.length >= 12
    && bytes[0] === 0x52
    && bytes[1] === 0x49
    && bytes[2] === 0x46
    && bytes[3] === 0x46
    && bytes[8] === 0x57
    && bytes[9] === 0x45
    && bytes[10] === 0x42
    && bytes[11] === 0x50

  if (isWebp) {
    return { contentType: 'image/webp', extension: 'webp' }
  }

  return { contentType: 'image/png', extension: 'png' }
}

function getDefaultWorkersImageType(model: string) {
  if (/phoenix/i.test(model)) {
    return { contentType: 'image/jpeg', extension: 'jpg' }
  }
  return { contentType: 'image/png', extension: 'png' }
}

function isReadableStreamLike(value: unknown): value is ReadableStream {
  return Boolean(value && typeof value === 'object' && 'getReader' in value)
}

export async function extractWorkersAiImageAsset(result: unknown, model: string): Promise<{
  data: ReadableStream | Uint8Array
  contentType: string
  extension: string
}> {
  if (result instanceof Response) {
    if (!result.body) throw new Error('Workers AI 未返回图片内容')
    const contentType = result.headers.get('content-type') || getDefaultWorkersImageType(model).contentType
    const extension = contentType.includes('jpeg')
      ? 'jpg'
      : contentType.includes('webp')
        ? 'webp'
        : 'png'

    return {
      data: result.body,
      contentType,
      extension,
    }
  }

  if (isReadableStreamLike(result)) {
    const fallbackType = getDefaultWorkersImageType(model)
    return {
      data: result,
      contentType: fallbackType.contentType,
      extension: fallbackType.extension,
    }
  }

  if (result instanceof ArrayBuffer) {
    const bytes = new Uint8Array(result)
    const inferred = inferImageTypeFromBytes(bytes)
    return { data: bytes, ...inferred }
  }

  if (ArrayBuffer.isView(result)) {
    const bytes = new Uint8Array(result.buffer.slice(result.byteOffset, result.byteOffset + result.byteLength))
    const inferred = inferImageTypeFromBytes(bytes)
    return { data: bytes, ...inferred }
  }

  const payload = result && typeof result === 'object'
    ? result as {
        image?: string
        result?: {
          image?: string
          url?: string
        }
        url?: string
      }
    : null

  const base64Image = payload?.image || payload?.result?.image || ''
  if (base64Image) {
    const bytes = toBytesFromBase64(base64Image)
    const inferred = inferImageTypeFromBytes(bytes)
    return { data: bytes, ...inferred }
  }

  const remoteUrl = payload?.url || payload?.result?.url || ''
  if (remoteUrl) {
    const response = await fetch(remoteUrl, { signal: AbortSignal.timeout(30000) })
    if (!response.ok) {
      throw new Error(`拉取 Workers AI 图片失败：HTTP ${response.status}`)
    }
    const bytes = new Uint8Array(await response.arrayBuffer())
    const contentType = response.headers.get('content-type') || getDefaultWorkersImageType(model).contentType
    const extension = contentType.includes('jpeg')
      ? 'jpg'
      : contentType.includes('webp')
        ? 'webp'
        : 'png'

    return {
      data: bytes,
      contentType,
      extension,
    }
  }

  throw new Error('Workers AI 图片模型未返回可用内容')
}

async function toUint8Array(input: ReadableStream | Uint8Array) {
  if (input instanceof Uint8Array) return input
  return new Uint8Array(await new Response(input).arrayBuffer())
}

async function fetchReferenceImageFile(referenceImageUrl: string) {
  const response = await fetch(referenceImageUrl, {
    signal: AbortSignal.timeout(30000),
  })

  if (!response.ok) {
    throw new Error('参考图读取失败')
  }

  const blob = await response.blob()
  const urlFileName = referenceImageUrl.split('/').pop()?.split('?')[0]?.split('#')[0] || 'reference-image'
  const extension = inferExtensionFromContentType(blob.type)
  const baseName = sanitizeFilename(urlFileName.replace(/\.[^.]+$/, '') || 'reference-image')

  return new File([blob], `${baseName}.${extension}`, {
    type: blob.type || `image/${extension}`,
    lastModified: Date.now(),
  })
}

function shouldRetryWorkersAiMultipart(error: Error | null, model: string) {
  const normalizedModel = model.trim().toLowerCase()
  if (normalizedModel.includes('flux-2-dev')) return true
  if (!error) return false

  const message = error.message.toLowerCase()
  return message.includes('multipart')
    || message.includes('form-data')
    || message.includes("required properties at '/' are 'multipart'")
}

async function parseWorkersAiRunResponse(response: Response) {
  const contentType = (response.headers.get('content-type') || '').toLowerCase()

  if (contentType.startsWith('image/')) {
    return response
  }

  const rawBody = await response.text().catch(() => '')
  if (!response.ok) {
    throw new Error(parseWorkersAiErrorMessage(response.status, response.statusText, rawBody))
  }

  try {
    return rawBody ? JSON.parse(rawBody) : null
  } catch {
    throw new Error('Workers AI 图片接口返回了无法解析的内容')
  }
}

export async function runWorkersAiCompatImageRequest(
  config: {
    apiKey: string
    baseURL: string
    model: string
  },
  input: {
    prompt: string
    width: number
    height: number
  },
) {
  const endpoint = buildWorkersAiRunUrl(config.baseURL, config.model)
  let lastError: Error | null = null

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        prompt: input.prompt,
        width: input.width,
        height: input.height,
      }),
      signal: AbortSignal.timeout(120000),
    })

    return await parseWorkersAiRunResponse(response)
  } catch (error) {
    lastError = error instanceof Error ? error : new Error(String(error))
  }

  if (!shouldRetryWorkersAiMultipart(lastError, config.model)) {
    throw lastError || new Error('Workers AI 图片接口请求失败')
  }

  const formData = new FormData()
  formData.append('prompt', input.prompt)
  formData.append('width', String(input.width))
  formData.append('height', String(input.height))

  const multipartResponse = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: formData,
    signal: AbortSignal.timeout(120000),
  })

  return parseWorkersAiRunResponse(multipartResponse)
}

export async function generateEditorImage(
  input: GenerateEditorImageInput,
): Promise<GeneratedEditorImage> {
  await ensureAiImageConfigInfrastructure(input.db)

  const secret = resolveAiConfigSecret(input.env as unknown as Record<string, unknown> | undefined)
  const action = await resolveImageAction(input.db, input.action)
  const seeded = getDefaultImageActionSeed(action?.action_key)
  const requestedAspectRatio = normalizeAiImageAspectRatio(
    input.aspectRatio || action?.aspect_ratio || seeded?.aspect_ratio,
  )
  const requestedResolution = normalizeAiImageResolution(
    input.resolution || action?.resolution || seeded?.resolution,
  )
  const selectedProfileId = Number.isFinite(input.profileId) && Number(input.profileId) > 0
    ? Number(input.profileId)
    : action?.profile_id ?? undefined
  const profile = await resolveAiImageProfileConfig(input.db, secret, selectedProfileId)

  if (!profile) {
    throw new Error('请先在后台配置图片模型')
  }

  const finalPrompt = buildFinalImagePrompt(
    input.actionPrompt || action?.prompt,
    input.userPrompt,
    input.articleTitle,
    input.contextText,
    requestedAspectRatio,
    requestedResolution,
  )
  const hasReferenceImage = typeof input.referenceImageUrl === 'string' && input.referenceImageUrl.trim().length > 0

  const imagePayload = profile.provider === 'workers_ai' || isWorkersAiBaseUrl(profile.base_url)
    ? await (async () => {
        if (hasReferenceImage) {
          throw new Error('当前图片模型通道暂不支持参考图生成，请切换到 OpenAI 兼容图片模型')
        }

        const { width, height } = resolveWorkersAiImageSize(requestedAspectRatio, requestedResolution)
        const rawResult = await runWorkersAiCompatImageRequest(
          {
            apiKey: profile.api_key,
            baseURL: profile.base_url,
            model: profile.model,
          },
          {
            prompt: finalPrompt,
            width,
            height,
          },
        )
        const asset = await extractWorkersAiImageAsset(rawResult, profile.model)
        return {
          bytes: await toUint8Array(asset.data),
          contentType: asset.contentType,
          extension: asset.extension,
          revisedPrompt: finalPrompt,
        }
      })()
    : await (async () => {
        const client = new OpenAI({
          apiKey: profile.api_key,
          baseURL: normalizeBaseUrl(profile.base_url),
        })

        const size = resolveRequestedSize(requestedAspectRatio, action?.size || seeded?.size)
        const quality = resolveRequestedQuality(requestedResolution, action?.quality || seeded?.quality)

        const response = hasReferenceImage
          ? await runEditWithFallback(
              client,
              {
                image: await fetchReferenceImageFile(String(input.referenceImageUrl).trim()),
                inputFidelity: 'high',
                model: profile.model,
                prompt: finalPrompt,
                size,
                quality,
              },
            )
          : await runGenerateWithFallback(
              client,
              {
                apiKey: profile.api_key,
                baseURL: profile.base_url,
                providerType: profile.provider_type,
              },
              {
                model: profile.model,
                prompt: finalPrompt,
                size,
                quality,
              },
            )

        return extractGeneratedImagePayload(response)
      })()
  const alt = buildAltText(
    imagePayload.revisedPrompt,
    input.userPrompt,
    input.articleTitle,
    input.actionLabel || action?.label || '自定义生成',
  )

  const { yyyy, mm } = getNowPrefix()
  const baseName = sanitizeFilename(alt).slice(0, 48)
  const key = `image/${yyyy}/${mm}/ai-${nanoid(10)}-${baseName}.${imagePayload.extension}`

  await input.images.put(key, imagePayload.bytes, {
    httpMetadata: {
      contentType: imagePayload.contentType,
      cacheControl: 'public, max-age=31536000, immutable',
    },
    customMetadata: {
      originalName: `${baseName}.${imagePayload.extension}`,
      source: 'ai-image',
    },
  })

  const encodedKey = key.split('/').map(encodeURIComponent).join('/')
  const variants = buildAssetUrls(encodedKey, readFlag(input.env?.ENABLE_CF_IMAGE_PIPELINE))

  return {
    key,
    url: `/api/images/${encodedKey}`,
    variants,
    prompt: finalPrompt,
    revisedPrompt: imagePayload.revisedPrompt,
    alt,
    actionLabel: input.actionLabel || action?.label || '自定义生成',
    aspectRatio: requestedAspectRatio,
    resolution: requestedResolution,
    size: resolveRequestedSize(requestedAspectRatio, action?.size || seeded?.size),
    profileName: profile.name,
    model: profile.model,
  }
}
