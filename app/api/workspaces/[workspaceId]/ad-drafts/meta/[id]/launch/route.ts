/**
 * POST /api/workspaces/[workspaceId]/ad-drafts/meta/[id]/launch
 *
 * Deploys a Meta ad-campaign draft to the Marketing API. Body:
 *   { metaAdAccountId: string; pageId?: string }
 *
 * pageId is required for ad creatives (link ads). If absent, the
 * orchestrator creates the campaign + ad sets but no ads, and returns
 * per-ad errors so the operator knows what to fix.
 *
 * The launched campaign starts PAUSED in Meta — the operator activates
 * it from Meta Ads Manager (or, eventually, a Xovera-side toggle).
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { auth } from '@/lib/auth'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'
import { launchCampaign } from '@/lib/ad-meta-client'
import type { MetaCampaignDraft } from '@/lib/ad-meta-types'

export const dynamic = 'force-dynamic'

type Params = { workspaceId: string; id: string }

export async function POST(req: NextRequest, ctx: { params: Promise<Params> }) {
  const { workspaceId, id } = await ctx.params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  const body = (await req.json().catch(() => ({}))) as { metaAdAccountId?: string; pageId?: string }
  if (!body.metaAdAccountId) {
    return NextResponse.json({ error: 'metaAdAccountId is required' }, { status: 400 })
  }

  const draft = await db.adCampaignDraft.findFirst({
    where: { id, workspaceId, platform: 'meta' },
    select: {
      id: true,
      name: true,
      payload: true,
      externalCampaignId: true,
      campaign: { select: { id: true, landingPage: { select: { slug: true } } } },
    },
  })
  if (!draft) return NextResponse.json({ error: 'draft_not_found' }, { status: 404 })
  if (draft.externalCampaignId) {
    return NextResponse.json(
      { error: 'already_launched', detail: `Already deployed as Meta campaign ${draft.externalCampaignId}` },
      { status: 409 },
    )
  }

  const adAccount = await db.metaAdAccount.findFirst({
    where: { id: body.metaAdAccountId, workspaceId },
    select: { id: true, metaAccountId: true, accessToken: true, isActive: true, accountName: true },
  })
  if (!adAccount) return NextResponse.json({ error: 'ad_account_not_found' }, { status: 404 })
  if (!adAccount.isActive) return NextResponse.json({ error: 'ad_account_inactive' }, { status: 400 })

  // Resolve destination URL — prefer the funnel's published landing page
  // when the draft is attached to a funnel campaign. Falls back to the
  // payload-embedded URL the operator typed in the wizard.
  const payload = draft.payload as unknown as MetaCampaignDraft & { destination_url?: string }
  let destinationUrl = payload.destination_url ?? ''
  if (!destinationUrl && draft.campaign?.landingPage?.slug) {
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL
    const base = appUrl ? appUrl.replace(/\/$/, '') : new URL(req.url).origin
    destinationUrl = `${base}/p/${draft.campaign.landingPage.slug}`
  }
  if (!destinationUrl) {
    return NextResponse.json(
      { error: 'no_destination_url', detail: 'Draft has no destination_url and no attached funnel landing page.' },
      { status: 400 },
    )
  }

  const result = await launchCampaign({
    adAccountId: adAccount.metaAccountId,
    accessToken: adAccount.accessToken,
    draft: payload,
    intake: { destination_url: destinationUrl },
    pageId: body.pageId,
  })

  // Persist external IDs even on partial success so the operator can
  // jump into Meta Ads Manager. Errors stay on the response, not the
  // row — if they re-launch, we want to start fresh.
  if (result.campaignId) {
    await db.adCampaignDraft.update({
      where: { id },
      data: { externalCampaignId: result.campaignId },
    })
  }

  const session = await auth()
  await db.adActivityLog.create({
    data: {
      metaAccountId: adAccount.id,
      actionType: result.ok ? 'campaign_launched' : 'campaign_launch_partial',
      description: result.ok
        ? `Launched campaign "${draft.name}" → ${result.campaignId} (${result.adIds?.length ?? 0} ads)`
        : `Partial launch of "${draft.name}" — ${result.errors?.length ?? 0} errors`,
      performedBy: session?.user?.email ?? session?.user?.id ?? 'user',
      details: {
        draftId: draft.id,
        campaignId: result.campaignId ?? null,
        adSetIds: result.adSetIds ?? [],
        adIds: result.adIds ?? [],
        errors: result.errors ?? [],
      } as object,
    },
  }).catch(() => {})

  return NextResponse.json(result)
}
