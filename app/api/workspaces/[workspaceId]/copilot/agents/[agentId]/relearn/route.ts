/**
 * POST /api/workspaces/[workspaceId]/copilot/agents/[agentId]/relearn
 *
 * Re-distill the agent's steps + playbook from its already-processed
 * sources, without re-uploading. Useful after editing the source set
 * or when the distillation logic improves. Runs in the background via
 * after() so the request returns immediately; the editor polls.
 */

import { NextRequest, NextResponse } from 'next/server'
import { after } from 'next/server'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'
import { db } from '@/lib/db'

type Params = { params: Promise<{ workspaceId: string; agentId: string }> }

export const maxDuration = 120

export async function POST(_req: NextRequest, { params }: Params) {
  const { workspaceId, agentId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  const agent = await db.copilotAgent.findFirst({
    where: { id: agentId, workspaceId },
    select: { id: true, recordings: { where: { status: 'done' }, select: { id: true } } },
  })
  if (!agent) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (agent.recordings.length === 0) {
    return NextResponse.json({ error: 'Upload at least one recording or document first.' }, { status: 400 })
  }

  after(async () => {
    try {
      const { distillPlaybook } = await import('@/lib/copilot/recordings')
      await distillPlaybook(agentId)
    } catch (err) {
      console.error('[relearn] failed:', err instanceof Error ? err.message : err)
    }
  })

  return NextResponse.json({ ok: true, sources: agent.recordings.length })
}
