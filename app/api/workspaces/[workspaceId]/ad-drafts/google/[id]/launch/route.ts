/**
 * POST /api/workspaces/[workspaceId]/ad-drafts/google/[id]/launch
 *
 * Body: { googleAdAccountId: string; loginCustomerId?: string }
 *
 * Refreshes the OAuth access token for the chosen GoogleAdAccount, then
 * pushes the entire campaign tree (budget + campaign + ad groups + RSAs
 * + keywords) via googleAds:mutate. Stores the resulting campaign
 * resource name on the draft.
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { auth } from '@/lib/auth'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'
import { launchGoogleCampaign, refreshGoogleAdsAccessToken } from '@/lib/ad-google-client'
import type { GoogleCampaignDraft } from '@/lib/ad-google-types'

export const dynamic = 'force-dynamic'

type Params = { workspaceId: string; id: string }

export async function POST(req: NextRequest, ctx: { params: Promise<Params> }) {
  const { workspaceId, id } = await ctx.params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  const body = (await req.json().catch(() => ({}))) as { googleAdAccountId?: string; loginCustomerId?: string }
  if (!body.googleAdAccountId) {
    return NextResponse.json({ error: 'googleAdAccountId is required' }, { status: 400 })
  }

  const developerToken = process.env.GOOGLE_DEVELOPER_TOKEN
  if (!developerToken) {
    return NextResponse.json({ error: 'server_misconfigured', detail: 'GOOGLE_DEVELOPER_TOKEN missing' }, { status: 500 })
  }

  const draft = await db.adCampaignDraft.findFirst({
    where: { id, workspaceId, platform: 'google' },
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
      { error: 'already_launched', detail: `Already deployed as ${draft.externalCampaignId}` },
      { status: 409 },
    )
  }

  const adAccount = await db.googleAdAccount.findFirst({
    where: { id: body.googleAdAccountId, workspaceId },
    select: { id: true, googleCustomerId: true, refreshToken: true, isActive: true, accountName: true },
  })
  if (!adAccount) return NextResponse.json({ error: 'ad_account_not_found' }, { status: 404 })
  if (!adAccount.isActive) return NextResponse.json({ error: 'ad_account_inactive' }, { status: 400 })

  // Resolve final URL on each ad — replace any blank final_url with the
  // funnel landing page or a payload-level destination if set. Without
  // a final URL the API rejects the ad.
  const payload = draft.payload as unknown as GoogleCampaignDraft & { destination_url?: string }
  let destinationUrl = payload.destination_url ?? ''
  if (!destinationUrl && draft.campaign?.landingPage?.slug) {
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL
    const base = appUrl ? appUrl.replace(/\/$/, '') : new URL(req.url).origin
    destinationUrl = `${base}/p/${draft.campaign.landingPage.slug}`
  }
  // Fallback: any ad's final_url that's already populated.
  if (!destinationUrl) {
    for (const g of payload.ad_groups) {
      for (const ad of g.ads) {
        if (ad.final_url) { destinationUrl = ad.final_url; break }
      }
      if (destinationUrl) break
    }
  }
  if (!destinationUrl) {
    return NextResponse.json(
      { error: 'no_destination_url', detail: 'Draft has no destination_url, no attached funnel landing page, and no ad-level final_url.' },
      { status: 400 },
    )
  }

  // Patch any blank final_url on the draft so the launch always sets one.
  const patchedPayload: GoogleCampaignDraft = {
    ...payload,
    ad_groups: payload.ad_groups.map((g) => ({
      ...g,
      ads: g.ads.map((a) => ({ ...a, final_url: a.final_url || destinationUrl })),
    })),
  }

  let accessToken: string
  try {
    accessToken = await refreshGoogleAdsAccessToken(adAccount.refreshToken)
  } catch (err) {
    return NextResponse.json(
      { error: 'token_refresh_failed', detail: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    )
  }

  const result = await launchGoogleCampaign({
    customerId: adAccount.googleCustomerId,
    accessToken,
    developerToken,
    draft: patchedPayload,
    loginCustomerId: body.loginCustomerId,
  })

  if (result.campaignId) {
    await db.adCampaignDraft.update({
      where: { id },
      data: { externalCampaignId: result.campaignId },
    })
  }

  const session = await auth()
  await db.adActivityLog.create({
    data: {
      googleAccountId: adAccount.id,
      actionType: result.ok ? 'campaign_launched' : 'campaign_launch_partial',
      description: result.ok
        ? `Launched campaign "${draft.name}" → ${result.campaignId}`
        : `Failed to launch "${draft.name}": ${result.errors?.join(' · ') ?? 'unknown'}`,
      performedBy: session?.user?.email ?? session?.user?.id ?? 'user',
      details: {
        draftId: draft.id,
        campaignId: result.campaignId ?? null,
        budgetId: result.budgetId ?? null,
        adGroupIds: result.adGroupIds ?? [],
        adIds: result.adIds ?? [],
        errors: result.errors ?? [],
      } as object,
    },
  }).catch(() => {})

  return NextResponse.json(result)
}
