/**
 * POST /api/copilot/sessions/[sessionId]/events
 *
 * Batched event sink (P0-9). The client buffers transcript turns +
 * screen-event summaries and flushes every few seconds (and on end
 * via sendBeacon). Counters are incremental deltas — the client
 * sends only what accumulated since the last flush, we increment.
 *
 * Privacy posture (§11): screen events carry vision summaries and
 * detected context ONLY. There is deliberately no field accepted
 * here that could contain a raw frame — even a misbehaving client
 * can't store one through this endpoint.
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireActiveCopilotSession } from '@/lib/copilot/session-auth'

type Params = { params: Promise<{ sessionId: string }> }

interface EventBatch {
  turns?: Array<{ role?: string; text?: string; tokens?: number; ts?: string }>
  screenEvents?: Array<{ visionSummary?: string; detectedContext?: Record<string, unknown>; ts?: string }>
  counters?: { audioInSecs?: number; audioOutSecs?: number; videoFrames?: number }
}

const VALID_ROLES = new Set(['user', 'agent', 'system', 'tool'])

function parseTs(ts: string | undefined): Date {
  const d = ts ? new Date(ts) : new Date()
  return isNaN(d.getTime()) ? new Date() : d
}

export async function POST(req: NextRequest, { params }: Params) {
  const { sessionId } = await params
  const session = await requireActiveCopilotSession(sessionId)
  if (session instanceof NextResponse) return session

  const body = (await req.json().catch(() => ({}))) as EventBatch

  const turns = (body.turns ?? [])
    .filter(t => t.text && VALID_ROLES.has(t.role ?? ''))
    .slice(0, 200)
  const screenEvents = (body.screenEvents ?? []).filter(e => e.visionSummary || e.detectedContext).slice(0, 200)
  const counters = body.counters ?? {}

  const writes: Promise<unknown>[] = []

  if (turns.length > 0) {
    writes.push(
      db.copilotTranscriptTurn.createMany({
        data: turns.map(t => ({
          sessionId: session.id,
          workspaceId: session.workspaceId,
          role: t.role as string,
          text: (t.text as string).slice(0, 8000),
          tokens: typeof t.tokens === 'number' ? t.tokens : null,
          ts: parseTs(t.ts),
        })),
      }),
    )
  }

  if (screenEvents.length > 0) {
    writes.push(
      db.copilotScreenEvent.createMany({
        data: screenEvents.map(e => ({
          sessionId: session.id,
          workspaceId: session.workspaceId,
          visionSummary: e.visionSummary ? e.visionSummary.slice(0, 4000) : null,
          detectedContext: (e.detectedContext ?? {}) as object,
          ts: parseTs(e.ts),
        })),
      }),
    )
  }

  const audioIn = Number(counters.audioInSecs) || 0
  const audioOut = Number(counters.audioOutSecs) || 0
  const frames = Math.max(0, Math.round(Number(counters.videoFrames) || 0))
  if (audioIn > 0 || audioOut > 0 || frames > 0) {
    writes.push(
      db.copilotSession.update({
        where: { id: session.id },
        data: {
          ...(audioIn > 0 ? { audioInSecs: { increment: audioIn } } : {}),
          ...(audioOut > 0 ? { audioOutSecs: { increment: audioOut } } : {}),
          ...(frames > 0 ? { videoFrames: { increment: frames } } : {}),
        },
      }),
    )
  }

  await Promise.all(writes)
  return NextResponse.json({ ok: true, turns: turns.length, screenEvents: screenEvents.length })
}
