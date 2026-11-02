import { afterEach, describe, expect, it } from 'vitest'
import { request, type Server } from 'node:http'
// @ts-expect-error The standalone Node bridge intentionally ships as JavaScript.
import { createPublishBridge } from '../../tools/publish-bridge/server.mjs'

const servers: Server[] = []
afterEach(async () => { await Promise.all(servers.map(server => new Promise<void>(resolve => server.close(() => resolve())))); servers.length = 0 })
async function fixture() {
  const server: Server = createPublishBridge(); servers.push(server)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  const headers = { origin: 'https://blog.qiaomu.ai', 'content-type': 'application/json' }
  const payload = { job: { v: 1, id: 'job', target: 'zhihu', title: '测试文章', content: { html: '<p>正文<img src="qp-asset://image-1"></p>' }, assets: [{ id: 'image-1', name: 'test.png', mime: 'image/png', bytes: 3 }] }, assets: [{ id: 'image-1', mime: 'image/png', base64: 'AQID' }] }
  return { base, headers, payload }
}
describe('browser to existing Clipper v1 bridge', () => {
  it('hands off once, serves original image bytes, and returns the draft receipt', async () => {
    const { base, headers, payload } = await fixture()
    const created = await fetch(`${base}/jobs`, { method: 'POST', headers, body: JSON.stringify(payload) })
    expect(created.status).toBe(201)
    const { control, url } = await created.json()
    const [port, pickup] = new URL(url).hash.slice(4).split('.')
    const local = `http://127.0.0.1:${port}`
    const auth = { authorization: `Bearer ${pickup}`, origin: 'chrome-extension://test' }
    const response = await fetch(`${local}/v1/job`, { headers: auth })
    const { session, job } = await response.json()
    expect(job).toEqual(payload.job)
    expect((await fetch(`${local}/v1/job`, { headers: auth })).status).toBe(410)
    const sessionHeaders = { authorization: `Bearer ${session}`, 'content-type': 'application/json' }
    const image = await fetch(`${local}/v1/asset/image-1`, { headers: sessionHeaders })
    expect([...new Uint8Array(await image.arrayBuffer())]).toEqual([1, 2, 3])
    expect((await fetch(`${local}/v1/asset/image-1`, { headers: { ...sessionHeaders, origin: 'https://evil.example' } })).status).toBe(403)
    await fetch(`${local}/v1/status`, { method: 'POST', headers: sessionHeaders, body: JSON.stringify({ state: 'done', url: 'https://zhuanlan.zhihu.com/p/123' }) })
    const status = await fetch(`${base}/job`, { headers: { ...headers, authorization: `Bearer ${control}` } })
    expect(await status.json()).toMatchObject({ state: 'done', url: 'https://zhuanlan.zhihu.com/p/123' })
  })
  it('rejects untrusted origins, missing capabilities, invalid jobs, and DNS rebinding', async () => {
    const { base, headers, payload } = await fixture()
    expect((await fetch(`${base}/health`, { headers: { origin: 'https://evil.example' } })).status).toBe(403)
    const rebound = await new Promise<number | undefined>(resolve => { const req = request(`${base}/health`, { headers: { ...headers, host: 'evil.example' } }, res => { res.resume(); resolve(res.statusCode) }); req.end() })
    expect(rebound).toBe(403)
    expect((await fetch(`${base}/job`, { headers })).status).toBe(401)
    expect((await fetch(`${base}/jobs`, { method: 'POST', headers, body: JSON.stringify({ ...payload, assets: [] }) })).status).toBe(400)
    expect((await fetch(`${base}/jobs`, { method: 'POST', headers, body: 'broken' })).status).toBe(400)
    const options = await fetch(`${base}/jobs`, { method: 'OPTIONS', headers })
    expect(options.status).toBe(204)
    expect(options.headers.get('access-control-allow-origin')).toBe(headers.origin)
  })
  it('propagates cancellation to Clipper without claiming the draft was deleted', async () => {
    const { base, headers, payload } = await fixture()
    const { control, url } = await (await fetch(`${base}/jobs`, { method: 'POST', headers, body: JSON.stringify(payload) })).json()
    const [port, pickup] = new URL(url).hash.slice(4).split('.')
    const { session } = await (await fetch(`http://127.0.0.1:${port}/v1/job`, { headers: { authorization: `Bearer ${pickup}` } })).json()
    await fetch(`${base}/job`, { method: 'DELETE', headers: { ...headers, authorization: `Bearer ${control}` } })
    const response = await fetch(`http://127.0.0.1:${port}/v1/status`, { method: 'POST', headers: { authorization: `Bearer ${session}`, 'content-type': 'application/json' }, body: JSON.stringify({ state: 'running' }) })
    expect(await response.json()).toMatchObject({ cancel: true })
    expect(await (await fetch(`${base}/job`, { headers: { ...headers, authorization: `Bearer ${control}` } })).json()).toMatchObject({ state: 'cancelled' })
  })
})
