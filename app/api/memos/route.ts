import type { NextRequest } from 'next/server'
import { authenticateRequest } from '@/lib/admin-auth'
import { createMemo, isMemoVisibility, listMemos, MEMO_VISIBILITIES, type MemoVisibility } from '@/lib/repositories/memos'
import { corsPreflight, isTrustedWriteOrigin, withCors } from '@/lib/server/cors'
import { parseMemoWritePayload } from '@/lib/server/memo-payload'
import { getRouteContextWithDb, jsonError, jsonOk } from '@/lib/server/route-helpers'
import { triggerWwwRebuild } from '@/lib/server/www-rebuild'

const NO_STORE = { 'Cache-Control': 'private, no-store, max-age=0' }

export function OPTIONS(req: NextRequest) {
  return corsPreflight(req, 'GET, POST, OPTIONS')
}

// GET /api/memos?visibility=public,unlisted&limit=50&before=<unix seconds>
// Anonymous callers only ever get public memos.
export async function GET(req: NextRequest) {
  const route = await getRouteContextWithDb()
  if (!route.ok) return withCors(req, route.response)

  const isAdmin = await authenticateRequest(req, route.db)
  const requested = (req.nextUrl.searchParams.get('visibility') || '')
    .split(',')
    .map((value) => value.trim())
    .filter(isMemoVisibility)
  const allowed: readonly MemoVisibility[] = isAdmin ? MEMO_VISIBILITIES : ['public']
  const visibilities = requested.length > 0 ? requested.filter((value) => allowed.includes(value)) : allowed

  const limit = Number.parseInt(req.nextUrl.searchParams.get('limit') || '50', 10)
  const before = Number.parseInt(req.nextUrl.searchParams.get('before') || '', 10)
  const memos = await listMemos(route.db, {
    visibilities,
    limit: Number.isFinite(limit) ? limit : 50,
    before: Number.isFinite(before) ? before : null,
  })

  const response = jsonOk({ memos, admin: isAdmin })
  if (isAdmin) Object.entries(NO_STORE).forEach(([key, value]) => response.headers.set(key, value))
  else response.headers.set('Cache-Control', 'public, max-age=60')
  return withCors(req, response)
}

export async function POST(req: NextRequest) {
  const route = await getRouteContextWithDb()
  if (!route.ok) return withCors(req, route.response)
  if (!isTrustedWriteOrigin(req)) return withCors(req, jsonError('Forbidden origin', 403))
  if (!(await authenticateRequest(req, route.db))) return withCors(req, jsonError('Unauthorized', 401))

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return withCors(req, jsonError('请求体不是有效 JSON', 400))
  }
  const parsed = parseMemoWritePayload(body)
  if (!parsed.ok) return withCors(req, jsonError(parsed.error, 400))
  if (!parsed.input.html?.trim()) return withCors(req, jsonError('内容不能为空', 400))

  const memo = await createMemo(route.db, parsed.input)
  if (memo.visibility !== 'private') {
    route.ctx.waitUntil?.(triggerWwwRebuild(route.env as unknown as Record<string, string>, `create ${memo.slug}`))
  }
  return withCors(req, jsonOk({ memo }, 201))
}
