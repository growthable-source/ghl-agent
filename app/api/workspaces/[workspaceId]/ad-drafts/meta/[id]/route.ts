/**
 * GET    /api/workspaces/[workspaceId]/ad-drafts/meta/[id]
 *        Fetch a single draft.
 *
 * PUT    /api/workspaces/[workspaceId]/ad-drafts/meta/[id]
 *        Update name + payload (operator hand-edits before launch).
 *
 * DELETE /api/workspaces/[workspaceId]/ad-drafts/meta/[id]
 *        Discard the draft. Doesn't touch any launched Meta campaign —
 *        externalCampaignId, if set, is informational only.
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'
import type { MetaCampaignDraft } from '@/lib/ad-meta-types'

export const dynamic = 'force-dynamic'

type Params = { workspaceId: string; id: string }

export async function GET(_req: NextRequest, ctx: { params: Promise<Params> }) {
  const { workspaceId, id } = await ctx.params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  const draft = await db.adCampaignDraft.findFirst({
    where: { id, workspaceId, platform: 'meta' },
    select: {
      id: true,
      name: true,
      platform: true,
      payload: true,
      aiReasoning: true,
      externalCampaignId: true,
      campaignId: true,
      createdAt: true,
      updatedAt: true,
    },
  })
  if (!draft) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  return NextResponse.json({ draft })
}

export async function PUT(req: NextRequest, ctx: { params: Promise<Params> }) {
  const { workspaceId, id } = await ctx.params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  const existing = await db.adCampaignDraft.findFirst({
    where: { id, workspaceId, platform: 'meta' },
    select: { id: true, externalCampaignId: true },
  })
  if (!existing) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  // Block edits to drafts that have already been deployed to Meta. The
  // payload + Meta state would diverge; operator should clone instead.
  if (existing.externalCampaignId) {
    return NextResponse.json(
      { error: 'already_launched', detail: 'Draft has already been launched to Meta. Edit in Meta Ads Manager or duplicate this draft.' },
      { status: 409 },
    )
  }

  const body = (await req.json().catch(() => null)) as
    | { name?: string; payload?: MetaCampaignDraft }
    | null
  if (!body) return NextResponse.json({ error: 'request body required' }, { status: 400 })

  const data: { name?: string; payload?: object; aiReasoning?: string } = {}
  if (typeof body.name === 'string' && body.name.trim()) data.name = body.name.trim()
  if (body.payload && typeof body.payload === 'object') {
    data.payload = body.payload as object
    if (typeof body.payload.strategic_rationale === 'string') {
      data.aiReasoning = body.payload.strategic_rationale
    }
  }
  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: 'no editable fields in body' }, { status: 400 })
  }

  const updated = await db.adCampaignDraft.update({
    where: { id },
    data,
    select: {
      id: true,
      name: true,
      platform: true,
      payload: true,
      aiReasoning: true,
      externalCampaignId: true,
      campaignId: true,
      createdAt: true,
      updatedAt: true,
    },
  })
  return NextResponse.json({ draft: updated })
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<Params> }) {
  const { workspaceId, id } = await ctx.params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  const existing = await db.adCampaignDraft.findFirst({
    where: { id, workspaceId, platform: 'meta' },
    select: { id: true, name: true },
  })
  if (!existing) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  await db.adCampaignDraft.delete({ where: { id } })
  return NextResponse.json({ ok: true, deleted: existing })
}
