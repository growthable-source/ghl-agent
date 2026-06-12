/**
 * Recording upload for a Co-Pilot agent.
 *   POST (multipart { file }) — stores the recording in Blob and
 *        queues it for background processing (Gemini transcribe +
 *        screen walkthrough → playbook distillation). Returns at once.
 *   DELETE ?id=<recordingId> — remove a recording.
 *
 * Audio OR screen video. The video track is where the agent learns
 * navigation; audio-only still teaches phrasing.
 */

import { NextRequest, NextResponse } from 'next/server'
import { after } from 'next/server'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'
import { db } from '@/lib/db'

type Params = { params: Promise<{ workspaceId: string; agentId: string }> }

// after() inherits this budget, so the inline kickoff can finish even
// a multi-minute video analysis rather than being cut off at the
// default ~15s and leaving a half-processed row for the cron to mop up.
export const maxDuration = 300

const MAX_BYTES = 500 * 1024 * 1024 // 500 MB — screen recordings are big
// Recordings (teach phrasing + on-screen navigation) AND documents
// (an SOP PDF with screenshots teaches the same; md/txt teach the
// step content). All feed the same playbook distillation — Gemini
// reads PDF pages incl. embedded screenshots natively.
const ALLOWED = /\.(mp4|mov|webm|mkv|mp3|m4a|wav|ogg|aac|pdf|md|markdown|txt)$/i

export async function POST(req: NextRequest, { params }: Params) {
  const { workspaceId, agentId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  const agent = await db.copilotAgent.findFirst({ where: { id: agentId, workspaceId }, select: { id: true } })
  if (!agent) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const contentType = req.headers.get('content-type') ?? ''
  let storageKey: string
  let originalFilename: string

  if (contentType.includes('application/json')) {
    // Register an already-uploaded blob (the browser uploaded it
    // DIRECTLY to Vercel Blob via the upload-url token route — videos
    // can't fit through the ~4.5MB function body limit). Verify the
    // blob exists and lives under this workspace's namespace so a
    // client can't register an arbitrary key.
    const body = (await req.json().catch(() => ({}))) as { storageKey?: string; originalFilename?: string }
    const key = (body.storageKey ?? '').trim()
    const name = (body.originalFilename ?? '').trim()
    if (!key || !name) return NextResponse.json({ error: 'storageKey and originalFilename required' }, { status: 400 })
    if (!ALLOWED.test(name)) {
      return NextResponse.json({ error: 'Unsupported file — upload a recording (mp4, mov, webm, mp3, wav…) or a document (PDF, Markdown, txt).' }, { status: 400 })
    }
    if (!key.startsWith(`copilot-recordings/${workspaceId}/`)) {
      return NextResponse.json({ error: 'Invalid storage key for this workspace.' }, { status: 400 })
    }
    try {
      const { head } = await import('@vercel/blob')
      await head(key)
    } catch {
      return NextResponse.json({ error: 'Uploaded file not found — the upload may not have finished.' }, { status: 400 })
    }
    storageKey = key
    originalFilename = name
  } else {
    // Legacy / small-file path: file in the request body (works only
    // under the function body limit; the editor uses direct upload).
    const form = await req.formData().catch(() => null)
    const file = form?.get('file')
    if (!(file instanceof File)) return NextResponse.json({ error: 'No file provided' }, { status: 400 })
    if (!ALLOWED.test(file.name)) {
      return NextResponse.json({ error: 'Unsupported file — upload a recording (mp4, mov, webm, mp3, wav…) or a document (PDF, Markdown, txt).' }, { status: 400 })
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json({ error: `Recording is too large (${Math.round(file.size / 1024 / 1024)} MB). The limit is 500 MB.` }, { status: 400 })
    }
    const { put } = await import('@vercel/blob')
    const safe = file.name.replace(/[^\w.\- ]+/g, '_')
    const blob = await put(`copilot-recordings/${workspaceId}/${crypto.randomUUID()}-${safe}`, file, {
      access: 'public',
      addRandomSuffix: false,
    })
    storageKey = blob.pathname
    originalFilename = file.name
  }

  const rec = await db.copilotRecording.create({
    data: { agentId, workspaceId, storageKey, originalFilename, status: 'queued' },
  })

  // Start processing IMMEDIATELY rather than waiting up to 60s for the
  // next cron tick — that gap made the row sit at "Waiting to
  // process…" with no sign of life. after() keeps the function alive
  // past the response on Vercel; the cron remains the backstop if this
  // instance is frozen/killed before it finishes (the recording stays
  // 'queued' and the next tick claims it). claim is compare-and-swap
  // so the two paths can't double-process.
  after(async () => {
    try {
      const claimed = await db.copilotRecording.updateMany({
        where: { id: rec.id, status: 'queued' },
        data: { status: 'processing' },
      })
      if (claimed.count === 0) return // cron beat us to it
      const { processRecording } = await import('@/lib/copilot/recordings')
      await processRecording(rec.id)
    } catch (err) {
      console.error('[recordings] inline processing kickoff failed:', err instanceof Error ? err.message : err)
    }
  })

  return NextResponse.json({ recordingId: rec.id })
}

export async function DELETE(req: NextRequest, { params }: Params) {
  const { workspaceId, agentId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access
  const id = req.nextUrl.searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  await db.copilotRecording.deleteMany({ where: { id, agentId, workspaceId } })
  return NextResponse.json({ ok: true })
}
