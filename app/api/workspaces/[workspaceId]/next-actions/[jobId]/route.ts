import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'

type Params = { params: Promise<{ workspaceId: string; jobId: string }> }

/**
 * PATCH /api/workspaces/:workspaceId/next-actions/:jobId
 * Cancel a scheduled follow-up job.
 *
 * Body: { action: 'cancel' }
 */
export async function PATCH(req: NextRequest, { params }: Params) {
  const { workspaceId, jobId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  let body: { action?: string } = {}
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  if (body.action !== 'cancel') {
    return NextResponse.json({ error: 'Unsupported action' }, { status: 400 })
  }

  // Verify the job belongs to this workspace (via location)
  const locations = await db.location.findMany({
    where: { workspaceId },
    select: { id: true },
  })
  const locationIds = locations.map(l => l.id)

  const job = await db.followUpJob.findUnique({
    where: { id: jobId },
    select: { id: true, locationId: true, status: true },
  })

  if (!job || !locationIds.includes(job.locationId)) {
    return NextResponse.json({ error: 'Job not found' }, { status: 404 })
  }

  if (job.status !== 'SCHEDULED') {
    return NextResponse.json({
      error: `Cannot cancel job with status ${job.status}`,
    }, { status: 400 })
  }

  try {
    const updated = await db.followUpJob.update({
      where: { id: jobId },
      data: { status: 'CANCELLED', cancelledAt: new Date() },
    })
    return NextResponse.json({ job: updated })
  } catch (err: any) {
    console.error('[NextActions] Failed to cancel job:', err.message)
    return NextResponse.json({ error: err.message || 'Failed to cancel job' }, { status: 500 })
  }
}
