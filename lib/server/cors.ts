import { NextResponse } from 'next/server'

// Origins allowed to call memo, upload and session APIs with the admin cookie.
// www.qiaomu.ai is same-site with blog.qiaomu.ai, so the SameSite=Lax admin cookie is sent along.
const DEFAULT_ALLOWED_ORIGINS = ['https://www.qiaomu.ai']

export function getAllowedOrigins(): string[] {
  const configured = process.env.MEMO_ALLOWED_ORIGINS
  if (!configured) return DEFAULT_ALLOWED_ORIGINS
  return configured.split(',').map((origin) => origin.trim()).filter(Boolean)
}

function readOrigin(req: Request) {
  return req.headers?.get?.('Origin') ?? null
}

export function isAllowedOrigin(origin: string | null): origin is string {
  return Boolean(origin) && getAllowedOrigins().includes(origin as string)
}

// Rejects cross-origin writes from origins outside the allowlist. Requests without an
// Origin header (server-to-server with a Bearer token) and same-origin requests pass.
export function isTrustedWriteOrigin(req: Request): boolean {
  const origin = readOrigin(req)
  if (!origin) return true
  if (isAllowedOrigin(origin)) return true
  try {
    return new URL(req.url).origin === origin
  } catch {
    return false
  }
}

export function withCors<T extends Response>(req: Request, response: T): T {
  const origin = readOrigin(req)
  if (isAllowedOrigin(origin)) {
    response.headers.set('Access-Control-Allow-Origin', origin)
    response.headers.set('Access-Control-Allow-Credentials', 'true')
    response.headers.append('Vary', 'Origin')
  }
  return response
}

export function corsPreflight(req: Request, methods = 'GET, POST, PATCH, DELETE, OPTIONS') {
  const response = new NextResponse(null, { status: 204 })
  if (isAllowedOrigin(readOrigin(req))) {
    response.headers.set('Access-Control-Allow-Methods', methods)
    response.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization')
    response.headers.set('Access-Control-Max-Age', '86400')
  }
  return withCors(req, response)
}
