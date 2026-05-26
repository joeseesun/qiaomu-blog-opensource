import { NextRequest, NextResponse } from 'next/server'
import { authenticateRequest } from '@/lib/admin-auth'
import { getAppCloudflareEnv } from '@/lib/cloudflare'
import {
  ensureAiImageConfigInfrastructure,
  ensureDefaultImageProfileId,
  saveEncryptedAiImageApiKey,
  type AIImageProviderProfileRow,
} from '@/lib/ai-image-config'
import { normalizeBaseUrl, resolveAiConfigSecret } from '@/lib/ai-provider-profiles'

interface SaveProfileBody {
  id?: number
  name?: string
  provider?: string
  provider_name?: string
  provider_type?: string
  provider_category?: string
  api_key_url?: string
  base_url?: string
  model?: string
  api_key?: string
  is_default?: boolean
}

function buildProfilePayload(body: SaveProfileBody) {
  const name = (body.name || '').trim()
  const model = (body.model || '').trim()
  const baseUrl = normalizeBaseUrl(body.base_url || '')

  if (!name) return { error: '配置名称不能为空' }
  if (!baseUrl) return { error: 'Base URL 不能为空' }
  if (!model) return { error: '模型名称不能为空' }

  return {
    name,
    provider: (body.provider || 'custom').trim() || 'custom',
    provider_name: (body.provider_name || '').trim(),
    provider_type: (body.provider_type || 'openai_images').trim() || 'openai_images',
    provider_category: (body.provider_category || '').trim(),
    api_key_url: (body.api_key_url || '').trim(),
    base_url: baseUrl,
    model,
  }
}

async function listProfiles(db: D1Database) {
  const { results } = await db.prepare(`
    SELECT id, name, provider, provider_name, provider_type, provider_category, api_key_url,
           base_url, model, api_key_masked, is_default, created_at, updated_at
    FROM ai_image_provider_profiles
    ORDER BY is_default DESC, updated_at DESC, id DESC
  `).all<AIImageProviderProfileRow>()

  const profiles = results || []
  const defaultProfileId = profiles.find((profile) => profile.is_default === 1)?.id ?? null
  return { profiles, defaultProfileId }
}

