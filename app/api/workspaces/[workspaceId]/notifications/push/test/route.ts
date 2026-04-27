import { NextRequest, NextResponse } from 'next/server'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'
import { sendPushToUser } from '@/lib/web-push'

type Params = { params: Promise<{ workspaceId: string }> }

/**
 * POST → fire a "Hello from Voxility" push to all of the calling user's
 * registered browsers. Used by the "Send test" button on the prefs page
 * to verify the subscription round-trip works.
 */
export async function POST(_req: NextRequest, { params }: Params) {
  const { workspaceId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access
  const userId = access.session.user!.id!

  const result = await sendPushToUser(userId, workspaceId, {
    title: '👋 Browser push works',
    body: 'You\'ll receive notifications here for the events you opted into.',
    link: `/dashboard/${workspaceId}/settings/notifications`,
    severity: 'info',
    tag: 'voxility-test',
  })

  if (result.delivered === 0) {
    return NextResponse.json({
      error: 'No active subscriptions for this device. Click "Enable browser push" first.',
      pruned: result.pruned,
    }, { status: 400 })
  }
  return NextResponse.json({ ok: true, ...result })
}
