/**
 * PATCH /api/workspaces/[workspaceId]/ad-recommendations/[id]
 *   Body: { status: 'pending' | 'accepted' | 'dismissed' | 'snoozed' }
 *   Operator marks a recommendation as actioned / dismissed.
 *
 * DELETE /api/workspaces/[workspaceId]/ad-recommendations/[id]
 *   Hard-delete a recommendation (rarely used — prefer status='dismissed').
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'

export const dynamic = 'force-dynamic'

type Params = { workspaceId: string; id: string }

const ALLOWED_STATUSES = new Set(['pending', 'accepted', 'dismissed', 'snoozed'])

async function recBelongsToWorkspace(workspaceId: string, id: string) {
  const rec = await db.adRecommendation.findUnique({
    where: { id },
    select: { id: true, metaAccountId: true, googleAccountId: true },
  })
  if (!rec) return null
  if (rec.metaAccountId) {
    const owns = await db.metaAdAccount.findFirst({ where: { id: rec.metaAccountId, workspaceId }, select: { id: true } })
    if (owns) return rec
  }
  if (rec.googleAccountId) {
    const owns = await db.googleAdAccount.findFirst({ where: { id: rec.googleAccountId, workspaceId }, select: { id: true } })
    if (owns) return rec
  }
  return null
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<Params> }) {
  const { workspaceId, id } = await ctx.params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  const owns = await recBelongsToWorkspace(workspaceId, id)
  if (!owns) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  const body = (await req.json().catch(() => ({}))) as { status?: string }
  if (!body.status || !ALLOWED_STATUSES.has(body.status)) {
    return NextResponse.json(
      { error: `status must be one of ${Array.from(ALLOWED_STATUSES).join(', ')}` },
      { status: 400 },
    )
  }
  const updated = await db.adRecommendation.update({
    where: { id },
    data: { status: body.status },
  })
  return NextResponse.json({ recommendation: updated })
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<Params> }) {
  const { workspaceId, id } = await ctx.params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  const owns = await recBelongsToWorkspace(workspaceId, id)
  if (!owns) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  await db.adRecommendation.delete({ where: { id } })
  return NextResponse.json({ ok: true })
}
