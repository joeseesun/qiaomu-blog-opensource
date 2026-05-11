import { NextRequest, NextResponse } from 'next/server'
import { authenticateRequest } from '@/lib/admin-auth'
import { getAppCloudflareEnv } from '@/lib/cloudflare'
import {
  decryptApiKey,
  ensureAiConfigInfrastructure,
  normalizeBaseUrl,
  resolveAiConfigSecret,
} from '@/lib/ai-provider-profiles'
import { AI_PROVIDER_MAP } from '@/lib/ai-provider-presets'
import {
  buildWorkersAiModelOptions,
  extractCloudflareAccountId,
  fetchWorkersAiModels,
  type RawWorkersAiModelItem,
} from '@/lib/workers-ai-models'

type RawModelItem = RawWorkersAiModelItem

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
    // ignore parse error
  }

  const fallbackRaw = rawBody.trim()
  if (fallbackRaw) return fallbackRaw.slice(0, 500)
  return `HTTP ${resStatus}: ${resStatusText}`
}

function isSiliconFlowProvider(provider: string, baseUrl: string) {
  return provider === 'siliconflow' || /siliconflow\.(cn|com)/i.test(baseUrl)
}

function isWorkersAiProvider(provider: string, baseUrl: string) {
  return provider === 'workers_ai' || /api\.cloudflare\.com\/client\/v4\/accounts\/[^/]+\/ai\//i.test(baseUrl)
}

function extractModelItems(payload: unknown): RawModelItem[] {
  if (Array.isArray(payload)) return payload as RawModelItem[]
  if (!payload || typeof payload !== 'object') return []

  const candidate = payload as {
    data?: unknown
    models?: unknown
    items?: unknown
    result?: {
      result?: unknown
      data?: unknown
      models?: unknown
      items?: unknown
    }
  }

  const arrays = [
    candidate.data,
    candidate.models,
    candidate.items,
    candidate.result,
    candidate.result?.data,
    candidate.result?.models,
    candidate.result?.items,
  ]

  return arrays.flatMap((value) => (Array.isArray(value) ? value as RawModelItem[] : []))
}

function filterCompatibleModels(items: RawModelItem[], provider: string, baseUrl: string) {
  if (!isSiliconFlowProvider(provider, baseUrl)) return items

  const filtered = items.filter((item) => {
    if (typeof item === 'string') return true

    const subType = `${item.sub_type || item.subType || ''}`.toLowerCase()
    const type = `${item.type || item.category || ''}`.toLowerCase()

    if (subType) return /(chat|text|language|llm)/.test(subType)
    if (type) return /(text|language|llm)/.test(type)
    return true
  })

  return filtered.length > 0 ? filtered : items
}

