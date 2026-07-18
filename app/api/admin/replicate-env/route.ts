import { NextRequest, NextResponse } from 'next/server'
import { createHash } from 'node:crypto'

/**
 * TEMPORARY — one-shot env replication to the xovera-widget project.
 *
 * Vercel "sensitive"-type env vars are write-only: no API or CLI can read
 * their values back, but this runtime has them in process.env. This route
 * copies a requested set of keys server-side to another Vercel project via
 * the Vercel API — values go Vercel runtime → Vercel API and are never
 * returned in the response.
 *
 * Gated by a single-use random token (SHA-256 compared). DELETE THIS FILE
 * immediately after the copy has been verified.
 */

const AUTH_SHA256 = 'dea3b54a942c3ce50d7a6d5dcbf697f6e82cadbe175392621fec0eac6591b355'

export async function POST(req: NextRequest) {
  const token = req.headers.get('x-replicate-auth') || ''
  if (createHash('sha256').update(token).digest('hex') !== AUTH_SHA256) {
    return NextResponse.json({ error: 'not found' }, { status: 404 })
  }

  const { vercelToken, teamId, projectId, keys } = await req.json()
  if (!vercelToken || !teamId || !projectId || !Array.isArray(keys) || keys.length > 100) {
    return NextResponse.json({ error: 'bad request' }, { status: 400 })
  }

  const results: Record<string, string> = {}
  for (const key of keys) {
    if (typeof key !== 'string' || !/^[A-Z][A-Z0-9_]*$/.test(key)) { results[String(key)] = 'invalid'; continue }
    const value = process.env[key]
    if (value === undefined || value === '') { results[key] = 'absent'; continue }
    const r = await fetch(
      `https://api.vercel.com/v10/projects/${encodeURIComponent(projectId)}/env?teamId=${encodeURIComponent(teamId)}&upsert=true`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${vercelToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, value, type: 'sensitive', target: ['production'] }),
      },
    )
    results[key] = r.ok ? 'ok' : `err ${r.status}`
  }
  return NextResponse.json({ results })
}
