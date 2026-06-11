/**
 * POST /api/copilot/sessions/[sessionId]/tool — staff surface.
 *
 * Server-side execution of one read-only Co-Pilot tool call. Auth:
 * workspace membership against the session row. Mechanics live in
 * the shared session service.
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'
import { loadActiveSession, runSessionTool } from '@/lib/copilot/session-service'

type Params = { params: Promise<{ sessionId: string }> }

export async function POST(req: NextRequest, { params }: Params) {
  const { sessionId } = await params
  const loaded = await loadActiveSession(sessionId)
  if (!loaded.ok) {
    const status = loaded.reason === 'not_found' ? 404 : 409
    return NextResponse.json({ error: `Session ${loaded.reason}` }, { status })
  }

  const access = await requireWorkspaceAccess(loaded.session.workspaceId)
  if (access instanceof NextResponse) return access

  const body = (await req.json().catch(() => ({}))) as { name?: string; args?: Record<string, unknown> }
  if (!body.name || typeof body.name !== 'string') {
    return NextResponse.json({ error: 'tool name required' }, { status: 400 })
  }

  const { result, latencyMs } = await runSessionTool(
    loaded.session,
    body.name,
    body.args && typeof body.args === 'object' ? body.args : {},
  )
  return NextResponse.json({ result, latencyMs })
}
