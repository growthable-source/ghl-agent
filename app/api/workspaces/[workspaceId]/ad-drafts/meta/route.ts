/**
 * GET  /api/workspaces/[workspaceId]/ad-drafts/meta
 *      List Meta ad-campaign drafts (newest first).
 *
 * POST /api/workspaces/[workspaceId]/ad-drafts/meta
 *      Generate a new draft via Claude. Body shape: MetaCampaignIntake +
 *      optional { campaignId } to attach the draft to a funnel campaign.
 *      Persists to AdCampaignDraft and returns the row.
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { auth } from '@/lib/auth'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'
import { generateMetaCampaign } from '@/lib/ad-meta-generator'
import type { MetaCampaignIntake } from '@/lib/ad-meta-types'
import Anthropic from '@anthropic-ai/sdk'

export const dynamic = 'force-dynamic'

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ workspaceId: string }> },
) {
  const { workspaceId } = await ctx.params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  const drafts = await db.adCampaignDraft.findMany({
    where: { workspaceId, platform: 'meta' },
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
    orderBy: { createdAt: 'desc' },
    take: 100,
  })
  return NextResponse.json({ drafts })
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ workspaceId: string }> },
) {
  const { workspaceId } = await ctx.params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access
  const session = await auth()
  const userId = session?.user?.id ?? 'system'

  const body = (await req.json().catch(() => null)) as
    | (MetaCampaignIntake & { campaignId?: string })
    | null
  if (!body) {
    return NextResponse.json({ error: 'request body required' }, { status: 400 })
  }
  if (!body.business_name || !body.product_offer || !body.dream_outcome || !body.destination_url) {
    return NextResponse.json(
      { error: 'business_name, product_offer, dream_outcome, and destination_url are required' },
      { status: 400 },
    )
  }
  if (!body.daily_budget_cents || body.daily_budget_cents < 100) {
    return NextResponse.json({ error: 'daily_budget_cents must be at least 100 (Meta min $1/day)' }, { status: 400 })
  }

  // If campaignId is supplied, confirm it belongs to this workspace —
  // prevents cross-workspace draft attachment via a tampered request.
  if (body.campaignId) {
    const camp = await db.campaign.findFirst({
      where: { id: body.campaignId, workspaceId },
      select: { id: true },
    })
    if (!camp) {
      return NextResponse.json({ error: 'campaignId not found in this workspace' }, { status: 400 })
    }
  }

  try {
    const draft = await generateMetaCampaign({ intake: body })

    const row = await db.adCampaignDraft.create({
      data: {
        workspaceId,
        platform: 'meta',
        name: draft.name,
        // payload is the entire MetaCampaignDraft. AI reasoning lives in
        // the strategic_rationale field of the payload AND is also
        // pulled out into aiReasoning for cheaper UI list rendering.
        payload: draft as object,
        aiReasoning: draft.strategic_rationale,
        createdBy: userId,
        ...(body.campaignId ? { campaignId: body.campaignId } : {}),
      },
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
    return NextResponse.json({ draft: row })
  } catch (err) {
    if (err instanceof Anthropic.RateLimitError) {
      return NextResponse.json({ error: 'rate_limited', detail: err.message }, { status: 429 })
    }
    if (err instanceof Anthropic.APIError) {
      return NextResponse.json({ error: 'anthropic_error', detail: err.message }, { status: 502 })
    }
    const msg = err instanceof Error ? err.message : 'generation_failed'
    console.error('[ad-drafts/meta] generate failed:', msg)
    return NextResponse.json({ error: 'generation_failed', detail: msg }, { status: 500 })
  }
}
