/**
 * GET available agent presets for the picker UI. Returns the static
 * AGENT_PRESETS registry plus the currently-applied preset id on this
 * agent (informational — drives the "currently using: Booking Bot"
 * label in the UI).
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'
import { AGENT_PRESETS } from '@/lib/agent/presets'

type Params = { params: Promise<{ workspaceId: string; agentId: string }> }

export async function GET(_req: NextRequest, { params }: Params) {
  const { workspaceId, agentId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  const agent = await db.agent.findFirst({
    where: { id: agentId, workspaceId },
    select: { presetId: true } as any,
  })
  if (!agent) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }

  return NextResponse.json({
    presets: AGENT_PRESETS,
    current: (agent as any).presetId ?? null,
  })
}
