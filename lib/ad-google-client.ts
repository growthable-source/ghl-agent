/**
 * Google Ads API client for the ad launcher.
 *
 * Distinct from lib/conversion-fire.ts (which only uploads conversions
 * via uploadClickConversions). This client handles full campaign-tree
 * creation: budget → campaign → ad group → ad → keywords. Negative
 * keywords are resource-rooted on the campaign or ad group depending on
 * scope.
 *
 * Google Ads uses a single googleAds:mutate endpoint with a list of
 * MutateOperations. Each op references previous resources via temporary
 * resource names ("customers/<cid>/campaigns/-1") so the whole tree
 * deploys atomically. We use that pattern here so a partial failure
 * doesn't leave orphaned campaigns.
 *
 * Auth: refresh tokens live on GoogleAdAccount.refreshToken. We mint a
 * short-lived access token per call (cached at the call-site by
 * passing in the result of refreshAccessToken).
 */

import type {
  GoogleAdGroup,
  GoogleCampaignDraft,
  GoogleLaunchResult,
} from './ad-google-types'

const GOOGLE_ADS_API = 'https://googleads.googleapis.com/v20'

/** Refreshes the OAuth access token. Throws on failure. */
export async function refreshGoogleAdsAccessToken(refreshToken: string): Promise<string> {
  const clientId = process.env.GOOGLE_CLIENT_ID
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET
  if (!clientId || !clientSecret) {
    throw new Error('GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET not set')
  }
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'refresh_token',
    }),
  })
  const json = (await res.json().catch(() => ({}))) as { access_token?: string; error?: string; error_description?: string }
  if (!res.ok || !json.access_token) {
    throw new Error(`token_refresh_failed: ${json.error_description ?? json.error ?? res.status}`)
  }
  return json.access_token
}

interface BiddingStrategyDescriptor {
  // Field name on the campaign mutate body that picks the strategy.
  // Set as the only one of these — all others omitted.
  field: string
  body: Record<string, unknown>
}

function biddingStrategyFor(draft: GoogleCampaignDraft): BiddingStrategyDescriptor {
  switch (draft.bidding_strategy) {
    case 'TARGET_CPA':
      return {
        field: 'targetCpa',
        body: { targetCpaMicros: cents_to_micros(draft.target_cpa_cents ?? 5000) },
      }
    case 'TARGET_ROAS':
      return {
        field: 'targetRoas',
        body: { targetRoas: draft.target_roas ?? 3.0 },
      }
    case 'MAXIMIZE_CONVERSION_VALUE':
      return { field: 'maximizeConversionValue', body: {} }
    case 'MANUAL_CPC':
      return { field: 'manualCpc', body: { enhancedCpcEnabled: false } }
    case 'MAXIMIZE_CONVERSIONS':
    default:
      return { field: 'maximizeConversions', body: {} }
  }
}

function cents_to_micros(cents: number): number {
  return Math.round(cents * 10000) // 1 cent = 10,000 micros
}

interface LaunchArgs {
  customerId: string // unhyphenated
  accessToken: string
  developerToken: string
  draft: GoogleCampaignDraft
  // Optional manager/login customer ID if customerId is below a manager.
  loginCustomerId?: string
}

/**
 * Atomic campaign launch via googleAds:mutate. Creates budget +
 * campaign + ad groups + RSAs + keywords + negatives in one shot.
 *
 * On failure returns ok:false with the API error message. On success
 * returns the resource names so the caller can persist them.
 */
