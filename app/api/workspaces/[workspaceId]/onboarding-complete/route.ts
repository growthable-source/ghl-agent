import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'

export async function PATCH(
  _req: NextRequest,
  { params }: { params: Promise<{ workspaceId: string }> }
) {
  const { workspaceId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access
  // Mark all locations in this workspace as onboarding complete
  await db.location.updateMany({
    where: { workspaceId },
    data: { onboardingCompletedAt: new Date() },
  })
  return NextResponse.json({ success: true })
}
