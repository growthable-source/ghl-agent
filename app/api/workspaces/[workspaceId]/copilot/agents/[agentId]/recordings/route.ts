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
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'
import { db } from '@/lib/db'

type Params = { params: Promise<{ workspaceId: string; agentId: string }> }

const MAX_BYTES = 500 * 1024 * 1024 // 500 MB — screen recordings are big
const ALLOWED = /\.(mp4|mov|webm|mkv|mp3|m4a|wav|ogg|aac)$/i

export async function POST(req: NextRequest, { params }: Params) {
  const { workspaceId, agentId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  const agent = await db.copilotAgent.findFirst({ where: { id: agentId, workspaceId }, select: { id: true } })
  if (!agent) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const form = await req.formData().catch(() => null)
  const file = form?.get('file')
  if (!(file instanceof File)) return NextResponse.json({ error: 'No file provided' }, { status: 400 })
  if (!ALLOWED.test(file.name)) {
    return NextResponse.json({ error: 'Unsupported file — upload an audio or video recording (mp4, mov, webm, mp3, m4a, wav…).' }, { status: 400 })
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

  const rec = await db.copilotRecording.create({
    data: {
      agentId,
      workspaceId,
      storageKey: blob.pathname,
      originalFilename: file.name,
      status: 'queued',
    },
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
