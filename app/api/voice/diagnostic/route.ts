/**
 * POST /api/voice/diagnostic
 *
 * Browser test-call error capture. When @vapi-ai/web's vapi.on('error')
 * fires, VoicePhoneCallUI posts the full error payload here so future
 * "still failing" reports come with the actual Vapi/daily error blob
 * grep-able in our DB instead of buried in the user's browser console.
 *
 * The daily-co transport reports failures as "Meeting ended due to
 * ejection: Meeting has ended" — that surface is generic. The
 * underlying error object usually carries `errorMsg`, `action`, and
 * a nested `error` blob with more detail. We persist all of it.
 *
 * Auth: workspace session. Validates the agent belongs to the
 * caller's workspace.
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'

export async function POST(req: NextRequest) {
  let body: any
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const workspaceId = String(body?.workspaceId || '')
  const agentId = String(body?.agentId || '')
  if (!workspaceId || !agentId) {
    return NextResponse.json({ error: 'workspaceId + agentId required' }, { status: 400 })
  }

  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  // Verify the agent really belongs to this workspace — prevents
  // diagnostic logging from being abused as a cross-workspace probe.
  const agent = await db.agent.findFirst({
    where: { id: agentId, workspaceId },
    select: { id: true },
  })
  if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 })

  try {
    await db.voiceTestCallDiagnostic.create({
      data: {
        workspaceId,
        agentId,
        vapiAssistantId: typeof body.vapiAssistantId === 'string' ? body.vapiAssistantId : null,
        errorType: typeof body.errorType === 'string' ? body.errorType.slice(0, 64) : null,
        errorPayload: (body?.errorPayload && typeof body.errorPayload === 'object')
          ? body.errorPayload as any
          : null,
        userAgent: typeof body.userAgent === 'string' ? body.userAgent.slice(0, 512) : null,
      },
    })
  } catch (err: any) {
    // VoiceTestCallDiagnostic table may not exist yet on a deploy
    // where the migration hasn't run. Don't surface — diagnostic
    // logging should never break the call.
    console.warn('[voice-diagnostic] write failed:', err?.message)
  }

  return NextResponse.json({ ok: true })
}
