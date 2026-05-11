import { NextResponse } from 'next/server'
import { getAppCloudflareEnv } from '@/lib/cloudflare'
import { ensureAiConfigInfrastructure, resolveAiConfigSecret } from '@/lib/ai-provider-profiles'

interface AiActionPublic {
  id: number
  action_key: string
  label: string
  description: string
}

// 编辑器用只读接口，无需鉴权（不暴露 prompt）
export async function GET() {
  const env = await getAppCloudflareEnv()
  const db = env?.DB as D1Database | undefined
  if (!db) {
    return NextResponse.json({ actions: [] })
  }

  try {
    const secret = resolveAiConfigSecret(env as unknown as Record<string, unknown>)
    await ensureAiConfigInfrastructure(db, secret)

    const { results } = await db.prepare(
      'SELECT id, action_key, label, description FROM ai_actions WHERE is_enabled = 1 ORDER BY sort_order ASC'
    ).all<AiActionPublic>()

    return NextResponse.json({ actions: results })
  } catch {
    // DB 表可能不存在（未迁移），返回空列表让前端 fallback
    return NextResponse.json({ actions: [] })
  }
}
