/**
 * GET /api/admin/image-gen-probe
 *
 * Diagnostic for the build loop's image-gen path. Reports:
 *   - Which env vars are populated at runtime (length only — never the value).
 *   - Result of a real Replicate API call against the configured token.
 *   - Result of a real Gemini API call.
 *
 * Admin-only. Read-only. Safe to leave deployed; the actual API calls
 * are gated behind ?run=1 so a casual GET doesn't burn dollars.
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAdminOrNull } from '@/lib/admin-auth'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(req: NextRequest) {
  const admin = await requireAdminOrNull()
  if (!admin) return NextResponse.json({ error: 'Admin only' }, { status: 403 })

  const url = new URL(req.url)
  const run = url.searchParams.get('run') === '1'

  const env = {
    REPLICATE_API_TOKEN: lenOf(process.env.REPLICATE_API_TOKEN),
    GEMINI_API_KEY: lenOf(process.env.GEMINI_API_KEY),
    BROWSERBASE_API_KEY: lenOf(process.env.BROWSERBASE_API_KEY),
    BROWSERBASE_PROJECT_ID: lenOf(process.env.BROWSERBASE_PROJECT_ID),
    BLOB_READ_WRITE_TOKEN: lenOf(process.env.BLOB_READ_WRITE_TOKEN),
    ANTHROPIC_API_KEY: lenOf(process.env.ANTHROPIC_API_KEY),
  }

  const probes: Record<string, unknown> = {}

  if (run) {
    probes.replicate = await probeReplicate()
    probes.gemini = await probeGemini()
  }

  return NextResponse.json({ env, probes, ranProbes: run })
}

function lenOf(v: string | undefined): { set: boolean; len: number; head?: string } {
  if (!v) return { set: false, len: 0 }
  return { set: true, len: v.length, head: v.slice(0, 6) }
}

async function probeReplicate(): Promise<unknown> {
  const token = process.env.REPLICATE_API_TOKEN
  if (!token) return { skipped: 'no token' }
  try {
    // List models to verify auth without burning $0.06 on a generation.
    const res = await fetch('https://api.replicate.com/v1/account', {
      headers: { Authorization: `Bearer ${token}` },
    })
    const text = await res.text()
    return {
      http: res.status,
      ok: res.ok,
      body: text.slice(0, 400),
    }
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) }
  }
}

async function probeGemini(): Promise<unknown> {
  const key = process.env.GEMINI_API_KEY
  if (!key) return { skipped: 'no key' }
  try {
    // List models — cheapest auth check.
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${key}`)
    const text = await res.text()
    return {
      http: res.status,
      ok: res.ok,
      body: text.slice(0, 400),
    }
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) }
  }
}
