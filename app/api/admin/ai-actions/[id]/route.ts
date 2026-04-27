import { NextRequest, NextResponse } from 'next/server'
import { authenticateRequest } from '@/lib/admin-auth'
import { getAppCloudflareEnv } from '@/lib/cloudflare'
import {
  ensureAiConfigInfrastructure,
  ensureDefaultProfileId,
  resolveAiConfigSecret,
} from '@/lib/ai-provider-profiles'

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const env = await getAppCloudflareEnv()
  const db = env?.DB as D1Database | undefined
  if (!(await authenticateRequest(req, db))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (!db) return NextResponse.json({ error: 'DB unavailable' }, { status: 500 })
  const secret = resolveAiConfigSecret(env as unknown as Record<string, unknown>)
  await ensureAiConfigInfrastructure(db, secret)

  const { id } = await params
  const body = (await req.json()) as {
    action_key?: string
    label?: string
    description?: string
    prompt?: string
    temperature?: number
    profile_id?: number
    is_enabled?: number
  }
  const nextTemperature = Number.isFinite(body.temperature) ? Number(body.temperature) : undefined

  const sets: string[] = []
  const vals: (string | number | null)[] = []

  if (body.action_key !== undefined) { sets.push('action_key = ?'); vals.push(body.action_key) }
  if (body.label !== undefined) { sets.push('label = ?'); vals.push(body.label) }
  if (body.description !== undefined) { sets.push('description = ?'); vals.push(body.description) }
  if (body.prompt !== undefined) { sets.push('prompt = ?'); vals.push(body.prompt) }
  if (nextTemperature !== undefined) { sets.push('temperature = ?'); vals.push(nextTemperature) }
  if (body.profile_id !== undefined) {
    if (Number.isFinite(body.profile_id) && Number(body.profile_id) > 0) {
      sets.push('profile_id = ?')
      vals.push(Number(body.profile_id))
    } else {
      const defaultProfileId = await ensureDefaultProfileId(db)
      sets.push('profile_id = ?')
      vals.push(defaultProfileId ?? null)
    }
  }
  if (body.is_enabled !== undefined) { sets.push('is_enabled = ?'); vals.push(body.is_enabled) }

  if (sets.length === 0) {
    return NextResponse.json({ error: '没有可更新的字段' }, { status: 400 })
  }

  sets.push("updated_at = strftime('%s', 'now')")
  vals.push(Number(id))

  try {
    await db.prepare(
      `UPDATE ai_actions SET ${sets.join(', ')} WHERE id = ?`
    ).bind(...vals).run()
  } catch (error) {
    if (error instanceof Error && /UNIQUE constraint failed: ai_actions\\.action_key/i.test(error.message)) {
      return NextResponse.json({ error: '操作标识已存在' }, { status: 409 })
    }
    throw error
  }

  return NextResponse.json({ success: true })
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const env = await getAppCloudflareEnv()
  const db = env?.DB as D1Database | undefined
  if (!(await authenticateRequest(req, db))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (!db) return NextResponse.json({ error: 'DB unavailable' }, { status: 500 })
  const secret = resolveAiConfigSecret(env as unknown as Record<string, unknown>)
  await ensureAiConfigInfrastructure(db, secret)

  const { id } = await params

  const row = await db.prepare('SELECT id FROM ai_actions WHERE id = ?')
    .bind(Number(id)).first<{ id: number }>()

  if (!row?.id) {
    return NextResponse.json({ error: '操作不存在' }, { status: 404 })
  }

  await db.prepare('DELETE FROM ai_actions WHERE id = ?').bind(Number(id)).run()
  return NextResponse.json({ success: true })
}
