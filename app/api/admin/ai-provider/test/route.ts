import { NextRequest, NextResponse } from 'next/server'
import { authenticateRequest } from '@/lib/admin-auth'
import { getAppCloudflareEnv } from '@/lib/cloudflare'
import {
  clampMaxTokens,
  clampTemperature,
  decryptApiKey,
  ensureAiConfigInfrastructure,
  normalizeBaseUrl,
  resolveAiConfigSecret,
} from '@/lib/ai-provider-profiles'

function isGeminiBaseUrl(baseUrl: string): boolean {
  return /generativelanguage\.googleapis\.com/i.test(baseUrl)
}

function ensureGeminiBase(baseUrl: string): string {
  if (baseUrl.includes('/v1') || baseUrl.includes('/v1beta')) {
    return baseUrl
  }
  return `${baseUrl}/v1`
}

function toStringSafe(value: unknown): string {
  if (typeof value === 'string') return value
  if (value === null || value === undefined) return ''
  return String(value)
}

function buildProviderErrorMessage(resStatus: number, resStatusText: string, rawBody: string): string {
  let parsed: unknown
  try {
    parsed = rawBody ? JSON.parse(rawBody) : null
  } catch {
    parsed = null
  }

  if (parsed && typeof parsed === 'object') {
    const payload = parsed as {
      message?: unknown
      error?: unknown
    }

    if (payload.error && typeof payload.error === 'object') {
      const errObj = payload.error as {
        message?: unknown
        code?: unknown
        metadata?: {
          raw?: unknown
          provider_name?: unknown
          provider_error?: unknown
          reason?: unknown
        } | unknown
      }
      const message = toStringSafe(errObj.message)
      const code = toStringSafe(errObj.code)

      let providerRaw = ''
      let providerName = ''
      if (errObj.metadata && typeof errObj.metadata === 'object') {
        const meta = errObj.metadata as {
          raw?: unknown
          provider_name?: unknown
          provider_error?: unknown
          reason?: unknown
        }
        providerRaw =
          toStringSafe(meta.raw) ||
          toStringSafe(meta.provider_error) ||
          toStringSafe(meta.reason)
        providerName = toStringSafe(meta.provider_name)
      }

      const parts = [
        message || 'Provider returned error',
        providerRaw ? `详情: ${providerRaw}` : '',
        providerName ? `Provider: ${providerName}` : '',
        code ? `Code: ${code}` : '',
      ].filter(Boolean)
      return parts.join(' · ')
    }

    if (typeof payload.error === 'string' && payload.error.trim()) {
      return payload.error.trim()
    }

    if (typeof payload.message === 'string' && payload.message.trim()) {
      return payload.message.trim()
    }
  }

  const raw = rawBody.trim()
  if (raw) return raw.slice(0, 500)
  return `HTTP ${resStatus}: ${resStatusText}`
}

export async function POST(req: NextRequest) {
  const env = await getAppCloudflareEnv()
  const db = env?.DB as D1Database | undefined
  if (!(await authenticateRequest(req, db))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (!db) {
    return NextResponse.json({ error: 'DB unavailable' }, { status: 500 })
  }

  const secret = resolveAiConfigSecret(env as unknown as Record<string, unknown>)
  await ensureAiConfigInfrastructure(db, secret)

  const body = (await req.json()) as {
    profile_id?: number
    base_url?: string
    api_key?: string
    model?: string
    temperature?: number
    max_tokens?: number
  }

  const profileId = Number(body.profile_id)
  let selectedProfile: {
    base_url: string
    model: string
    api_key_encrypted: string
  } | null = null

  if (Number.isFinite(profileId) && profileId > 0) {
    selectedProfile = await db.prepare(`
      SELECT base_url, model, api_key_encrypted
      FROM ai_provider_profiles
      WHERE id = ?
      LIMIT 1
    `).bind(profileId).first<{
      base_url: string
      model: string
      api_key_encrypted: string
    }>()
  }

  const normalizedBaseUrl = normalizeBaseUrl(body.base_url || selectedProfile?.base_url || '')
  const normalizedModel = (body.model || selectedProfile?.model || '').trim()
  const temperature = clampTemperature(Number(body.temperature))
  const maxTokens = Math.max(1, Math.min(256, Math.floor(clampMaxTokens(Number(body.max_tokens)))))

  const profileApiKey = selectedProfile?.api_key_encrypted
    ? await decryptApiKey(selectedProfile.api_key_encrypted, secret)
    : ''
  const storedKeyUnavailable = !((body.api_key || '').trim())
    && Boolean(selectedProfile?.api_key_encrypted?.trim())
    && !profileApiKey
  const key = (body.api_key || '').trim() || profileApiKey

  if (storedKeyUnavailable && normalizedBaseUrl && normalizedModel) {
    return NextResponse.json({
      success: false,
      error: '已保存 API Key 无法解密，请重新输入 API Key，或检查 AI_CONFIG_ENCRYPTION_SECRET / ADMIN_TOKEN_SALT 是否与保存时一致',
    })
  }

  if (!normalizedBaseUrl || !key || !normalizedModel) {
    return NextResponse.json({ error: '缺少必要参数' }, { status: 400 })
  }

  try {
    const t0 = Date.now()
    let res: Response

    if (isGeminiBaseUrl(normalizedBaseUrl)) {
      const geminiBase = ensureGeminiBase(normalizedBaseUrl)
      const endpoint = `${geminiBase}/models/${encodeURIComponent(normalizedModel)}:generateContent?key=${encodeURIComponent(key)}`
      res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: 'Say "OK"' }] }],
          generationConfig: { temperature, maxOutputTokens: maxTokens },
        }),
        signal: AbortSignal.timeout(15000),
      })
    } else {
      res = await fetch(`${normalizedBaseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${key}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: normalizedModel,
          messages: [{ role: 'user', content: 'Say "OK"' }],
          temperature,
          max_tokens: maxTokens,
        }),
        signal: AbortSignal.timeout(15000),
      })
    }

    if (!res.ok) {
      const rawBody = await res.text().catch(() => '')
      const message = buildProviderErrorMessage(res.status, res.statusText, rawBody)
      return NextResponse.json({
        success: false,
        error: message,
      })
    }

    return NextResponse.json({
      success: true,
      latency_ms: Date.now() - t0,
      model: normalizedModel,
    })
  } catch (error) {
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : '连接失败',
    })
  }
}
