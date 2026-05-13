/**
 * POST /api/voice/tool-call
 *
 * Server-side tool execution for the XAI realtime voice path. The browser
 * receives a function_call event from XAI, POSTs the call here with the
 * agent it's running, and gets back the JSON result string. The browser
 * then sends the result back to XAI via conversation.item.create (type
 * function_call_output) and triggers response.create to continue.
 *
 * Auth: must be a signed-in workspace member, and the agent must belong
 * to a workspace the member has access to. Tool execution can write to
 * Shopify (discount codes, draft orders, interest signals) and CRM —
 * not an endpoint we expose publicly.
 *
 * The actual dispatch reuses lib/agent/execute-tool.ts so the voice path
 * and the text path go through the exact same handler. Same validation,
 * same guardrails (discount caps, etc.), same error shapes.
 */

import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { executeTool } from '@/lib/agent/execute-tool'
import { getCrmAdapter } from '@/lib/crm/factory'

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'not_authenticated' }, { status: 401 })
  }

  let body: { agentId?: string; tool?: string; args?: Record<string, unknown> } = {}
  try { body = await req.json() } catch {}
  const { agentId, tool } = body
  const args = (body.args ?? {}) as Record<string, unknown>

  if (!agentId || !tool) {
    return NextResponse.json({ error: 'agentId and tool are required' }, { status: 400 })
  }

  // Resolve agent + verify workspace access
  const agent = await db.agent.findUnique({
    where: { id: agentId },
    select: {
      id: true,
      locationId: true,
      workspaceId: true,
      enabledTools: true,
      workspace: {
        select: {
          members: { where: { userId: session.user.id }, select: { userId: true } },
        },
      },
    },
  })
  if (!agent) {
    return NextResponse.json({ error: 'agent_not_found' }, { status: 404 })
  }
  if (!agent.workspaceId || agent.workspace?.members.length === 0) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  // Tool gating: the agent has to have this tool enabled. Stops a voice
  // session from invoking tools the operator explicitly turned off.
  if (!agent.enabledTools.includes(tool)) {
    return NextResponse.json({ error: 'tool_not_enabled', tool }, { status: 403 })
  }

  // Resolve adapter for CRM-touching tools. For voice, this is mostly
  // the agent's primary location adapter — same path the text agent
  // uses. Errors here are caught by the dispatcher's try/catch and
  // surfaced as JSON-strings; we propagate them up unchanged.
  let crm: Awaited<ReturnType<typeof getCrmAdapter>> | null = null
  try {
    crm = await getCrmAdapter(agent.locationId)
  } catch (err: any) {
    console.warn('[voice tool-call] CRM adapter resolve failed:', err?.message)
  }

  try {
    const result = await executeTool(
      tool,
      args,
      agent.locationId,
      /* sandbox */ false,
      agent.id,
      /* channel */ 'Voice',
      /* conversationProviderId */ undefined,
      crm ?? undefined,
      /* deferredSend */ undefined,
      /* fieldOverwriteMap */ undefined,
      /* handoverCapture */ undefined,
      agent.workspaceId,
    )
    // executeTool returns a JSON string. Pass it through as the result
    // field so the client can drop it straight into XAI's
    // function_call_output without re-stringifying.
    return NextResponse.json({ result })
  } catch (err: any) {
    console.error('[voice tool-call] dispatcher threw:', err)
    return NextResponse.json({
      result: JSON.stringify({ error: err?.message || 'tool_dispatch_failed' }),
    })
  }
}
