/**
 * GET /api/workspaces/[workspaceId]/setup-status
 *
 * Drives the dashboard's first-run checklist. Reuses the same
 * workspace-state read the co-pilot uses (lib/copilot/setup-state) so
 * "what counts as set up" has ONE definition. Returns the handful of
 * booleans the checklist renders — nothing heavy.
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'
import { getWorkspaceSetupState } from '@/lib/copilot/setup-state'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  const s = await getWorkspaceSetupState(workspaceId)

  const steps = {
    createAgent: s.agentCount > 0,
    addKnowledge: s.knowledgeEntryCount > 0 || s.knowledgeCollectionCount > 0,
    connectCrm: s.crmLocations.length > 0,
    deployChannel: s.deployedChannels.length > 0,
    activateAgent: s.activeAgentCount > 0,
  }
  const done = Object.values(steps).filter(Boolean).length
  const total = Object.keys(steps).length

  return NextResponse.json({
    steps,
    done,
    total,
    complete: done === total,
    // The checklist hides itself once everything's done — the
    // workspace name lets the greeting feel less generic.
    workspaceName: s.workspaceName,
  })
}
