/**
 * POST /api/copilot/sessions/[sessionId]/tool
 *
 * Server-side execution of one read-only Co-Pilot tool call. The
 * realtime model raises the call over the browser WebSocket; the
 * browser ferries it here; we execute against the workspace with
 * proper scoping, log the CopilotToolCall row (with latency, the
 * §8 cost/latency telemetry), and return the result text for the
 * client to feed back via sendToolResponse.
 *
 * v0 tools are read-only by construction (lib/copilot/tools.ts) —
 * there is no write dispatch here at all, so a compromised client
 * can at most read state the logged-in user could already see in
 * the dashboard.
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { executeCopilotTool } from '@/lib/copilot/tools'
import { requireActiveCopilotSession } from '@/lib/copilot/session-auth'

type Params = { params: Promise<{ sessionId: string }> }

export async function POST(req: NextRequest, { params }: Params) {
  const { sessionId } = await params
  const session = await requireActiveCopilotSession(sessionId)
  if (session instanceof NextResponse) return session

  const body = (await req.json().catch(() => ({}))) as {
    name?: string
    args?: Record<string, unknown>
  }
  if (!body.name || typeof body.name !== 'string') {
    return NextResponse.json({ error: 'tool name required' }, { status: 400 })
  }
  const args = body.args && typeof body.args === 'object' ? body.args : {}

  const startedAt = Date.now()
  const result = await executeCopilotTool(body.name, args, {
    workspaceId: session.workspaceId,
    workflowKey: session.workflowKey,
  })
  const latencyMs = Date.now() - startedAt

  // Log fire-and-forget style but awaited — the write is cheap and we
  // want toolCallCount consistent for the cost telemetry.
  await Promise.all([
    db.copilotToolCall.create({
      data: {
        sessionId: session.id,
        workspaceId: session.workspaceId,
        toolName: body.name,
        args: args as object,
        resultSummary: result.slice(0, 2000),
        latencyMs,
      },
    }),
    db.copilotSession.update({
      where: { id: session.id },
      data: { toolCallCount: { increment: 1 } },
    }),
  ]).catch(err => console.error('[Copilot tool] logging failed:', err))

  return NextResponse.json({ result, latencyMs })
}
