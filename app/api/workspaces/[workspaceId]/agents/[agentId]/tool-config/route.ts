/**
 * Per-tool config CRUD for one agent. Auth: workspace member.
 *
 * GET returns the merged view (catalog defaults + per-(agent, tool)
 * overrides) for every tool in AGENT_TOOLS, plus the agent's
 * toolAutonomyMode. The UI consumes this directly.
 *
 * PATCH accepts a list of tool deltas — upserts an AgentToolConfig row
 * per tool. Empty-string useWhen is normalised to null (fall back to
 * catalog). Setting onFailure to something other than 'canned_message'
 * clears onFailureMessage to avoid stale strings.
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'
import { resolveAgentToolConfig, type OnFailureMode } from '@/lib/agent/tool-config'

type Params = { params: Promise<{ workspaceId: string; agentId: string }> }

const VALID_ON_FAILURE: OnFailureMode[] = [
  'default', 'transfer_to_human', 'canned_message', 'silent_skip',
]
const VALID_AUTONOMY = ['guided', 'autonomous']

export async function GET(_req: NextRequest, { params }: Params) {
  const { workspaceId, agentId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  const agent = await db.agent.findFirst({
    where: { id: agentId, workspaceId },
    select: { id: true, toolAutonomyMode: true, enabledTools: true },
  })
  if (!agent) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  const resolved = await resolveAgentToolConfig(agentId)
  return NextResponse.json({
    autonomyMode: (agent as any).toolAutonomyMode ?? 'guided',
    enabledTools: agent.enabledTools,
    tools: Array.from(resolved.values()),
  })
}

interface ToolDelta {
  toolName: string
  enabled?: boolean
  useWhen?: string | null
  onFailure?: string
  onFailureMessage?: string | null
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const { workspaceId, agentId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  const agent = await db.agent.findFirst({
    where: { id: agentId, workspaceId },
    select: { id: true },
  })
  if (!agent) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  const body = await req.json().catch(() => ({})) as {
    autonomyMode?: string
    tools?: ToolDelta[]
  }

  // Autonomy mode
  if (typeof body.autonomyMode === 'string') {
    if (!VALID_AUTONOMY.includes(body.autonomyMode)) {
      return NextResponse.json({ error: 'invalid_autonomy_mode' }, { status: 400 })
    }
    await db.agent.update({
      where: { id: agentId },
      data: { toolAutonomyMode: body.autonomyMode } as any,
    })
  }

  // Tool deltas — upsert each row
  if (Array.isArray(body.tools)) {
    for (const delta of body.tools) {
      if (typeof delta.toolName !== 'string' || delta.toolName.length === 0) continue

      // Normalize: empty-string useWhen → null. Clear onFailureMessage when
      // onFailure is not canned_message (caller can still pass it explicitly).
      const useWhen = typeof delta.useWhen === 'string'
        ? (delta.useWhen.length === 0 ? null : delta.useWhen)
        : undefined

      const onFailure = delta.onFailure && VALID_ON_FAILURE.includes(delta.onFailure as OnFailureMode)
        ? delta.onFailure
        : undefined
      const onFailureMessage = delta.onFailureMessage === undefined
        ? undefined
        : (onFailure && onFailure !== 'canned_message' ? null : delta.onFailureMessage)

      const data: any = {}
      if (typeof delta.enabled === 'boolean') data.enabled = delta.enabled
      if (useWhen !== undefined) data.useWhen = useWhen
      if (onFailure !== undefined) data.onFailure = onFailure
      if (onFailureMessage !== undefined) data.onFailureMessage = onFailureMessage

      if (Object.keys(data).length === 0) continue

      await db.agentToolConfig.upsert({
        where: { agentId_toolName: { agentId, toolName: delta.toolName } },
        create: { agentId, toolName: delta.toolName, ...data },
        update: data,
      })
    }
  }

  const resolved = await resolveAgentToolConfig(agentId)
  const updated = await db.agent.findUnique({
    where: { id: agentId },
    select: { toolAutonomyMode: true } as any,
  })
  return NextResponse.json({
    autonomyMode: (updated as any)?.toolAutonomyMode ?? 'guided',
    tools: Array.from(resolved.values()),
  })
}
