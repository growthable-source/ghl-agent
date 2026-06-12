import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { processRecording } from '@/lib/copilot/recordings'
import { ingestNextMeetingRecording } from '@/lib/copilot/meeting-ingest'
import { recordCronRun } from '@/lib/cron-heartbeat'

/**
 * Background worker for Co-Pilot call recordings.
 *
 * Recording upload returns instantly with status='queued'. This cron
 * claims queued recordings race-proof (compare-and-swap, same pattern
 * as ingest-queue / process-simulations), runs the Gemini transcribe +
 * screen-walkthrough extraction, and re-distills the agent's playbook.
 * One per tick — media analysis is heavy and the maxDuration budget
 * is for a single long video.
 *
 * On idle ticks it instead pulls ONE finished meeting-bot recording
 * down from Recall into the same queue (the self-learning loop) —
 * never both in one tick, since each can be a multi-hundred-MB job.
 */

export const maxDuration = 300

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Reclaim zombies: a recording stuck 'processing' for 15+ min means
  // its function died mid-analysis. Fail it so the agent editor stops
  // showing a perpetual spinner; the user can delete + re-upload.
  await db.copilotRecording.updateMany({
    where: { status: 'processing', createdAt: { lt: new Date(Date.now() - 15 * 60 * 1000) } },
    data: { status: 'failed', error: 'Processing timed out — try uploading a shorter clip.' },
  })

  const next = await db.copilotRecording.findFirst({
    where: { status: 'queued' },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  })

  let processed: string | null = null
  if (next) {
    const claimed = await db.copilotRecording.updateMany({
      where: { id: next.id, status: 'queued' },
      data: { status: 'processing' },
    })
    if (claimed.count > 0) {
      await processRecording(next.id)
      processed = next.id
    }
  }

  let ingested: string | null = null
  if (!processed) {
    try {
      ingested = await ingestNextMeetingRecording()
    } catch (err) {
      console.error('[Cron] meeting recording ingest failed:', err)
    }
  }

  await recordCronRun('process-copilot-recordings', true)
  return NextResponse.json({ ok: true, processed, ingested })
}
