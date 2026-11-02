import type { NextRequest } from 'next/server'
import { authenticateRequest } from '@/lib/admin-auth'
import { deleteMemo, getMemoBySlug, updateMemo } from '@/lib/repositories/memos'
import { corsPreflight, isTrustedWriteOrigin, withCors } from '@/lib/server/cors'
import { parseMemoWritePayload } from '@/lib/server/memo-payload'
import { getRouteContextWithDb, jsonError, jsonOk } from '@/lib/server/route-helpers'
import { triggerWwwRebuild } from '@/lib/server/www-rebuild'

type RouteParams = { params: Promise<{ slug: string }> }

export function OPTIONS(req: NextRequest) {
  return corsPreflight(req, 'GET, PATCH, DELETE, OPTIONS')
}

export async function GET(req: NextRequest, { params }: RouteParams) {
  const { slug } = await params
  const route = await getRouteContextWithDb()
  if (!route.ok) return withCors(req, route.response)

  const memo = await getMemoBySlug(route.db, slug)
  // A private memo answers 404 to anyone but the admin, so its existence does not leak.
  if (!memo || (memo.visibility === 'private' && !(await authenticateRequest(req, route.db)))) {
    return withCors(req, jsonError('Not found', 404))
  }
  const response = jsonOk({ memo })
  response.headers.set('Cache-Control', 'private, no-store, max-age=0')
  return withCors(req, response)
}

export async function PATCH(req: NextRequest, { params }: RouteParams) {
  const { slug } = await params
  const route = await getRouteContextWithDb()
  if (!route.ok) return withCors(req, route.response)
  if (!isTrustedWriteOrigin(req)) return withCors(req, jsonError('Forbidden origin', 403))
  if (!(await authenticateRequest(req, route.db))) return withCors(req, jsonError('Unauthorized', 401))

  const existing = await getMemoBySlug(route.db, slug)
  if (!existing) return withCors(req, jsonError('Not found', 404))

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return withCors(req, jsonError('请求体不是有效 JSON', 400))
  }
  const parsed = parseMemoWritePayload(body)
  if (!parsed.ok) return withCors(req, jsonError(parsed.error, 400))
  if (parsed.input.html !== undefined && !parsed.input.html.trim()) {
    return withCors(req, jsonError('内容不能为空', 400))
  }

  const memo = await updateMemo(route.db, slug, parsed.input)
  if (!memo) return withCors(req, jsonError('Not found', 404))
  // Rebuild when the memo is or was visible on www, so edits and un-publishing both show up.
  if (existing.visibility !== 'private' || memo.visibility !== 'private') {
    route.ctx.waitUntil?.(triggerWwwRebuild(route.env as unknown as Record<string, string>, `update ${slug}`))
  }
  return withCors(req, jsonOk({ memo }))
}

export async function DELETE(req: NextRequest, { params }: RouteParams) {
  const { slug } = await params
  const route = await getRouteContextWithDb()
  if (!route.ok) return withCors(req, route.response)
  if (!isTrustedWriteOrigin(req)) return withCors(req, jsonError('Forbidden origin', 403))
  if (!(await authenticateRequest(req, route.db))) return withCors(req, jsonError('Unauthorized', 401))

  const existing = await getMemoBySlug(route.db, slug)
  if (!existing) return withCors(req, jsonError('Not found', 404))
  await deleteMemo(route.db, slug)
  if (existing.visibility !== 'private') {
    route.ctx.waitUntil?.(triggerWwwRebuild(route.env as unknown as Record<string, string>, `delete ${slug}`))
  }
  return withCors(req, jsonOk({ success: true }))
}
