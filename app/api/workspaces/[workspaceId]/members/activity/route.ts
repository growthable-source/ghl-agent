import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'

type Params = { params: Promise<{ workspaceId: string }> }

/**
 * GET /api/workspaces/:id/members/activity?days=7
 *
 * Returns presence-event history for every member in the workspace,
 * grouped per-member. The members page uses this to render a
 * timeline of when each operator went online vs away.
 *
 * Events are stored on every PATCH of /me/presence. Pre-migration
 * workspaces return an empty `events` array per member rather than
 * crashing.
 */
export async function GET(req: NextRequest, { params }: Params) {
  const { workspaceId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  const url = new URL(req.url)
  const days = Math.max(1, Math.min(30, Number(url.searchParams.get('days')) || 7))
  const since = new Date(Date.now() - days * 86_400_000)

  const members = await db.workspaceMember.findMany({
    where: { workspaceId },
    select: {
      id: true,
      isAvailable: true,
      availabilityChangedAt: true,
      user: { select: { id: true, name: true, email: true, image: true } },
    },
    orderBy: { createdAt: 'asc' },
  }).catch(() => [])

  let events: Array<{ memberId: string; state: string; source: string; createdAt: Date }> = []
  try {
    events = await (db as any).memberPresenceEvent.findMany({
      where: { workspaceId, createdAt: { gte: since } },
      select: { memberId: true, state: true, source: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
      take: 2000,
    })
  } catch {
    // Migration not applied yet — return empty event lists per member.
  }

  // Group events by member for the UI. Keep newest first.
  const byMember = new Map<string, typeof events>()
  for (const e of events) {
    const list = byMember.get(e.memberId) ?? []
    list.push(e)
    byMember.set(e.memberId, list)
  }

  return NextResponse.json({
    days,
    members: members.map(m => ({
      id: m.id,
      user: m.user,
      isAvailable: m.isAvailable !== false,
      availabilityChangedAt: m.availabilityChangedAt?.toISOString() ?? null,
      events: (byMember.get(m.id) ?? []).map(e => ({
        state: e.state,
        source: e.source,
        at: e.createdAt.toISOString(),
      })),
    })),
  })
}
