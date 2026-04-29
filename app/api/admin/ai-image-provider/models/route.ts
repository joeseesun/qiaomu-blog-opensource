import { NextRequest, NextResponse } from 'next/server'
import { authenticateRequest } from '@/lib/admin-auth'
import { getAppCloudflareEnv } from '@/lib/cloudflare'
import {
  ensureAiImageConfigInfrastructure,
  resolveAiImageProfileConfig,
} from '@/lib/ai-image-config'
import {
  AI_IMAGE_PROVIDER_MAP,
} from '@/lib/ai-image-provider-presets'
import { normalizeBaseUrl, resolveAiConfigSecret } from '@/lib/ai-provider-profiles'

type RawModelItem =
  | string
  | {
    id?: string
    name?: string
    model?: string
    slug?: string
  }

function buildProviderErrorMessage(resStatus: number, resStatusText: string, rawBody: string): string {
  try {
    if (rawBody) {
      const parsed = JSON.parse(rawBody) as {
        error?: { message?: string } | string
        message?: string
      }
      if (typeof parsed.error === 'object' && parsed.error?.message) {
        return parsed.error.message
      }
      if (typeof parsed.error === 'string' && parsed.error.trim()) {
        return parsed.error.trim()
      }
      if (typeof parsed.message === 'string' && parsed.message.trim()) {
        return parsed.message.trim()
      }
    }
  } catch {
    // noop
  }

  const fallbackRaw = rawBody.trim()
  if (fallbackRaw) return fallbackRaw.slice(0, 500)
  return `HTTP ${resStatus}: ${resStatusText}`
}

function extractModelItems(payload: unknown): RawModelItem[] {
  if (Array.isArray(payload)) return payload as RawModelItem[]
  if (!payload || typeof payload !== 'object') return []

  const candidate = payload as {
    data?: unknown
    models?: unknown
    items?: unknown
  }

  return [candidate.data, candidate.models, candidate.items]
    .flatMap((value) => (Array.isArray(value) ? value as RawModelItem[] : []))
}

function buildModels(items: RawModelItem[]) {
  const ids = new Set<string>()

  for (const item of items) {
    if (typeof item === 'string' && item.trim()) {
      ids.add(item.trim())
      continue
    }
    if (!item || typeof item !== 'object') continue
    const maybeId = (item.id || item.model || item.slug || item.name || '').trim()
    if (maybeId) ids.add(maybeId)
  }

  return Array.from(ids)
    .sort((a, b) => a.localeCompare(b, 'zh-CN'))
    .map((id) => ({ id, name: id }))
}

export async function GET(req: NextRequest) {
  const env = await getAppCloudflareEnv()
  const db = env?.DB as D1Database | undefined
  if (!(await authenticateRequest(req, db))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (!db) return NextResponse.json({ error: 'DB unavailable' }, { status: 500 })

  await ensureAiImageConfigInfrastructure(db)

  const requestUrl = new URL(req.url)
  const queryProvider = requestUrl.searchParams.get('provider')?.trim() || ''
  const queryBaseUrl = requestUrl.searchParams.get('base_url')?.trim() || ''
  const queryApiKey = requestUrl.searchParams.get('api_key')?.trim() || ''
  const queryProfileId = Number(requestUrl.searchParams.get('profile_id') || '')

  const secret = resolveAiConfigSecret(env as unknown as Record<string, unknown>)
  const rawSelectedProfile = Number.isFinite(queryProfileId) && queryProfileId > 0
    ? await db.prepare(`
      SELECT id, provider, base_url, api_key_encrypted
      FROM ai_image_provider_profiles
      WHERE id = ?
      LIMIT 1
    `).bind(queryProfileId).first<{
      id: number
      provider: string
      base_url: string
      api_key_encrypted: string
    }>()
    : null
  const selectedProfile = Number.isFinite(queryProfileId) && queryProfileId > 0
    ? await resolveAiImageProfileConfig(db, secret, queryProfileId)
    : null

  const provider = queryProvider || selectedProfile?.provider || rawSelectedProfile?.provider || 'custom'
  const fallbackPreset = AI_IMAGE_PROVIDER_MAP[provider]
  const fallbackModels = fallbackPreset?.quickModels || []
  const baseUrl = normalizeBaseUrl(queryBaseUrl || selectedProfile?.base_url || rawSelectedProfile?.base_url || '')
  const apiKey = queryApiKey || selectedProfile?.api_key || ''
  const storedKeyUnavailable = !queryApiKey
    && Boolean(rawSelectedProfile?.api_key_encrypted?.trim())
    && !selectedProfile?.api_key

  if (!baseUrl) {
    return NextResponse.json({ error: '缺少 base_url 参数' }, { status: 400 })
  }

  if (!apiKey) {
    const warning = storedKeyUnavailable
      ? '已保存 API Key 无法解密，请重新输入 API Key，或检查 AI_CONFIG_ENCRYPTION_SECRET / ADMIN_TOKEN_SALT 是否与保存时一致'
      : '未提供 API Key，返回预设模型列表'
    if (fallbackModels.length > 0) {
      return NextResponse.json({
        models: fallbackModels.map((id) => ({ id, name: id })),
        source: 'preset',
        warning,
      })
    }
    return NextResponse.json({ error: storedKeyUnavailable ? warning : '缺少 API Key' }, { status: 400 })
  }

  try {
    const res = await fetch(`${baseUrl}/models`, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      signal: AbortSignal.timeout(15000),
    })

    if (!res.ok) {
      const rawBody = await res.text().catch(() => '')
      const message = buildProviderErrorMessage(res.status, res.statusText, rawBody)
      if (fallbackModels.length > 0) {
        return NextResponse.json({
          models: fallbackModels.map((id) => ({ id, name: id })),
          source: 'preset',
          warning: `接口拉取失败，已回退预设：${message}`,
        })
      }
      return NextResponse.json({ error: `获取模型列表失败：${message}` }, { status: 502 })
    }

    const data = await res.json().catch(() => null)
    const models = buildModels(extractModelItems(data))

    if (models.length === 0 && fallbackModels.length > 0) {
      return NextResponse.json({
        models: fallbackModels.map((id) => ({ id, name: id })),
        source: 'preset',
        warning: '接口返回为空，已回退预设模型',
      })
    }

    return NextResponse.json({ models, source: 'provider' })
  } catch (error) {
    const message = error instanceof Error ? error.message : '获取模型列表失败'
    if (fallbackModels.length > 0) {
      return NextResponse.json({
        models: fallbackModels.map((id) => ({ id, name: id })),
        source: 'preset',
        warning: `网络异常，已回退预设：${message}`,
      })
    }
    return NextResponse.json({ error: message }, { status: 502 })
  }
}