export async function GET(req: NextRequest) {
  const env = await getAppCloudflareEnv()
  const db = env?.DB as D1Database | undefined
  if (!(await authenticateRequest(req, db))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (!db) return NextResponse.json({ error: 'DB unavailable' }, { status: 500 })

  const secret = resolveAiConfigSecret(env as unknown as Record<string, unknown>)
  await ensureAiConfigInfrastructure(db, secret)

  const requestUrl = new URL(req.url)
  const queryProvider = requestUrl.searchParams.get('provider')?.trim() || ''
  const queryBaseUrl = requestUrl.searchParams.get('base_url')?.trim() || ''
  const queryApiKey = requestUrl.searchParams.get('api_key')?.trim() || ''
  const queryProfileId = Number(requestUrl.searchParams.get('profile_id') || '')

  let selectedProfile: {
    id: number
    provider: string
    base_url: string
    api_key_encrypted: string
  } | null = null

  if (Number.isFinite(queryProfileId) && queryProfileId > 0) {
    selectedProfile = await db.prepare(`
      SELECT id, provider, base_url, api_key_encrypted
      FROM ai_provider_profiles
      WHERE id = ?
      LIMIT 1
    `).bind(queryProfileId).first<{
      id: number
      provider: string
      base_url: string
      api_key_encrypted: string
    }>()
  }

  const provider = queryProvider || selectedProfile?.provider || 'custom'
  const fallbackPreset = AI_PROVIDER_MAP[provider]
  const fallbackModels = fallbackPreset?.quickModels || []

  const baseUrl = normalizeBaseUrl(queryBaseUrl || selectedProfile?.base_url || '')
  const profileApiKey = selectedProfile?.api_key_encrypted
    ? await decryptApiKey(selectedProfile.api_key_encrypted, secret)
    : ''
  const apiKey = queryApiKey || profileApiKey || ''
  const storedKeyUnavailable = !queryApiKey
    && Boolean(selectedProfile?.api_key_encrypted?.trim())
    && !profileApiKey

  if (!baseUrl) return NextResponse.json({ error: '缺少 base_url 参数' }, { status: 400 })

  if (!apiKey && provider !== 'openrouter') {
    const warning = storedKeyUnavailable
      ? '已保存 API Key 无法解密，请重新输入 API Key，或检查 AI_CONFIG_ENCRYPTION_SECRET / ADMIN_TOKEN_SALT 是否与保存时一致'
      : '未提供 API Key，返回预设模型列表'
    if (fallbackModels.length > 0) {
      return NextResponse.json({
        models: fallbackModels.map(id => ({ id, name: id })),
        source: 'preset',
        warning,
      })
    }
    return NextResponse.json({ error: storedKeyUnavailable ? warning : '缺少 API Key' }, { status: 400 })
  }

  try {
    if (isWorkersAiProvider(provider, baseUrl)) {
      const accountId = extractCloudflareAccountId(baseUrl)
      if (!accountId || /<account_id>/i.test(accountId)) {
        if (fallbackModels.length > 0) {
          return NextResponse.json({
            models: fallbackModels.map(id => ({ id, name: id })),
            source: 'preset',
            warning: 'Workers AI 需要把 Base URL 里的 <ACCOUNT_ID> 替换成真实 Cloudflare Account ID 后才能拉取完整模型列表',
          })
        }
        return NextResponse.json({ error: '请先在 Base URL 中填写真实的 Cloudflare Account ID' }, { status: 400 })
      }

      const models = await fetchWorkersAiModels(accountId, apiKey, 'text', fallbackModels)
      if (models.length === 0 && fallbackModels.length > 0) {
        return NextResponse.json({
          models: fallbackModels.map(id => ({ id, name: id })),
          source: 'preset',
          warning: 'Workers AI 接口返回为空，已回退预设模型',
        })
      }

      return NextResponse.json({ models, source: 'provider' })
    }

    const headers: Record<string, string> = {}
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`

    const requestUrls = isSiliconFlowProvider(provider, baseUrl)
      ? [`${baseUrl}/models?sub_type=chat`, `${baseUrl}/models`]
      : [`${baseUrl}/models`]

    const collectedItems: RawModelItem[] = []
    const warnings: string[] = []

    for (const requestUrl of requestUrls) {
      const res = await fetch(requestUrl, {
        headers,
        signal: AbortSignal.timeout(15000),
      })

      if (!res.ok) {
        const rawBody = await res.text().catch(() => '')
        warnings.push(buildProviderErrorMessage(res.status, res.statusText, rawBody))
        continue
      }

      const data = await res.json().catch(() => null)
      const items = filterCompatibleModels(extractModelItems(data), provider, baseUrl)
      collectedItems.push(...items)
    }

    const models = buildWorkersAiModelOptions(filterCompatibleModels(collectedItems, provider, baseUrl))

    if (models.length === 0 && warnings.length > 0) {
      const message = warnings[0]
      if (fallbackModels.length > 0) {
        return NextResponse.json({
          models: fallbackModels.map(id => ({ id, name: id })),
          source: 'preset',
          warning: `接口拉取失败，已回退预设：${message}`,
        })
      }
      return NextResponse.json({ error: `获取模型列表失败：${message}` }, { status: 502 })
    }

    if (models.length === 0 && fallbackModels.length > 0) {
      return NextResponse.json({
        models: fallbackModels.map(id => ({ id, name: id })),
        source: 'preset',
        warning: '接口返回为空，已回退预设模型',
      })
    }

    return NextResponse.json({
      models,
      source: 'provider',
      ...(warnings.length > 0 ? { warning: warnings[0] } : {}),
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : '获取模型列表失败'
    if (fallbackModels.length > 0) {
      return NextResponse.json({
        models: fallbackModels.map(id => ({ id, name: id })),
        source: 'preset',
        warning: `网络异常，已回退预设：${message}`,
      })
    }
    return NextResponse.json({ error: message }, { status: 502 })
  }
}
