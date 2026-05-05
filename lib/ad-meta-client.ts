/**
 * Meta Marketing API client for the ad launcher.
 *
 * Distinct from lib/meta-client.ts (Page-token / Messenger / IG DMs) —
 * this one talks to the Marketing API surface using a User Access Token
 * stored on MetaAdAccount.accessToken.
 *
 * Surface area is deliberately small: createCampaign, createAdSet,
 * createAdCreative, createAd, plus a `launchCampaign` orchestrator that
 * wraps a typed MetaCampaignDraft into the multi-step launch sequence
 * and aggregates per-step errors so the UI can surface partial success.
 *
 * No retry / queue / webhook handling here — the operator sees the
 * result inline and re-clicks Launch on a failure. Fix that when we
 * have data on what fails most often.
 */

import type {
  MetaAdSet,
  MetaCampaignDraft,
  MetaCampaignIntake,
  MetaLaunchResult,
} from './ad-meta-types'

const META_API = 'https://graph.facebook.com/v21.0'

interface MetaError {
  message?: string
  type?: string
  code?: number
  error_subcode?: number
  fbtrace_id?: string
}

/** POST helper. Returns { ok, data | error }. Never throws. */
async function metaPost<T>(path: string, accessToken: string, body: Record<string, unknown>): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  try {
    const url = `${META_API}/${path}`
    const params = new URLSearchParams({ access_token: accessToken })
    for (const [k, v] of Object.entries(body)) {
      if (v === undefined || v === null) continue
      params.set(k, typeof v === 'string' ? v : JSON.stringify(v))
    }
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    })
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown> & { error?: MetaError }
    if (!res.ok || json.error) {
      const e = json.error
      const msg = e?.message ?? `HTTP ${res.status}`
      return { ok: false, error: e?.code ? `${msg} (code ${e.code})` : msg }
    }
    return { ok: true, data: json as T }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'network_error' }
  }
}

interface CreateCampaignArgs {
  adAccountId: string // bare numeric, no act_ prefix
  accessToken: string
  name: string
  objective: string
  status: 'PAUSED' | 'ACTIVE'
  campaignBudgetOptimization?: boolean
  dailyBudgetCents?: number
}

export async function createCampaign(args: CreateCampaignArgs): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const body: Record<string, unknown> = {
    name: args.name,
    objective: args.objective,
    status: args.status,
    // Required since 2020 for all new campaigns; explicit acceptance.
    special_ad_categories: [],
  }
  if (args.campaignBudgetOptimization) {
    if (!args.dailyBudgetCents) return { ok: false, error: 'CBO requires daily_budget_cents at campaign level' }
    body.daily_budget = args.dailyBudgetCents
    body.bid_strategy = 'LOWEST_COST_WITHOUT_CAP'
  }
  const res = await metaPost<{ id: string }>(`act_${args.adAccountId}/campaigns`, args.accessToken, body)
  if (!res.ok) return res
  return { ok: true, id: res.data.id }
}

interface CreateAdSetArgs {
  adAccountId: string
  accessToken: string
  campaignId: string
  pageId?: string
  adSet: MetaAdSet
}

export async function createAdSet(args: CreateAdSetArgs): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const set = args.adSet
  const body: Record<string, unknown> = {
    name: set.name,
    campaign_id: args.campaignId,
    daily_budget: set.daily_budget_cents,
    optimization_goal: set.optimization_goal,
    billing_event: set.billing_event,
    bid_strategy: 'LOWEST_COST_WITHOUT_CAP',
    status: 'PAUSED',
    targeting: {
      geo_locations: set.targeting.geo_locations,
      age_min: set.targeting.age_min,
      age_max: set.targeting.age_max,
      // interest_keywords are AI-emitted strings — Meta's API needs
      // numeric interest IDs. Passing strings here will fail. We omit
      // interests entirely until we wire interest-search resolution
      // (Phase 7c.5). Broad targeting works fine for OFFSITE_CONVERSIONS.
    },
    // Promoted-object pinning for OFFSITE_CONVERSIONS — without this the
    // ad set isn't tied to a specific Pixel event.
  }
  if (set.promoted_object) {
    body.promoted_object = set.promoted_object
  }
  // For LEAD_GENERATION the ad set must reference a Page that owns the
  // lead form. For traffic / offsite_conversions a page is optional but
  // strongly recommended (Meta tracks reactions back to it).
  if (args.pageId && (set.optimization_goal === 'LEAD_GENERATION' || set.optimization_goal === 'OFFSITE_CONVERSIONS')) {
    const promoted = (body.promoted_object as Record<string, unknown> | undefined) ?? {}
    promoted.page_id = args.pageId
    body.promoted_object = promoted
  }
  return metaPost<{ id: string }>(`act_${args.adAccountId}/adsets`, args.accessToken, body).then((r) => {
    if (!r.ok) return r
    return { ok: true as const, id: r.data.id }
  })
}

