import { NextResponse } from 'next/server'
import { AuthError } from '@/lib/api-auth'

export type Window = { from: Date; to: Date; brandId?: string }

export function parseWindow(url: URL): Window {
  const to = url.searchParams.get('to')
    ? new Date(url.searchParams.get('to') + 'T00:00:00Z')
    : new Date()
  let from: Date
  const fromParam = url.searchParams.get('from')
  if (fromParam) {
    from = new Date(fromParam + 'T00:00:00Z')
  } else {
    const days = Number(url.searchParams.get('days') ?? 30)
    if (!Number.isFinite(days) || days < 1 || days > 365) {
      throw new AuthError(422, 'bad_param', 'days must be 1..365')
    }
    from = new Date(to.getTime() - days * 86400000)
  }
  const brandId = url.searchParams.get('brandId') || undefined
  return { from, to, brandId }
}

/** Parse a `limit` query param, clamped to [1, max], default `def`. NaN-safe. */
export function parseLimit(url: URL, def = 50, max = 200): number {
  const raw = url.searchParams.get('limit')
  if (!raw) return def
  const n = Math.floor(Number(raw))
  if (!Number.isFinite(n)) return def
  return Math.min(Math.max(1, n), max)
}

/** Map an AuthError (or unknown) to a uniform JSON error response. */
export function errorResponse(err: unknown): NextResponse {
  if (err instanceof AuthError) {
    return NextResponse.json({ error: { code: err.code, message: err.message } }, { status: err.status })
  }
  console.error('[api/v1] unhandled', err)
  return NextResponse.json({ error: { code: 'internal', message: 'Internal error' } }, { status: 500 })
}

export function ok(data: unknown, meta: Record<string, unknown>): NextResponse {
  const res = NextResponse.json({ ...meta, data })
  if (typeof meta.scope === 'string') res.headers.set('x-api-scope', meta.scope)
  if (typeof meta.workspaceId === 'string') res.headers.set('x-api-workspace', meta.workspaceId)
  if (typeof meta.apiKeyId === 'string') res.headers.set('x-api-key-id', meta.apiKeyId)
  return res
}
