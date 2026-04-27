import { NextRequest, NextResponse } from 'next/server'
import { authenticateRequest } from '@/lib/admin-auth'
import { getAppCloudflareEnv } from '@/lib/cloudflare'
import {
  ensureAiConfigInfrastructure,
  ensureDefaultProfileId,
  resolveAiConfigSecret,
} from '@/lib/ai-provider-profiles'

interface AiActionRow {
  id: number
  action_key: string
  label: string
  description: string
  prompt: string
  temperature: number
  profile_id: number | null
  sort_order: number
  is_enabled: number
  is_builtin: number
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

  const { results } = await db.prepare(
    'SELECT id, action_key, label, description, prompt, temperature, profile_id, sort_order, is_enabled, is_builtin FROM ai_actions ORDER BY sort_order ASC'
  ).all<AiActionRow>()

  return NextResponse.json({ actions: results })
}

export async function POST(req: NextRequest) {
  const env = await getAppCloudflareEnv()
  const db = env?.DB as D1Database | undefined
  if (!(await authenticateRequest(req, db))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (!db) return NextResponse.json({ error: 'DB unavailable' }, { status: 500 })

  const body = (await req.json()) as {
    action_key?: string
    label?: string
    description?: string
    prompt?: string
    temperature?: number
    profile_id?: number
    sort_order?: number
  }
  const temperature = Number.isFinite(body.temperature) ? Number(body.temperature) : 0.6

  if (!body.action_key || !body.label || !body.description || !body.prompt) {
    return NextResponse.json({ error: '缺少必填字段' }, { status: 400 })
  }

  const secret = resolveAiConfigSecret(env as unknown as Record<string, unknown>)
  await ensureAiConfigInfrastructure(db, secret)
  const defaultProfileId = await ensureDefaultProfileId(db)
  const profileId = Number.isFinite(body.profile_id) && Number(body.profile_id) > 0
    ? Number(body.profile_id)
    : defaultProfileId

  // 获取最大 sort_order
  const maxRow = await db.prepare('SELECT MAX(sort_order) as max_sort FROM ai_actions').first<{ max_sort: number | null }>()
  const sortOrder = body.sort_order ?? ((maxRow?.max_sort ?? 0) + 10)

  try {
    await db.prepare(
      'INSERT INTO ai_actions (action_key, label, description, prompt, temperature, profile_id, sort_order, is_builtin) VALUES (?, ?, ?, ?, ?, ?, ?, 0)'
    ).bind(
      body.action_key,
      body.label,
      body.description,
      body.prompt,
      temperature,
      profileId ?? null,
      sortOrder,
    ).run()
  } catch (error) {
    if (error instanceof Error && /UNIQUE constraint failed: ai_actions\\.action_key/i.test(error.message)) {
      return NextResponse.json({ error: '操作标识已存在' }, { status: 409 })
    }
    throw error
  }

  return NextResponse.json({ success: true })
}

export async function PUT(req: NextRequest) {
  // 批量更新 sort_order (reorder)
  const env = await getAppCloudflareEnv()
  const db = env?.DB as D1Database | undefined
  if (!(await authenticateRequest(req, db))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (!db) return NextResponse.json({ error: 'DB unavailable' }, { status: 500 })
  const secret = resolveAiConfigSecret(env as unknown as Record<string, unknown>)
  await ensureAiConfigInfrastructure(db, secret)

  const body = (await req.json()) as { items: Array<{ id: number; sort_order: number }> }
  if (!body.items?.length) {
    return NextResponse.json({ error: '缺少排序数据' }, { status: 400 })
  }

  for (const item of body.items) {
    await db.prepare("UPDATE ai_actions SET sort_order = ?, updated_at = strftime('%s', 'now') WHERE id = ?")
      .bind(item.sort_order, item.id).run()
  }

  return NextResponse.json({ success: true })
}
