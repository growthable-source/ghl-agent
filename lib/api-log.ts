// lib/api-log.ts
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

type Handler = (req: NextRequest, ctx?: unknown) => Promise<NextResponse>

export function withApiLog(handler: Handler): Handler {
  return async (req: NextRequest, ctx?: unknown) => {
    const start = Date.now()
    const res = await handler(req, ctx)
    db.apiRequestLog
      .create({
        data: {
          path: new URL(req.url).pathname,
          status: res.status,
          durationMs: Date.now() - start,
          scope: res.headers.get('x-api-scope') || 'unknown',
          workspaceId: res.headers.get('x-api-workspace') || null,
          apiKeyId: res.headers.get('x-api-key-id') || null,
        },
      })
      .catch(() => {}) // best-effort; never block the response
    return res
  }
}
