import { NextRequest, NextResponse } from 'next/server'
import { authenticateRequest } from '@/lib/admin-auth'
import { getAppCloudflareEnv } from '@/lib/cloudflare'
import { transformEditorSelectionStream, getAiRuntimeEnv } from '@/lib/ai'
import { ensureAiConfigInfrastructure, resolveAiConfigSecret } from '@/lib/ai-provider-profiles'

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

  let body: { action?: string; text?: string; customPrompt?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: '请求体不是有效 JSON' }, { status: 400 })
  }

  const action = body.action
  const text = body.text?.trim()

  if (!action) {
    return NextResponse.json({ error: '缺少 action 参数' }, { status: 400 })
  }

  if (!text) {
    return NextResponse.json({ error: '缺少选中文本' }, { status: 400 })
  }

  const aiEnv = getAiRuntimeEnv(env)

  // 从 DB 动态读取操作配置（替代硬编码 VALID_ACTIONS）
  let actionPrompt: string | undefined
  let temperature: number | undefined
  let profileId: number | undefined

  if (action === 'custom') {
    if (!body.customPrompt?.trim()) {
      return NextResponse.json({ error: '请输入指令' }, { status: 400 })
    }
  } else {
    const row = await db.prepare(
      'SELECT prompt, temperature, profile_id FROM ai_actions WHERE action_key = ? AND is_enabled = 1'
    ).bind(action).first<{ prompt: string; temperature: number; profile_id: number | null }>()

    if (!row) {
      return NextResponse.json({ error: '不支持的 AI 操作' }, { status: 400 })
    }
    actionPrompt = row.prompt
    temperature = row.temperature
    profileId = Number.isFinite(row.profile_id) ? Number(row.profile_id) : undefined
  }

  try {
    const stream = await transformEditorSelectionStream(text, action, {
      customPrompt: body.customPrompt,
      actionPrompt,
      temperature,
      profileId,
      db,
      env: aiEnv,
    })

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-cache',
        'Transfer-Encoding': 'chunked',
      },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'AI 处理失败'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
