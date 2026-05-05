/**
 * GET  /api/workspaces/[workspaceId]/ad-drafts/google — list
 * POST /api/workspaces/[workspaceId]/ad-drafts/google — generate
 *
 * Mirror of /ad-drafts/meta but emits a GoogleCampaignDraft via
 * lib/ad-google-generator. Persists to AdCampaignDraft with platform=
 * 'google' so the same UI primitives can render either kind.
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { auth } from '@/lib/auth'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'
import { generateGoogleCampaign } from '@/lib/ad-google-generator'
import type { GoogleCampaignIntake } from '@/lib/ad-google-types'
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
    where: { workspaceId, platform: 'google' },
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
    | (GoogleCampaignIntake & { campaignId?: string })
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
    return NextResponse.json({ error: 'daily_budget_cents must be at least 100' }, { status: 400 })
  }

  if (body.campaignId) {
    const camp = await db.campaign.findFirst({ where: { id: body.campaignId, workspaceId }, select: { id: true } })
    if (!camp) return NextResponse.json({ error: 'campaignId not found in this workspace' }, { status: 400 })
  }

  try {
    const draft = await generateGoogleCampaign({ intake: body })
    const row = await db.adCampaignDraft.create({
      data: {
        workspaceId,
        platform: 'google',
        name: draft.name,
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
    console.error('[ad-drafts/google] generate failed:', msg)
    return NextResponse.json({ error: 'generation_failed', detail: msg }, { status: 500 })
  }
}
