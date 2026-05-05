/**
 * Single-ad-account routes.
 *
 *   PATCH  — toggle isActive or autoPilotEnabled (operator pause / resume).
 *   DELETE — disconnect the ad account. Cascades to all related metrics,
 *            drafts, recommendations, activity log entries (per Cascade
 *            FKs in the migration).
 *
 * Path: /api/workspaces/[workspaceId]/ad-accounts/[provider]/[id]
 *   provider: "meta" | "google"
 *   id:       MetaAdAccount.id | GoogleAdAccount.id
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'

export const dynamic = 'force-dynamic'

type Params = { workspaceId: string; provider: string; id: string }

export async function PATCH(req: NextRequest, ctx: { params: Promise<Params> }) {
  const { workspaceId, provider, id } = await ctx.params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  if (provider !== 'meta' && provider !== 'google') {
    return NextResponse.json({ error: `unknown provider "${provider}"` }, { status: 400 })
  }

  const body = (await req.json().catch(() => ({}))) as Partial<{
    isActive: boolean
    autoPilotEnabled: boolean
  }>

  const data: { isActive?: boolean; autoPilotEnabled?: boolean } = {}
  if (typeof body.isActive === 'boolean') data.isActive = body.isActive
  if (typeof body.autoPilotEnabled === 'boolean') data.autoPilotEnabled = body.autoPilotEnabled
  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: 'no editable fields in body' }, { status: 400 })
  }

  if (provider === 'meta') {
    const existing = await db.metaAdAccount.findFirst({
      where: { id, workspaceId },
      select: { id: true },
    })
    if (!existing) return NextResponse.json({ error: 'not_found' }, { status: 404 })
    const updated = await db.metaAdAccount.update({
      where: { id },
      data,
      select: {
        id: true,
        accountName: true,
        metaAccountId: true,
        isActive: true,
        autoPilotEnabled: true,
        updatedAt: true,
      },
    })
    await db.adActivityLog.create({
      data: {
        metaAccountId: id,
        actionType: 'account_settings',
        description: describeChange(data),
        performedBy: access.session.user?.email ?? access.session.user?.id ?? 'user',
        details: data as object,
      },
    }).catch(() => {})
    return NextResponse.json({ account: updated })
  }

  // provider === 'google'
  const existing = await db.googleAdAccount.findFirst({
    where: { id, workspaceId },
    select: { id: true },
  })
  if (!existing) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  const updated = await db.googleAdAccount.update({
    where: { id },
    data,
    select: {
      id: true,
      accountName: true,
      googleCustomerId: true,
      isActive: true,
      autoPilotEnabled: true,
      updatedAt: true,
    },
  })
  await db.adActivityLog.create({
    data: {
      googleAccountId: id,
      actionType: 'account_settings',
      description: describeChange(data),
      performedBy: access.session.user?.email ?? access.session.user?.id ?? 'user',
      details: data as object,
    },
  }).catch(() => {})
  return NextResponse.json({ account: updated })
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<Params> }) {
  const { workspaceId, provider, id } = await ctx.params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  if (provider !== 'meta' && provider !== 'google') {
    return NextResponse.json({ error: `unknown provider "${provider}"` }, { status: 400 })
  }

  if (provider === 'meta') {
    const existing = await db.metaAdAccount.findFirst({
      where: { id, workspaceId },
      select: { id: true, accountName: true },
    })
    if (!existing) return NextResponse.json({ error: 'not_found' }, { status: 404 })
    await db.metaAdAccount.delete({ where: { id } })
    return NextResponse.json({ ok: true, deleted: existing })
  }

  const existing = await db.googleAdAccount.findFirst({
    where: { id, workspaceId },
    select: { id: true, accountName: true },
  })
  if (!existing) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  await db.googleAdAccount.delete({ where: { id } })
  return NextResponse.json({ ok: true, deleted: existing })
}

function describeChange(data: { isActive?: boolean; autoPilotEnabled?: boolean }): string {
  const bits: string[] = []
  if (typeof data.isActive === 'boolean') {
    bits.push(data.isActive ? 'Account resumed' : 'Account paused')
  }
  if (typeof data.autoPilotEnabled === 'boolean') {
    bits.push(data.autoPilotEnabled ? 'Autopilot enabled' : 'Autopilot disabled')
  }
  return bits.join(' · ') || 'Settings updated'
}
