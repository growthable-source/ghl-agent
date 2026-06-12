/**
 * Meeting self-learning loop — every call a Co-Pilot agent attends
 * becomes its own training material.
 *
 * Recall records each bot's call (mixed video, on by default). After
 * the session ends, this sweep — run from the process-copilot-
 * recordings cron — pulls the mp4, streams it into Vercel Blob, and
 * registers a CopilotRecording row exactly as if the operator had
 * uploaded it by hand. The existing pipeline then takes over:
 * Gemini transcript + screen-walkthrough extraction, playbook
 * re-distillation. No new processing machinery.
 *
 * Sessions opt in via metadata.recordingPending (set at dispatch).
 * The flag is cleared with a recordingNote on every terminal outcome
 * so a session is never re-examined forever.
 */

import { put } from '@vercel/blob'
import { db } from '@/lib/db'
import { isRecallConfigured, getMeetingBotRecording } from './recall'

/** Recall mp4s are ~2 Mbps ≈ 900 MB/hour; the manual-upload pipeline
 *  caps at 500 MB, and Gemini processing buffers the file, so we hold
 *  the same line (~33 min of video). */
const MAX_RECORDING_BYTES = 500 * 1024 * 1024
/** Stop watching for a recording this long after session end. */
const EXPIRY_HOURS = 36
/** Test calls and instant hangups would only pollute the playbook. */
const MIN_DURATION_SECS = 300

type Terminal = { done: true; note: string } | { done: false }

/**
 * Ingest at most ONE pending meeting recording (downloads can be
 * hundreds of MB — one per cron tick keeps the function budget sane).
 * Returns the new CopilotRecording id, or null when nothing was ready.
 */
export async function ingestNextMeetingRecording(): Promise<string | null> {
  if (!isRecallConfigured()) return null

  const candidates = await db.copilotSession.findMany({
    where: {
      channel: 'recall_meeting_bot',
      status: { in: ['ended', 'error'] },
      endedAt: { gt: new Date(Date.now() - EXPIRY_HOURS * 3600 * 1000) },
      metadata: { path: ['recordingPending'], equals: true },
    },
    orderBy: { endedAt: 'asc' },
    take: 5,
    select: { id: true, workspaceId: true, roomId: true, endedAt: true, durationSecs: true, metadata: true },
  })

  for (const session of candidates) {
    try {
      const outcome = await tryIngest(session)
      if (outcome.done) {
        await clearPending(session.id, session.metadata, outcome.note)
        if (outcome.note.startsWith('ingested:')) return outcome.note.slice('ingested:'.length)
      }
      // not done = recording not ready yet — leave the flag, next tick retries
    } catch (err) {
      console.error(`[Meeting ingest] session ${session.id} failed:`, err)
    }
  }
  return null
}

interface CandidateSession {
  id: string
  workspaceId: string
  roomId: string | null
  endedAt: Date | null
  durationSecs: number | null
  metadata: unknown
}

async function tryIngest(session: CandidateSession): Promise<Terminal> {
  const meta = (session.metadata ?? {}) as Record<string, unknown>

  if (!session.roomId) return { done: true, note: 'no_bot' }
  if ((session.durationSecs ?? 0) < MIN_DURATION_SECS) return { done: true, note: 'too_short_to_learn_from' }

  // Quality gate: the playbook distiller treats source material as
  // authoritative, so a call the post-session analysis judged a
  // frustrated failure must NOT become training material — that would
  // teach the agent its own mistakes.
  const analysis = meta.analysis as { issueResolved?: boolean; sentiment?: string } | undefined
  if (analysis && analysis.issueResolved === false && analysis.sentiment === 'frustrated') {
    return { done: true, note: 'skipped_unsuccessful_call' }
  }

  const agentId = typeof meta.copilotAgentId === 'string' ? meta.copilotAgentId : null
  const agent = agentId
    ? await db.copilotAgent.findFirst({ where: { id: agentId, workspaceId: session.workspaceId }, select: { id: true, name: true } })
    : null
  if (!agent) return { done: true, note: 'agent_deleted' }

  const bot = await getMeetingBotRecording(session.roomId)
  if (!bot.recordingUrl) {
    // Recall processes recordings async — give it time. A bot that
    // failed outright will simply age out at the EXPIRY window.
    if (bot.status === 'fatal') return { done: true, note: 'bot_failed_no_recording' }
    return { done: false }
  }

  const res = await fetch(bot.recordingUrl)
  if (!res.ok || !res.body) return { done: false } // expired link mints fresh on next bot fetch

  const declaredBytes = Number(res.headers.get('content-length'))
  if (Number.isFinite(declaredBytes) && declaredBytes > MAX_RECORDING_BYTES) {
    return { done: true, note: 'recording_too_large' }
  }

  const endedDate = (session.endedAt ?? new Date()).toISOString().slice(0, 10)
  const blob = await put(
    `copilot-recordings/${session.workspaceId}/${agent.id}/meeting-${session.id}.mp4`,
    res.body,
    { access: 'public', contentType: 'video/mp4', addRandomSuffix: false, allowOverwrite: true },
  )

  const recording = await db.copilotRecording.create({
    data: {
      agentId: agent.id,
      workspaceId: session.workspaceId,
      storageKey: blob.url,
      originalFilename: `Meeting ${endedDate} — ${agent.name} (auto-captured).mp4`,
      status: 'queued',
    },
  })

  console.log(`[Meeting ingest] session ${session.id} → recording ${recording.id} queued for learning`)
  return { done: true, note: `ingested:${recording.id}` }
}

async function clearPending(sessionId: string, metadata: unknown, note: string) {
  const meta = (metadata ?? {}) as Record<string, unknown>
  await db.copilotSession.update({
    where: { id: sessionId },
    data: {
      metadata: JSON.parse(
        JSON.stringify({
          ...meta,
          recordingPending: false,
          recordingNote: note.startsWith('ingested:') ? 'ingested' : note,
          ...(note.startsWith('ingested:') ? { recordingId: note.slice('ingested:'.length) } : {}),
        }),
      ),
    },
  })
}
