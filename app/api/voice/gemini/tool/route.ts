import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { auth } from '@/lib/auth'
import { executeTool } from '@/lib/agent/execute-tool'
import { validateWidgetRequest, widgetCorsHeaders } from '@/lib/widget-auth'

/**
 * POST { agentId, name, args, widgetId? }
 *
 * Runs ONE agent tool against the real CRM and returns { result }.
 * The browser/bridge never touches CRM credentials: the server resolves
 * locationId from the agent row (client-supplied locationId is ignored).
 *
 * Auth:
 *  - widgetId present → public widget call: validate the widget public
 *    key + origin, and require the agent to belong to the widget's
 *    workspace (so a visitor can't drive an arbitrary agent).
 *  - else → dashboard preview: require an authenticated user who is a
 *    member of the agent's workspace.
 */
export async function OPTIONS(req: NextRequest) {
  return new NextResponse(null, { status: 204, headers: widgetCorsHeaders(req.headers.get('origin')) })
}

export async function POST(req: NextRequest) {
  const cors = widgetCorsHeaders(req.headers.get('origin'))
  const body = (await req.json().catch(() => ({}))) as {
    agentId?: string
    name?: string
    args?: Record<string, unknown>
    widgetId?: string
  }
  const agentId = typeof body.agentId === 'string' ? body.agentId : ''
  const name = typeof body.name === 'string' ? body.name : ''
  const args = (body.args && typeof body.args === 'object' ? body.args : {}) as Record<string, unknown>
  if (!agentId || !name) {
    return NextResponse.json({ error: 'agentId and name required' }, { status: 400, headers: cors })
  }

  const agent = await db.agent.findUnique({
    where: { id: agentId },
    select: { id: true, locationId: true, workspaceId: true, enabledTools: true },
  })
  if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404, headers: cors })

  // Only allow tools the agent actually has enabled (defense in depth —
  // the locked token already restricts declarations, but the exec path
  // is a separate trust boundary).
  if (!agent.enabledTools.includes(name)) {
    return NextResponse.json({ error: 'Tool not enabled for this agent' }, { status: 403, headers: cors })
  }

  // ── Auth branch ──
  if (body.widgetId) {
    const v = await validateWidgetRequest(req, body.widgetId)
    if (!v.ok) return NextResponse.json({ error: v.error }, { status: v.status, headers: cors })
    if (v.widget.workspaceId !== agent.workspaceId) {
      return NextResponse.json({ error: 'Agent not on this widget workspace' }, { status: 403, headers: cors })
    }
  } else {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: cors })
    }
    if (!agent.workspaceId) {
      return NextResponse.json({ error: 'Agent has no workspace' }, { status: 403, headers: cors })
    }
    const member = await db.workspaceMember.findUnique({
      where: { userId_workspaceId: { userId: session.user.id, workspaceId: agent.workspaceId } },
      select: { role: true },
    })
    if (!member) return NextResponse.json({ error: 'Access denied' }, { status: 403, headers: cors })
  }

  try {
    const result = await executeTool(name, args, agent.locationId, false, agent.id, 'voice')
    return NextResponse.json({ result }, { headers: cors })
  } catch (err) {
    console.error('[GeminiVoice tool] exec failed:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Tool execution failed' },
      { status: 500, headers: cors },
    )
  }
}
