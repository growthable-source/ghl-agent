/**
 * POST applies a preset to the agent. Writes Agent.toolAutonomyMode +
 * Agent.presetId and upserts AgentToolConfig rows for every delta in
 * the chosen preset. Tools not in the preset are left as-is (catalog
 * defaults if no existing override).
 *
 * Idempotent — re-applying produces the same final state.
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'
import { applyPresetWithWorkspaceLookup } from '@/lib/agent/presets'
import { resolveAgentToolConfig } from '@/lib/agent/tool-config'

type Params = { params: Promise<{ workspaceId: string; agentId: string }> }

export async function POST(req: NextRequest, { params }: Params) {
  const { workspaceId, agentId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  const agent = await db.agent.findFirst({
    where: { id: agentId, workspaceId },
    select: { id: true },
  })
  if (!agent) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  const body = (await req.json().catch(() => ({}))) as { presetId?: string }
  if (typeof body.presetId !== 'string' || body.presetId.length === 0) {
    return NextResponse.json({ error: 'missing_presetId' }, { status: 400 })
  }

  const preset = await applyPresetWithWorkspaceLookup(agentId, workspaceId, body.presetId)
  if (!preset) {
    return NextResponse.json({ error: 'unknown_preset' }, { status: 400 })
  }

  const resolved = await resolveAgentToolConfig(agentId)
  const updated = await db.agent.findUnique({
    where: { id: agentId },
    select: { toolAutonomyMode: true, presetId: true } as any,
  })
  return NextResponse.json({
    autonomyMode: (updated as any)?.toolAutonomyMode ?? 'guided',
    presetId: (updated as any)?.presetId ?? null,
    tools: Array.from(resolved.values()),
  })
}
