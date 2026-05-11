import { NextRequest, NextResponse } from 'next/server'
import { authenticateRequest } from '@/lib/admin-auth'
import { getAppCloudflareEnv } from '@/lib/cloudflare'
import { generateEditorImage } from '@/lib/ai-image'
import { ensureAiImageConfigInfrastructure } from '@/lib/ai-image-config'

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

export async function POST(req: NextRequest) {
  const env = await getAppCloudflareEnv()
  const db = env?.DB as D1Database | undefined
  const images = env?.IMAGES as ImageBucket | undefined

  if (!(await authenticateRequest(req, db))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (!db) {
    return NextResponse.json({ error: 'DB unavailable' }, { status: 500 })
  }
  if (!images) {
    return NextResponse.json({ error: '图片存储未配置' }, { status: 500 })
  }

  await ensureAiImageConfigInfrastructure(db)

  let body: {
    action?: string
    prompt?: string
    articleTitle?: string
    contextText?: string
    referenceImageUrl?: string
    inputFidelity?: 'high' | 'low'
    aspectRatio?: string
    resolution?: string
    profileId?: number | null
  }

  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: '请求体不是有效 JSON' }, { status: 400 })
  }

  const action = (body.action || '').trim()
  if (!action) {
    return NextResponse.json({ error: '缺少 action 参数' }, { status: 400 })
  }

  try {
    const normalizedReferenceImageUrl = typeof body.referenceImageUrl === 'string' && body.referenceImageUrl.trim()
      ? new URL(body.referenceImageUrl.trim(), req.nextUrl.origin).toString()
      : undefined

    const result = await generateEditorImage({
      action,
      userPrompt: body.prompt,
      articleTitle: body.articleTitle,
      contextText: body.contextText,
      referenceImageUrl: normalizedReferenceImageUrl,
      aspectRatio: body.aspectRatio,
      resolution: body.resolution,
      profileId: body.profileId,
      db,
      env: env as unknown as Record<string, string | undefined>,
      images,
    })

    return NextResponse.json({
      success: true,
      image: result,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : '图片生成失败'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
