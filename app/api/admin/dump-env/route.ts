import { NextRequest, NextResponse } from 'next/server'
import { createHash } from 'node:crypto'

/**
 * TEMPORARY — one-shot env export for the xovera-widget backup file.
 *
 * Vercel "sensitive"-type env vars are write-only (no API/CLI read-back),
 * but this runtime has the real values in process.env. This route returns
 * a requested set as a .env-format body so the operator can save a local
 * backup. Token-gated (SHA-256). DELETE THIS FILE right after use.
 */

const AUTH_SHA256 = '4bd895c21c9376fb6110e776ee4d70c5f067a283c7b1cddd63cb0da7c0a83f5a'

export async function POST(req: NextRequest) {
  const token = req.headers.get('x-dump-auth') || ''
  if (createHash('sha256').update(token).digest('hex') !== AUTH_SHA256) {
    return NextResponse.json({ error: 'not found' }, { status: 404 })
  }
  const { keys } = await req.json()
  if (!Array.isArray(keys) || keys.length > 200) {
    return NextResponse.json({ error: 'bad request' }, { status: 400 })
  }
  const lines: string[] = []
  for (const key of keys) {
    if (typeof key !== 'string' || !/^[A-Z][A-Z0-9_]*$/.test(key)) continue
    const value = process.env[key]
    if (value === undefined || value === '') continue
    // Quote and escape so multi-line / special-char values round-trip.
    lines.push(`${key}="${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`)
  }
  return new NextResponse(lines.join('\n') + '\n', {
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  })
}
