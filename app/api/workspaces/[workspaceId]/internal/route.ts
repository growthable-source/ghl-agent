import { NextRequest, NextResponse } from 'next/server'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'
import { isInternalWorkspace } from '@/lib/internal-workspace'

/**
 * GET /api/workspaces/:workspaceId/internal
 *
 * Returns { internal: boolean } — whether the workspace is considered
 * internal (any @voxility.ai member or allowlisted email). Used by the
 * billing UI to decide whether to show the "no card required" banner
 * and swap copy on the plan CTAs.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ workspaceId: string }> },
) {
  const { workspaceId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  const internal = await isInternalWorkspace(workspaceId)
  return NextResponse.json({ internal })
}