export async function launchGoogleCampaign(args: LaunchArgs): Promise<GoogleLaunchResult> {
  const { customerId, accessToken, developerToken, draft } = args

  // Temporary resource ids (negative integers) so cross-references work
  // within the same mutate. -1 = budget, -2 = campaign, then -100 onwards
  // for ad groups so the ID space doesn't overlap.
  const budgetTempId = -1
  const campaignTempId = -2
  const adGroupTempStart = -100
  const adTempStart = -1000
  const keywordTempStart = -10000

  const ops: Array<Record<string, unknown>> = []

  // 1. Campaign budget
  ops.push({
    campaignBudgetOperation: {
      create: {
        resourceName: `customers/${customerId}/campaignBudgets/${budgetTempId}`,
        name: `${draft.name} budget — ${Date.now()}`,
        amountMicros: cents_to_micros(draft.daily_budget_cents),
        deliveryMethod: 'STANDARD',
        explicitlyShared: false,
      },
    },
  })

  // 2. Campaign
  const bidding = biddingStrategyFor(draft)
  const campaignBody: Record<string, unknown> = {
    resourceName: `customers/${customerId}/campaigns/${campaignTempId}`,
    name: draft.name,
    status: 'PAUSED',
    advertisingChannelType: draft.campaign_type,
    campaignBudget: `customers/${customerId}/campaignBudgets/${budgetTempId}`,
    networkSettings: {
      targetGoogleSearch: draft.campaign_type === 'SEARCH' || draft.campaign_type === 'PERFORMANCE_MAX',
      targetSearchNetwork: draft.campaign_type === 'SEARCH',
      targetContentNetwork: draft.campaign_type === 'DISPLAY' || draft.campaign_type === 'PERFORMANCE_MAX',
      targetPartnerSearchNetwork: false,
    },
    [bidding.field]: bidding.body,
  }
  ops.push({ campaignOperation: { create: campaignBody } })

  // 3. Ad groups + ads + keywords
  const adGroupRefs: Array<{ tempId: number; group: GoogleAdGroup }> = []
  draft.ad_groups.forEach((group, gIdx) => {
    const tempId = adGroupTempStart - gIdx
    adGroupRefs.push({ tempId, group })
    ops.push({
      adGroupOperation: {
        create: {
          resourceName: `customers/${customerId}/adGroups/${tempId}`,
          campaign: `customers/${customerId}/campaigns/${campaignTempId}`,
          name: group.name,
          status: 'PAUSED',
          type: draft.campaign_type === 'SEARCH' ? 'SEARCH_STANDARD' : draft.campaign_type === 'DISPLAY' ? 'DISPLAY_STANDARD' : 'SEARCH_STANDARD',
          ...(group.default_max_cpc_cents ? { cpcBidMicros: cents_to_micros(group.default_max_cpc_cents) } : {}),
        },
      },
    })

    // Ads
    group.ads.forEach((ad, aIdx) => {
      const adTempId = adTempStart - (gIdx * 100) - aIdx
      ops.push({
        adGroupAdOperation: {
          create: {
            resourceName: `customers/${customerId}/adGroupAds/${adTempId}`,
            adGroup: `customers/${customerId}/adGroups/${tempId}`,
            status: 'PAUSED',
            ad: {
              finalUrls: [ad.final_url ?? ''],
              responsiveSearchAd: {
                headlines: ad.headlines.map((h) => ({ text: h })),
                descriptions: ad.descriptions.map((d) => ({ text: d })),
                ...(ad.path1 ? { path1: ad.path1 } : {}),
                ...(ad.path2 ? { path2: ad.path2 } : {}),
              },
            },
          },
        },
      })
    })

    // Keywords
    group.keywords?.forEach((kw, kIdx) => {
      const kwTempId = keywordTempStart - (gIdx * 1000) - kIdx
      ops.push({
        adGroupCriterionOperation: {
          create: {
            resourceName: `customers/${customerId}/adGroupCriteria/${kwTempId}`,
            adGroup: `customers/${customerId}/adGroups/${tempId}`,
            status: 'ENABLED',
            keyword: { text: kw.text, matchType: kw.match_type },
          },
        },
      })
    })

    // Negative keywords (ad-group level)
    group.negative_keywords?.forEach((kw, kIdx) => {
      const kwTempId = keywordTempStart - (gIdx * 1000) - 500 - kIdx
      ops.push({
        adGroupCriterionOperation: {
          create: {
            resourceName: `customers/${customerId}/adGroupCriteria/${kwTempId}`,
            adGroup: `customers/${customerId}/adGroups/${tempId}`,
            negative: true,
            keyword: { text: kw.text, matchType: kw.match_type },
          },
        },
      })
    })
  })

  // 4. Geo targets — one campaignCriterion per country.
  // Country location IDs are mapped from ISO codes via Geo Targets API.
  // For the first cut we hard-code the most common ones; everything else
  // gets skipped with an error. (Phase 7d.5: full ISO → criterion ID
  // resolver via geoTargetConstants:suggest.)
  const countryCriteria = draft.geo_targets
    .map((iso) => COUNTRY_CRITERION[iso.toUpperCase()])
    .filter((id): id is string => !!id)
  const skippedCountries = draft.geo_targets.filter((iso) => !COUNTRY_CRITERION[iso.toUpperCase()])

  countryCriteria.forEach((critId) => {
    ops.push({
      campaignCriterionOperation: {
        create: {
          campaign: `customers/${customerId}/campaigns/${campaignTempId}`,
          location: { geoTargetConstant: `geoTargetConstants/${critId}` },
        },
      },
    })
  })

  // Send the mutate
  let res: Response
  try {
    res = await fetch(`${GOOGLE_ADS_API}/customers/${customerId}/googleAds:mutate`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'developer-token': developerToken,
        'Content-Type': 'application/json',
        ...(args.loginCustomerId ? { 'login-customer-id': args.loginCustomerId } : {}),
      },
      body: JSON.stringify({
        mutateOperations: ops,
        partialFailure: false,
        validateOnly: false,
      }),
    })
  } catch (err) {
    return { ok: false, errors: [`network_error: ${err instanceof Error ? err.message : err}`] }
  }

  const json = (await res.json().catch(() => ({}))) as {
    mutateOperationResponses?: Array<Record<string, unknown>>
    partialFailureError?: { message?: string }
    error?: { message?: string; details?: unknown }
  }
  if (!res.ok || json.error) {
    return {
      ok: false,
      errors: [`mutate_failed: ${json.error?.message ?? `HTTP ${res.status}`}${typeof json.error?.details !== 'undefined' ? ` — ${JSON.stringify(json.error.details).slice(0, 300)}` : ''}`],
    }
  }

  // Parse responses to pull resource names back out.
  const responses = json.mutateOperationResponses ?? []
  let campaignId: string | undefined
  let budgetId: string | undefined
  const adGroupIds: string[] = []
  const adIds: string[] = []
  for (const r of responses) {
    if (r.campaignBudgetResult && typeof (r.campaignBudgetResult as { resourceName?: string }).resourceName === 'string') {
      budgetId = (r.campaignBudgetResult as { resourceName: string }).resourceName
    }
    if (r.campaignResult && typeof (r.campaignResult as { resourceName?: string }).resourceName === 'string') {
      campaignId = (r.campaignResult as { resourceName: string }).resourceName
    }
    if (r.adGroupResult && typeof (r.adGroupResult as { resourceName?: string }).resourceName === 'string') {
      adGroupIds.push((r.adGroupResult as { resourceName: string }).resourceName)
    }
    if (r.adGroupAdResult && typeof (r.adGroupAdResult as { resourceName?: string }).resourceName === 'string') {
      adIds.push((r.adGroupAdResult as { resourceName: string }).resourceName)
    }
  }

  const result: GoogleLaunchResult = {
    ok: true,
    campaignId,
    budgetId,
    adGroupIds,
    adIds,
  }
  if (skippedCountries.length > 0) {
    result.errors = [`Country codes not yet supported by built-in geo resolver, skipped: ${skippedCountries.join(', ')}. Add them in Google Ads UI.`]
  }
  return result
}

/**
 * ISO 3166-1 alpha-2 → Google Ads geoTargetConstant ID.
 * Source: https://developers.google.com/google-ads/api/data/geotargets
 *
 * This is intentionally a small starter set covering high-volume
 * markets. Phase 7d.5 will switch to the geoTargetConstants:suggest
 * endpoint for full coverage.
 */
const COUNTRY_CRITERION: Record<string, string> = {
  US: '2840',
  CA: '2124',
  GB: '2826',
  AU: '2036',
  NZ: '2554',
  IE: '2372',
  DE: '2276',
  FR: '2250',
  ES: '2724',
  IT: '2380',
  NL: '2528',
  BE: '2056',
  SE: '2752',
  NO: '2578',
  DK: '2208',
  FI: '2246',
  CH: '2756',
  AT: '2040',
  PT: '2620',
  PL: '2616',
  JP: '2392',
  KR: '2410',
  SG: '2702',
  HK: '2344',
  IN: '2356',
  BR: '2076',
  MX: '2484',
  AR: '2032',
  CL: '2152',
  CO: '2170',
  ZA: '2710',
  AE: '2784',
  SA: '2682',
  IL: '2376',
  TR: '2792',
}
