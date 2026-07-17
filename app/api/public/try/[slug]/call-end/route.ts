/**
 * POST /api/public/try/[slug]/call-end — best-effort duration beacon
 * from the browser when a demo call ends. Server-side truth for
 * callCount is the token mint; this only enriches totalCallSecs and
 * frees the call's concurrency slot early.
 */
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export async function POST(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const body = (await req.json().catch(() => ({}))) as { callId?: string; secs?: number }
  const callId = typeof body.callId === 'string' ? body.callId : ''
  const secs = Math.max(0, Math.min(3600, Math.floor(Number(body.secs) || 0)))
  if (!callId) return NextResponse.json({ ok: false }, { status: 400 })

  const prospect = await db.demoProspect.findUnique({ where: { slug }, select: { id: true } })
  if (!prospect) return NextResponse.json({ ok: false }, { status: 404 })

  // Only close a call once, and only one belonging to this prospect.
  const updated = await db.demoTryCall.updateMany({
    where: { id: callId, prospectId: prospect.id, endedAt: null },
    data: { endedAt: new Date(), secs },
  })
  if (updated.count > 0 && secs > 0) {
    await db.demoProspect.update({
      where: { id: prospect.id },
      data: { totalCallSecs: { increment: secs } },
    }).catch(() => {})
  }
  return NextResponse.json({ ok: true })
}
