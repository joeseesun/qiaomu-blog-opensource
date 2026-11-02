import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  authenticateRequest: vi.fn(),
  getAppCloudflareContext: vi.fn(),
  listMemos: vi.fn(),
  getMemoBySlug: vi.fn(),
  createMemo: vi.fn(),
  updateMemo: vi.fn(),
  deleteMemo: vi.fn(),
  triggerWwwRebuild: vi.fn(),
  waitUntil: vi.fn(),
}))

vi.mock('@/lib/admin-auth', () => ({ authenticateRequest: mocks.authenticateRequest }))
vi.mock('@/lib/cloudflare', () => ({
  getAppCloudflareContext: mocks.getAppCloudflareContext,
  getAppCloudflareEnv: async () => (await mocks.getAppCloudflareContext()).env,
}))
vi.mock('@/lib/server/www-rebuild', () => ({ triggerWwwRebuild: mocks.triggerWwwRebuild }))
vi.mock('@/lib/repositories/memos', async () => {
  const actual = await vi.importActual<typeof import('@/lib/repositories/memos')>('@/lib/repositories/memos')
  return {
    ...actual,
    listMemos: mocks.listMemos,
    getMemoBySlug: mocks.getMemoBySlug,
    createMemo: mocks.createMemo,
    updateMemo: mocks.updateMemo,
    deleteMemo: mocks.deleteMemo,
  }
})

import { GET as listRoute, OPTIONS as listOptions, POST as createRoute } from '@/app/api/memos/route'
import { DELETE as deleteRoute, GET as getRoute, PATCH as patchRoute } from '@/app/api/memos/[slug]/route'

const WWW = 'https://www.qiaomu.ai'
const memo = (visibility: string) => ({ id: 1, slug: 'abc', html: '<p>hi</p>', text: 'hi', visibility, syndication: {}, created_at: 1, updated_at: 1 })
const request = (url: string, init: { method?: string; body?: string; origin?: string } = {}) => {
  const headers = new Headers()
  if (init.origin) headers.set('Origin', init.origin)
  return new NextRequest(`https://blog.qiaomu.ai${url}`, { method: init.method, body: init.body, headers })
}
const params = (slug: string) => ({ params: Promise.resolve({ slug }) })

describe('/api/memos', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getAppCloudflareContext.mockResolvedValue({ env: { DB: {} }, ctx: { waitUntil: mocks.waitUntil } })
    mocks.listMemos.mockResolvedValue([])
  })

  it('only lists public memos for anonymous callers, even when more are requested', async () => {
    mocks.authenticateRequest.mockResolvedValue(false)
    const response = await listRoute(request('/api/memos?visibility=private,unlisted,public', { origin: WWW }))
    expect(response.status).toBe(200)
    expect(mocks.listMemos).toHaveBeenCalledWith({}, expect.objectContaining({ visibilities: ['public'] }))
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe(WWW)
    expect(response.headers.get('Access-Control-Allow-Credentials')).toBe('true')
  })

  it('lists every visibility for the admin', async () => {
    mocks.authenticateRequest.mockResolvedValue(true)
    await listRoute(request('/api/memos'))
    expect(mocks.listMemos).toHaveBeenCalledWith({}, expect.objectContaining({ visibilities: ['private', 'unlisted', 'public'] }))
  })

  it('does not grant CORS to unknown origins', async () => {
    const response = listOptions(request('/api/memos', { method: 'OPTIONS', origin: 'https://evil.example' }))
    expect(response.headers.get('Access-Control-Allow-Origin')).toBeNull()
  })

  it('rejects writes from untrusted origins before checking auth', async () => {
    mocks.authenticateRequest.mockResolvedValue(true)
    const response = await createRoute(request('/api/memos', {
      method: 'POST',
      origin: 'https://other.qiaomu.ai',
      body: JSON.stringify({ html: '<p>x</p>' }),
    }))
    expect(response.status).toBe(403)
    expect(mocks.createMemo).not.toHaveBeenCalled()
  })

  it('requires auth to create', async () => {
    mocks.authenticateRequest.mockResolvedValue(false)
    const response = await createRoute(request('/api/memos', { method: 'POST', origin: WWW, body: JSON.stringify({ html: '<p>x</p>' }) }))
    expect(response.status).toBe(401)
  })

  it('creates a memo and rebuilds www only when it is visible there', async () => {
    mocks.authenticateRequest.mockResolvedValue(true)
    mocks.createMemo.mockResolvedValueOnce(memo('private')).mockResolvedValueOnce(memo('public'))

    const priv = await createRoute(request('/api/memos', { method: 'POST', origin: WWW, body: JSON.stringify({ html: '<p>x</p>' }) }))
    expect(priv.status).toBe(201)
    expect(mocks.triggerWwwRebuild).not.toHaveBeenCalled()

    await createRoute(request('/api/memos', { method: 'POST', origin: WWW, body: JSON.stringify({ html: '<p>x</p>', visibility: 'public' }) }))
    expect(mocks.triggerWwwRebuild).toHaveBeenCalledTimes(1)
    expect(mocks.createMemo).toHaveBeenLastCalledWith({}, expect.objectContaining({ visibility: 'public', text: 'x' }))
  })

  it('rejects empty and invalid payloads', async () => {
    mocks.authenticateRequest.mockResolvedValue(true)
    const empty = await createRoute(request('/api/memos', { method: 'POST', body: JSON.stringify({ html: '  ' }) }))
    expect(empty.status).toBe(400)
    const bad = await createRoute(request('/api/memos', { method: 'POST', body: JSON.stringify({ html: '<p>x</p>', visibility: 'friends' }) }))
    expect(bad.status).toBe(400)
  })
})

describe('/api/memos/[slug]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getAppCloudflareContext.mockResolvedValue({ env: { DB: {} }, ctx: { waitUntil: mocks.waitUntil } })
  })

  it('hides private memos from anonymous callers', async () => {
    mocks.authenticateRequest.mockResolvedValue(false)
    mocks.getMemoBySlug.mockResolvedValue(memo('private'))
    expect((await getRoute(request('/api/memos/abc'), params('abc'))).status).toBe(404)
    mocks.getMemoBySlug.mockResolvedValue(memo('unlisted'))
    expect((await getRoute(request('/api/memos/abc'), params('abc'))).status).toBe(200)
  })

  it('rebuilds www when a public memo is made private', async () => {
    mocks.authenticateRequest.mockResolvedValue(true)
    mocks.getMemoBySlug.mockResolvedValue(memo('public'))
    mocks.updateMemo.mockResolvedValue(memo('private'))
    const response = await patchRoute(
      request('/api/memos/abc', { method: 'PATCH', origin: WWW, body: JSON.stringify({ visibility: 'private' }) }),
      params('abc'),
    )
    expect(response.status).toBe(200)
    expect(mocks.triggerWwwRebuild).toHaveBeenCalledTimes(1)
  })

  it('deletes with auth only', async () => {
    mocks.getMemoBySlug.mockResolvedValue(memo('private'))
    mocks.authenticateRequest.mockResolvedValue(false)
    expect((await deleteRoute(request('/api/memos/abc', { method: 'DELETE', origin: WWW }), params('abc'))).status).toBe(401)
    mocks.authenticateRequest.mockResolvedValue(true)
    expect((await deleteRoute(request('/api/memos/abc', { method: 'DELETE', origin: WWW }), params('abc'))).status).toBe(200)
    expect(mocks.deleteMemo).toHaveBeenCalledWith({}, 'abc')
    expect(mocks.triggerWwwRebuild).not.toHaveBeenCalled()
  })
})
