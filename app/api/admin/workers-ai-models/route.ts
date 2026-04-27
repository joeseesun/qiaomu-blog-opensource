import { NextRequest, NextResponse } from 'next/server'
import { authenticateRequest } from '@/lib/admin-auth'
import { getAppCloudflareEnv } from '@/lib/cloudflare'
import {
  WORKERS_AI_IMAGE_MODEL_SUGGESTIONS,
  WORKERS_AI_TEXT_MODEL_SUGGESTIONS,
} from '@/lib/ai-post-generators'
import {
  decryptApiKey,
  ensureAiConfigInfrastructure,
  normalizeBaseUrl,
  resolveAiConfigSecret,
} from '@/lib/ai-provider-profiles'
import { extractCloudflareAccountId, fetchWorkersAiModels } from '@/lib/workers-ai-models'

interface WorkersAiProfileRow {
  id: number
  provider: string
  base_url: string
  api_key_encrypted: string
  is_default: number
}

function toModelOptions(ids: string[]) {
  return ids.map((id) => ({ id, name: id }))
}

export async function GET(req: NextRequest) {
  const env = await getAppCloudflareEnv()
  const db = env?.DB as D1Database | undefined
  if (!(await authenticateRequest(req, db))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (!db) {
    return NextResponse.json({ error: 'DB unavailable' }, { status: 500 })
  }

  const url = new URL(req.url)
  const kind = url.searchParams.get('kind') === 'image' ? 'image' : 'text'
  const requestedProfileId = Number(url.searchParams.get('profile_id') || '')
  const fallbackModels = kind === 'image' ? WORKERS_AI_IMAGE_MODEL_SUGGESTIONS : WORKERS_AI_TEXT_MODEL_SUGGESTIONS

  const secret = resolveAiConfigSecret(env as unknown as Record<string, unknown>)
  await ensureAiConfigInfrastructure(db, secret)

  let selectedProfile: WorkersAiProfileRow | null = null

  if (Number.isFinite(requestedProfileId) && requestedProfileId > 0) {
    selectedProfile = await db.prepare(`
      SELECT id, provider, base_url, api_key_encrypted, is_default
      FROM ai_provider_profiles
      WHERE id = ?
        AND (
          provider = 'workers_ai'
          OR base_url LIKE '%api.cloudflare.com/client/v4/accounts/%/ai/%'
        )
      LIMIT 1
    `).bind(requestedProfileId).first<WorkersAiProfileRow>()
  }

  if (!selectedProfile) {
    selectedProfile = await db.prepare(`
      SELECT id, provider, base_url, api_key_encrypted, is_default
      FROM ai_provider_profiles
      WHERE provider = 'workers_ai'
         OR base_url LIKE '%api.cloudflare.com/client/v4/accounts/%/ai/%'
      ORDER BY is_default DESC, updated_at DESC, id DESC
      LIMIT 1
    `).first<WorkersAiProfileRow>()
  }

  const profileBaseUrl = normalizeBaseUrl(selectedProfile?.base_url || '')
  const profileApiToken = selectedProfile?.api_key_encrypted
    ? await decryptApiKey(selectedProfile.api_key_encrypted, secret)
    : ''
  const storedKeyUnavailable = Boolean(selectedProfile?.api_key_encrypted?.trim()) && !profileApiToken

  const accountId = extractCloudflareAccountId(profileBaseUrl)
    || env?.CLOUDFLARE_ACCOUNT_ID
    || process.env.CLOUDFLARE_ACCOUNT_ID
    || ''
  const apiToken = profileApiToken
    || env?.CLOUDFLARE_API_TOKEN
    || process.env.CLOUDFLARE_API_TOKEN
    || ''

  if (!accountId || !apiToken) {
    const warning = storedKeyUnavailable
      ? '已保存的 Workers AI API Token 无法解密，已回退预设模型，请重新保存该配置'
      : selectedProfile
        ? '已存在 Workers AI 配置，但缺少可用的 Account ID 或 API Token，已回退预设模型'
        : '未找到可用的 Workers AI provider profile，也未配置 CLOUDFLARE_ACCOUNT_ID / CLOUDFLARE_API_TOKEN，已回退预设模型'

    return NextResponse.json({
      models: toModelOptions(fallbackModels),
      source: 'preset',
      warning,
    })
  }

  try {
    const models = await fetchWorkersAiModels(accountId, apiToken, kind, fallbackModels)
    if (models.length === 0) {
      return NextResponse.json({
        models: toModelOptions(fallbackModels),
        source: 'preset',
        warning: 'Workers AI 接口返回为空，已回退预设模型',
      })
    }

    return NextResponse.json({
      models,
      source: 'provider',
      ...(storedKeyUnavailable ? { warning: '当前已改用环境变量中的 Workers AI 凭证拉取模型；已保存配置中的 API Token 无法解密' } : {}),
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : '获取 Workers AI 模型失败'
    return NextResponse.json({
      models: toModelOptions(fallbackModels),
      source: 'preset',
      warning: `Workers AI 拉取失败，已回退预设：${message}`,
    })
  }
}
