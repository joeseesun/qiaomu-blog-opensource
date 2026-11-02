import { NextRequest, NextResponse } from 'next/server'
import { COOKIE_NAME, isAdminAuthenticated } from '@/lib/admin-auth'
import { corsPreflight, withCors } from '@/lib/server/cors'

export async function GET(req: NextRequest) {
  const token = req.cookies.get(COOKIE_NAME)?.value
  const authenticated = await isAdminAuthenticated(token)

  return withCors(req, NextResponse.json(
    { authenticated },
    {
      headers: {
        'Cache-Control': 'private, no-store, max-age=0, must-revalidate',
      },
    },
  ))
}

export function OPTIONS(req: NextRequest) {
  return corsPreflight(req, 'GET, OPTIONS')
}
