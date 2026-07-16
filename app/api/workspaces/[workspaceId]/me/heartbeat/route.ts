import { NextRequest, NextResponse, after } from 'next/server'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'
import { recordMemberActivity } from '@/lib/presence'

type Params = { params: Promise<{ workspaceId: string }> }

/**
 * POST — dashboard activity heartbeat. The PresenceHeartbeat component
 * (mounted in the workspace layout) posts here at most once a minute
 * while the member is actually producing input. Feeds auto-away's
 * lastActivityAt and auto-restores members the system flipped away.
 *
 * Response echoes the caller's current availability so the inbox pill
 * can stay truthful without a second request.
 */
export async function POST(_req: NextRequest, { params }: Params) {
  const { workspaceId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  const result = await recordMemberActivity(workspaceId, access.session.user!.id)

  // Coming back online can unblock waiting visitors — advance the queue
  // off the response path.
  if (result?.restored) {
    after(async () => {
      try {
        const { advanceQueue } = await import('@/lib/widget-routing')
        await advanceQueue(workspaceId)
      } catch (err: any) {
        console.warn('[heartbeat] advanceQueue failed:', err?.message)
      }
    })
  }

  return NextResponse.json({
    ok: true,
    // null result = activity columns not migrated yet — report Available
    // so nothing downstream reacts.
    isAvailable: result?.isAvailable ?? true,
    restored: result?.restored ?? false,
  })
}