export async function GET(req: NextRequest) {
  const env = await getAppCloudflareEnv()
  const db = env?.DB as D1Database | undefined
  if (!(await authenticateRequest(req, db))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (!db) return NextResponse.json({ error: 'DB unavailable' }, { status: 500 })

  await ensureAiImageConfigInfrastructure(db)
  const { profiles, defaultProfileId } = await listProfiles(db)
  return NextResponse.json({ profiles, default_profile_id: defaultProfileId })
}

export async function POST(req: NextRequest) {
  const env = await getAppCloudflareEnv()
  const db = env?.DB as D1Database | undefined
  if (!(await authenticateRequest(req, db))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (!db) return NextResponse.json({ error: 'DB unavailable' }, { status: 500 })

  await ensureAiImageConfigInfrastructure(db)

  const body = (await req.json()) as SaveProfileBody
  const payload = buildProfilePayload(body)
  if ('error' in payload) {
    return NextResponse.json({ error: payload.error }, { status: 400 })
  }

  const secret = resolveAiConfigSecret(env as unknown as Record<string, unknown>)
  const rawApiKey = (body.api_key || '').trim()
  const { encrypted, masked } = await saveEncryptedAiImageApiKey(rawApiKey, secret)

  if (body.is_default) {
    await db.prepare('UPDATE ai_image_provider_profiles SET is_default = 0').run()
  }

  const result = await db.prepare(`
    INSERT INTO ai_image_provider_profiles (
      name, provider, provider_name, provider_type, provider_category, api_key_url,
      base_url, model, api_key_encrypted, api_key_masked, is_default, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, strftime('%s', 'now'), strftime('%s', 'now'))
  `).bind(
    payload.name,
    payload.provider,
    payload.provider_name,
    payload.provider_type,
    payload.provider_category,
    payload.api_key_url,
    payload.base_url,
    payload.model,
    encrypted,
    masked,
    body.is_default ? 1 : 0,
  ).run()

  const insertedId = result.meta.last_row_id
  const defaultId = await ensureDefaultImageProfileId(db)
  if (defaultId) {
    await db.prepare('UPDATE ai_image_actions SET profile_id = ? WHERE profile_id IS NULL').bind(defaultId).run()
  }

  const row = await db.prepare(`
    SELECT id, name, provider, provider_name, provider_type, provider_category, api_key_url,
           base_url, model, api_key_masked, is_default, created_at, updated_at
    FROM ai_image_provider_profiles
    WHERE id = ?
  `).bind(insertedId).first<AIImageProviderProfileRow>()

  return NextResponse.json({ success: true, profile: row || null })
}

export async function PUT(req: NextRequest) {
  const env = await getAppCloudflareEnv()
  const db = env?.DB as D1Database | undefined
  if (!(await authenticateRequest(req, db))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (!db) return NextResponse.json({ error: 'DB unavailable' }, { status: 500 })

  await ensureAiImageConfigInfrastructure(db)

  const body = (await req.json()) as SaveProfileBody
  const id = Number(body.id)
  if (!Number.isFinite(id) || id <= 0) {
    return NextResponse.json({ error: '缺少有效的配置 ID' }, { status: 400 })
  }

  const exists = await db.prepare(`
    SELECT id, api_key_masked, is_default
    FROM ai_image_provider_profiles
    WHERE id = ?
  `).bind(id).first<{ id: number; api_key_masked: string; is_default: number }>()

  if (!exists) {
    return NextResponse.json({ error: '配置不存在' }, { status: 404 })
  }

  const payload = buildProfilePayload(body)
  if ('error' in payload) {
    return NextResponse.json({ error: payload.error }, { status: 400 })
  }

  const secret = resolveAiConfigSecret(env as unknown as Record<string, unknown>)
  const rawApiKey = (body.api_key || '').trim()
  const encryptedPayload = rawApiKey
    ? await saveEncryptedAiImageApiKey(rawApiKey, secret)
    : null

  const nextIsDefault =
    body.is_default === true
      ? 1
      : body.is_default === false
        ? 0
        : exists.is_default

  if (nextIsDefault === 1) {
    await db.prepare('UPDATE ai_image_provider_profiles SET is_default = 0').run()
  }

  const sets = [
    'name = ?',
    'provider = ?',
    'provider_name = ?',
    'provider_type = ?',
    'provider_category = ?',
    'api_key_url = ?',
    'base_url = ?',
    'model = ?',
    'api_key_masked = ?',
    'is_default = ?',
    "updated_at = strftime('%s', 'now')",
  ]
  const values: Array<string | number> = [
    payload.name,
    payload.provider,
    payload.provider_name,
    payload.provider_type,
    payload.provider_category,
    payload.api_key_url,
    payload.base_url,
    payload.model,
    encryptedPayload?.masked || exists.api_key_masked,
    nextIsDefault,
  ]

  if (encryptedPayload) {
    sets.splice(8, 0, 'api_key_encrypted = ?')
    values.splice(8, 0, encryptedPayload.encrypted)
  }

  values.push(id)

  await db.prepare(`
    UPDATE ai_image_provider_profiles
    SET ${sets.join(', ')}
    WHERE id = ?
  `).bind(...values).run()

  const defaultId = await ensureDefaultImageProfileId(db)
  if (defaultId) {
    await db.prepare('UPDATE ai_image_actions SET profile_id = ? WHERE profile_id IS NULL').bind(defaultId).run()
  }

  const row = await db.prepare(`
    SELECT id, name, provider, provider_name, provider_type, provider_category, api_key_url,
           base_url, model, api_key_masked, is_default, created_at, updated_at
    FROM ai_image_provider_profiles
    WHERE id = ?
  `).bind(id).first<AIImageProviderProfileRow>()

  return NextResponse.json({ success: true, profile: row || null })
}

export async function DELETE(req: NextRequest) {
  const env = await getAppCloudflareEnv()
  const db = env?.DB as D1Database | undefined
  if (!(await authenticateRequest(req, db))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (!db) return NextResponse.json({ error: 'DB unavailable' }, { status: 500 })

  await ensureAiImageConfigInfrastructure(db)

  const body = (await req.json()) as { id?: number }
  const id = Number(body.id)
  if (!Number.isFinite(id) || id <= 0) {
    return NextResponse.json({ error: '缺少有效的配置 ID' }, { status: 400 })
  }

  const boundCount = await db.prepare(`
    SELECT COUNT(*) as count
    FROM ai_image_actions
    WHERE profile_id = ?
  `).bind(id).first<{ count: number }>()

  await db.prepare('DELETE FROM ai_image_provider_profiles WHERE id = ?').bind(id).run()

  const defaultId = await ensureDefaultImageProfileId(db)
  if ((boundCount?.count ?? 0) > 0) {
    await db.prepare('UPDATE ai_image_actions SET profile_id = ? WHERE profile_id = ?').bind(defaultId ?? null, id).run()
  }

  return NextResponse.json({ success: true })
}