interface CreateAdCreativeArgs {
  adAccountId: string
  accessToken: string
  pageId: string
  name: string
  primaryText: string
  headline: string
  description?: string
  destinationUrl: string
  callToAction: string
}

export async function createAdCreative(args: CreateAdCreativeArgs): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  // Link ad creative — operator-supplied destination_url, headline, body.
  // No image: Meta synthesises a card from the URL's OpenGraph data
  // when no image_hash is supplied, which is fine for v0 (operator can
  // upload custom creatives in the UI later).
  const body = {
    name: args.name,
    object_story_spec: {
      page_id: args.pageId,
      link_data: {
        link: args.destinationUrl,
        message: args.primaryText,
        name: args.headline,
        description: args.description,
        call_to_action: { type: args.callToAction, value: { link: args.destinationUrl } },
      },
    },
  }
  return metaPost<{ id: string }>(`act_${args.adAccountId}/adcreatives`, args.accessToken, body).then((r) => {
    if (!r.ok) return r
    return { ok: true as const, id: r.data.id }
  })
}

interface CreateAdArgs {
  adAccountId: string
  accessToken: string
  adSetId: string
  name: string
  creativeId: string
}

export async function createAd(args: CreateAdArgs): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const body = {
    name: args.name,
    adset_id: args.adSetId,
    creative: { creative_id: args.creativeId },
    status: 'PAUSED',
  }
  return metaPost<{ id: string }>(`act_${args.adAccountId}/ads`, args.accessToken, body).then((r) => {
    if (!r.ok) return r
    return { ok: true as const, id: r.data.id }
  })
}

interface LaunchArgs {
  adAccountId: string
  accessToken: string
  draft: MetaCampaignDraft
  intake: Pick<MetaCampaignIntake, 'destination_url'>
  pageId?: string
}

export async function launchCampaign(args: LaunchArgs): Promise<MetaLaunchResult> {
  const errors: string[] = []

  const campaignRes = await createCampaign({
    adAccountId: args.adAccountId,
    accessToken: args.accessToken,
    name: args.draft.name,
    objective: args.draft.objective,
    status: 'PAUSED',
    campaignBudgetOptimization: args.draft.campaign_budget_optimization,
    dailyBudgetCents: args.draft.daily_budget_cents,
  })
  if (!campaignRes.ok) {
    return { ok: false, errors: [`createCampaign: ${campaignRes.error}`] }
  }
  const campaignId = campaignRes.id

  const adSetIds: string[] = []
  const adIds: string[] = []
  for (const set of args.draft.ad_sets) {
    const setRes = await createAdSet({
      adAccountId: args.adAccountId,
      accessToken: args.accessToken,
      campaignId,
      pageId: args.pageId,
      adSet: set,
    })
    if (!setRes.ok) {
      errors.push(`createAdSet "${set.name}": ${setRes.error}`)
      continue
    }
    adSetIds.push(setRes.id)

    for (const ad of set.ads) {
      // We need a Page ID to create an ad creative. If the operator
      // hasn't connected one, surface that as a per-ad error rather
      // than failing the whole launch — the campaign + ad set still
      // exist and they can attach ads in Meta's UI.
      if (!args.pageId) {
        errors.push(`Ad "${ad.name}" skipped — no Page connected. Connect a Facebook Page in Integrations first.`)
        continue
      }
      const creativeRes = await createAdCreative({
        adAccountId: args.adAccountId,
        accessToken: args.accessToken,
        pageId: args.pageId,
        name: `${ad.name} (creative)`,
        primaryText: ad.primary_text,
        headline: ad.headline,
        description: ad.description,
        destinationUrl: args.intake.destination_url,
        callToAction: ad.call_to_action,
      })
      if (!creativeRes.ok) {
        errors.push(`createAdCreative "${ad.name}": ${creativeRes.error}`)
        continue
      }
      const adRes = await createAd({
        adAccountId: args.adAccountId,
        accessToken: args.accessToken,
        adSetId: setRes.id,
        name: ad.name,
        creativeId: creativeRes.id,
      })
      if (!adRes.ok) {
        errors.push(`createAd "${ad.name}": ${adRes.error}`)
        continue
      }
      adIds.push(adRes.id)
    }
  }

  return {
    ok: errors.length === 0,
    campaignId,
    adSetIds,
    adIds,
    errors: errors.length > 0 ? errors : undefined,
  }
}
