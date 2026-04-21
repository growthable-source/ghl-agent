import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'

/**
 * GET /api/workspaces/:workspaceId/templates
 *
 * Returns the templates visible to this workspace: every official one
 * (workspaceId=null) plus this workspace's own saved templates. Saved
 * templates from other workspaces are never returned here — tenant
 * isolation matters even when you know the id.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ workspaceId: string }> },
) {
  const { workspaceId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  try {
    const templates = await db.agentTemplate.findMany({
      where: {
        // Official templates OR templates owned by this workspace
        OR: [{ workspaceId: null }, { workspaceId }],
      },
      // Workspace saves surface above official templates so the user's
      // recent work is top-of-list. Within each group, sort by popularity.
      orderBy: [
        { workspaceId: 'desc' },   // non-null (workspace) > null (official)
        { isOfficial: 'desc' },
        { installCount: 'desc' },
        { createdAt: 'desc' },
      ],
    })
    return NextResponse.json({ templates })
  } catch {
    return NextResponse.json({ templates: [], notMigrated: true })
  }
}
