import { NextRequest, NextResponse } from 'next/server'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'
import { buildWorkspaceDigest } from '@/lib/digest-builder'

type Params = { params: Promise<{ workspaceId: string }> }

/**
 * GET /api/workspaces/:workspaceId/digest?week=<ISO date>
 *
 * Weekly digest of agent activity. Returns per-agent stats and workspace
 * totals for the week ending at the given date (default: now). The actual
 * computation lives in lib/digest-builder so the cron route can reuse it.
 */
export async function GET(req: NextRequest, { params }: Params) {
  const { workspaceId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  const url = new URL(req.url)
  const weekParam = url.searchParams.get('week')
  const weekEnd = weekParam ? new Date(weekParam) : new Date()

  const payload = await buildWorkspaceDigest(workspaceId, weekEnd)
  return NextResponse.json(payload)
}
