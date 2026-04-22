import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ workspaceId: string; id: string }> }

/**
 * Fetch a single simulation (for the detail-page poll). Returns
 * transcript + status so the UI can stream progress while the sim is
 * running (the sync endpoint only returns after completion, but queued
 * sims picked up by cron might be observed mid-flight here).
 */
export async function GET(_req: NextRequest, { params }: Params) {
  const { workspaceId, id } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  const sim = await db.simulation.findFirst({
    where: { id, workspaceId },
    include: {
      agent: { select: { id: true, name: true } },
    },
  })
  if (!sim) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ simulation: sim })
}
