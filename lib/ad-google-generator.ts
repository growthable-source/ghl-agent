/**
 * Google Ads campaign generator. Same shape as ad-meta-generator but
 * the system prompt teaches Search/PMax-specific best practices: RSA
 * asset coverage, match types, automated-bidding selection, conversion
 * tracking gates.
 */

import Anthropic from '@anthropic-ai/sdk'
import type {
  GoogleAdGroup,
  GoogleBiddingStrategy,
  GoogleCampaignDraft,
  GoogleCampaignIntake,
  GoogleCampaignType,
  GoogleObjective,
  GoogleResponsiveSearchAd,
} from './ad-google-types'

const client = new Anthropic()
// Was pinned to Opus; now routed through the provider layer (lib/llm) so it
// defaults to cheaper Claude Sonnet and can move to DeepSeek via
// LLM_GENERATOR_MODEL. Parsing below is unchanged (layer returns the
// Anthropic-shaped message).
const MODEL = process.env.LLM_GENERATOR_MODEL || 'claude-sonnet'
const msg = async (params: Parameters<typeof client.messages.create>[0]) => {
  const { createMessage } = await import('@/lib/llm')
  return createMessage(MODEL, params as never, { surface: 'ad-google' }) as unknown as Anthropic.Messages.Message
}

const SYSTEM_PROMPT = `You are a senior Google Ads strategist who has spent $50M+ across Search, Performance Max, Display, and YouTube. You build campaigns that convert at the lowest possible CPA without wasting spend on low-intent traffic.

CAMPAIGN TYPE SELECTION:
- SEARCH: highest-intent traffic. Default for lead-gen and most B2B. Requires keyword research.
- PERFORMANCE_MAX: full-funnel automated buying across Search/Display/YT/Discover/Maps. Best when conversion volume is high (50+/month) and creatives + audience signals are mature. Requires conversion tracking.
- DISPLAY: top-of-funnel awareness or remarketing. Avoid for direct response.
- VIDEO: YouTube. Brand or product videos only.

BIDDING STRATEGY:
- MAXIMIZE_CONVERSIONS: best default for new conversion-focused campaigns without enough data for a target. Requires conversion tracking.
- TARGET_CPA: when you have ≥30 conversions/30 days and a known acceptable CPA. Set target_cpa 10-20% above current CPA to avoid limiting volume.
- MAXIMIZE_CONVERSION_VALUE: revenue-tracked accounts (ecom). Best when conversion values vary.
- TARGET_ROAS: when you've collected ≥50 conversions/30 days with reliable values. Aggressive — sets a hard ceiling.
- MANUAL_CPC: only when explicitly requested or when conversion tracking is missing entirely. Fallback only.

CONVERSION TRACKING GATE:
- TARGET_CPA / TARGET_ROAS / MAXIMIZE_CONVERSIONS / PERFORMANCE_MAX all require a conversion_action. If the operator hasn't supplied one, fall back to MAXIMIZE_CONVERSIONS as the *intent* but explicitly note in strategic_rationale that the operator must wire conversion tracking before launch will be effective.

KEYWORDS (Search only):
- Match types:
  - EXACT [keyword]: tightest. Use for proven money keywords.
  - PHRASE "keyword": ordered match. Default for new themes.
  - BROAD keyword: with smart bidding, this is now Google's recommended default — let the algorithm match intent rather than text. Use BROAD when the bidding strategy is automated.
- 5-15 keywords per ad group. Theme tightly — every keyword should map to the ad copy you'd write for it.
- Always emit negative_keywords to exclude obvious wasted spend (jobs, free, cheap, careers, [competitor names if irrelevant]).

RESPONSIVE SEARCH ADS:
- 6-12 headlines per ad (Google requires min 3, max 15). Each ≤30 chars. Mix: brand, benefit, offer, location, CTA, social proof.
- 3-4 descriptions per ad (max 4). Each ≤90 chars. State the offer + the differentiator + a CTA.
- ONE ad per ad group is fine — Google rotates assets internally; multiple full ads is overkill.
- AVOID AI-tells in headlines. "Unlock" "Transform" "Supercharge" "Elevate" all banned.

AD GROUPS:
- Default to ONE ad group with tight keyword theming. Multiple ad groups only when the keyword themes diverge meaningfully (e.g. "chiropractor sydney" + "back pain treatment" deserve different ads even though same business).

BUDGET:
- daily_budget_cents lives at CAMPAIGN level (Google doesn't have ad-set-level budgets like Meta).
- Echo the operator's daily_budget_cents — don't invent.

GEO:
- Respect operator-supplied countries. Default ['US'] if missing. Country-level targeting is the safe default; city-level is too narrow without research.

initial_status MUST be "PAUSED". Operator launches explicitly.`

const TOOL_SCHEMA = {
  type: 'object' as const,
  required: ['name', 'campaign_type', 'objective', 'bidding_strategy', 'initial_status', 'daily_budget_cents', 'geo_targets', 'strategic_rationale', 'ad_groups'],
  properties: {
    name: { type: 'string' },
    campaign_type: { type: 'string', enum: ['SEARCH', 'PERFORMANCE_MAX', 'DISPLAY', 'VIDEO'] },
    objective: { type: 'string', enum: ['LEADS', 'SALES', 'WEBSITE_TRAFFIC', 'BRAND_AWARENESS'] },
    bidding_strategy: {
      type: 'string',
      enum: ['MAXIMIZE_CONVERSIONS', 'MAXIMIZE_CONVERSION_VALUE', 'TARGET_CPA', 'TARGET_ROAS', 'MANUAL_CPC'],
    },
    initial_status: { type: 'string', enum: ['PAUSED'] },
    daily_budget_cents: { type: 'integer', minimum: 100 },
    geo_targets: { type: 'array', items: { type: 'string' } },
    conversion_action: { type: 'string' },
    target_cpa_cents: { type: 'integer' },
    target_roas: { type: 'number' },
    strategic_rationale: { type: 'string', minLength: 80 },
    expected_metrics: {
      type: 'object',
      properties: {
        cpa_low_cents: { type: 'integer' },
        cpa_high_cents: { type: 'integer' },
        daily_conversions_low: { type: 'number' },
        daily_conversions_high: { type: 'number' },
        impression_share_low: { type: 'number' },
        impression_share_high: { type: 'number' },
      },
    },
    ad_groups: {
      type: 'array',
      minItems: 1,
      maxItems: 6,
      items: {
        type: 'object',
        required: ['name', 'ads'],
        properties: {
          name: { type: 'string' },
          default_max_cpc_cents: { type: 'integer' },
          keywords: {
            type: 'array',
            items: {
              type: 'object',
              required: ['text', 'match_type'],
              properties: {
                text: { type: 'string', minLength: 1, maxLength: 80 },
                match_type: { type: 'string', enum: ['EXACT', 'PHRASE', 'BROAD'] },
              },
            },
          },
          negative_keywords: {
            type: 'array',
            items: {
              type: 'object',
              required: ['text', 'match_type'],
              properties: {
                text: { type: 'string', minLength: 1, maxLength: 80 },
                match_type: { type: 'string', enum: ['EXACT', 'PHRASE', 'BROAD'] },
              },
            },
          },
          ads: {
            type: 'array',
            minItems: 1,
            maxItems: 3,
            items: {
              type: 'object',
              required: ['headlines', 'descriptions'],
              properties: {
                headlines: {
                  type: 'array',
                  minItems: 3,
                  maxItems: 15,
                  items: { type: 'string', minLength: 1, maxLength: 30 },
                },
                descriptions: {
                  type: 'array',
                  minItems: 2,
                  maxItems: 4,
                  items: { type: 'string', minLength: 1, maxLength: 90 },
                },
                final_url: { type: 'string' },
                path1: { type: 'string', maxLength: 15 },
                path2: { type: 'string', maxLength: 15 },
              },
            },
          },
          targeting_rationale: { type: 'string' },
        },
      },
    },
  },
}

function userPrompt(intake: GoogleCampaignIntake): string {
  return `Build a Google Ads campaign for this business.

Business: ${intake.business_name}
${intake.industry ? `Industry: ${intake.industry}` : ''}
Offer: ${intake.product_offer}
Dream outcome: ${intake.dream_outcome}
Audience: ${intake.audience_description}
Destination URL: ${intake.destination_url}
Daily budget (cents): ${intake.daily_budget_cents}
Operator-stated objective: ${intake.objective}
${intake.campaign_type ? `Operator-requested campaign type: ${intake.campaign_type}` : ''}
${intake.countries?.length ? `Country targeting: ${intake.countries.join(', ')}` : ''}
${intake.conversion_action ? `Conversion action: ${intake.conversion_action}` : 'Conversion action: NOT SET — flag this in strategic_rationale.'}
${intake.target_cpa_cents ? `Target CPA (cents): ${intake.target_cpa_cents}` : ''}
${intake.target_roas ? `Target ROAS: ${intake.target_roas}` : ''}
${intake.num_ad_groups ? `Number of ad groups: ${intake.num_ad_groups}` : ''}

Return the complete campaign via the return_google_campaign tool. ONE ad group with one Responsive Search Ad is the default. initial_status MUST be PAUSED.`
}

export async function generateGoogleCampaign(input: {
  intake: GoogleCampaignIntake
}): Promise<GoogleCampaignDraft> {
  const { intake } = input
  if (!intake.business_name || !intake.product_offer || !intake.dream_outcome || !intake.destination_url) {
    throw new Error('intake.business_name, product_offer, dream_outcome, and destination_url are required')
  }
  if (!intake.daily_budget_cents || intake.daily_budget_cents < 100) {
    throw new Error('daily_budget_cents must be at least 100 (Google min ~$1/day)')
  }

  const response = await msg({
    model: MODEL,
    max_tokens: 12000,
    system: [
      { type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } },
    ],
    tools: [
      {
        name: 'return_google_campaign',
        description: 'Return the complete Google Ads campaign draft (campaign + ad groups + RSAs + keywords) as typed JSON.',
        input_schema: TOOL_SCHEMA,
      },
    ],
    tool_choice: { type: 'tool', name: 'return_google_campaign' },
    messages: [{ role: 'user', content: userPrompt(intake) }],
  })

  let raw: Record<string, unknown> | null = null
  for (const block of response.content) {
    if (block.type === 'tool_use' && block.name === 'return_google_campaign') {
      raw = block.input as Record<string, unknown>
      break
    }
  }
  if (!raw) {
    throw new Error(`Model did not return a campaign draft. stop_reason=${response.stop_reason ?? 'unknown'}`)
  }

  return normalise(raw, intake)
}

function normalise(raw: Record<string, unknown>, intake: GoogleCampaignIntake): GoogleCampaignDraft {
  const adGroupsRaw = Array.isArray(raw.ad_groups) ? raw.ad_groups : []
  const ad_groups: GoogleAdGroup[] = adGroupsRaw.map((g) => normaliseGroup(g as Record<string, unknown>, intake))

  const draft: GoogleCampaignDraft = {
    name: typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : `${intake.product_offer.slice(0, 40)} — ${new Date().toISOString().slice(0, 10)}`,
    campaign_type: (raw.campaign_type as GoogleCampaignType) ?? intake.campaign_type ?? 'SEARCH',
    objective: (raw.objective as GoogleObjective) ?? intake.objective,
    bidding_strategy: (raw.bidding_strategy as GoogleBiddingStrategy) ?? 'MAXIMIZE_CONVERSIONS',
    initial_status: 'PAUSED',
    daily_budget_cents: typeof raw.daily_budget_cents === 'number' ? raw.daily_budget_cents : intake.daily_budget_cents,
    geo_targets: Array.isArray(raw.geo_targets) ? (raw.geo_targets as string[]) : (intake.countries ?? ['US']),
    strategic_rationale: typeof raw.strategic_rationale === 'string' ? raw.strategic_rationale : '',
    ad_groups: ad_groups.length > 0 ? ad_groups : [defaultAdGroup(intake)],
  }
  if (typeof raw.conversion_action === 'string') draft.conversion_action = raw.conversion_action
  if (typeof raw.target_cpa_cents === 'number') draft.target_cpa_cents = raw.target_cpa_cents
  if (typeof raw.target_roas === 'number') draft.target_roas = raw.target_roas
  if (raw.expected_metrics && typeof raw.expected_metrics === 'object') {
    const em = raw.expected_metrics as Record<string, unknown>
    const out: NonNullable<GoogleCampaignDraft['expected_metrics']> = {}
    for (const k of ['cpa_low_cents', 'cpa_high_cents', 'daily_conversions_low', 'daily_conversions_high', 'impression_share_low', 'impression_share_high'] as const) {
      if (typeof em[k] === 'number') out[k] = em[k] as number
    }
    if (Object.keys(out).length > 0) draft.expected_metrics = out
  }
  return draft
}

function normaliseGroup(raw: Record<string, unknown>, intake: GoogleCampaignIntake): GoogleAdGroup {
  const adsRaw = Array.isArray(raw.ads) ? raw.ads : []
  const ads: GoogleResponsiveSearchAd[] = adsRaw.map((a) => normaliseRsa(a as Record<string, unknown>, intake))
  const group: GoogleAdGroup = {
    name: typeof raw.name === 'string' ? raw.name : 'Ad group',
    ads: ads.length > 0 ? ads : [defaultRsa(intake)],
  }
  if (typeof raw.default_max_cpc_cents === 'number') group.default_max_cpc_cents = raw.default_max_cpc_cents
  if (Array.isArray(raw.keywords)) {
    group.keywords = (raw.keywords as Array<Record<string, unknown>>)
      .filter((k) => typeof k.text === 'string' && typeof k.match_type === 'string')
      .map((k) => ({ text: k.text as string, match_type: k.match_type as 'EXACT' | 'PHRASE' | 'BROAD' }))
  }
  if (Array.isArray(raw.negative_keywords)) {
    group.negative_keywords = (raw.negative_keywords as Array<Record<string, unknown>>)
      .filter((k) => typeof k.text === 'string' && typeof k.match_type === 'string')
      .map((k) => ({ text: k.text as string, match_type: k.match_type as 'EXACT' | 'PHRASE' | 'BROAD' }))
  }
  if (typeof raw.targeting_rationale === 'string') group.targeting_rationale = raw.targeting_rationale
  return group
}

function normaliseRsa(raw: Record<string, unknown>, intake: GoogleCampaignIntake): GoogleResponsiveSearchAd {
  return {
    headlines: Array.isArray(raw.headlines) ? (raw.headlines as string[]).slice(0, 15) : [intake.dream_outcome.slice(0, 30)],
    descriptions: Array.isArray(raw.descriptions) ? (raw.descriptions as string[]).slice(0, 4) : [intake.product_offer.slice(0, 90)],
    final_url: typeof raw.final_url === 'string' ? raw.final_url : intake.destination_url,
    path1: typeof raw.path1 === 'string' ? raw.path1 : undefined,
    path2: typeof raw.path2 === 'string' ? raw.path2 : undefined,
  }
}

function defaultAdGroup(intake: GoogleCampaignIntake): GoogleAdGroup {
  return {
    name: 'Default ad group',
    ads: [defaultRsa(intake)],
  }
}

function defaultRsa(intake: GoogleCampaignIntake): GoogleResponsiveSearchAd {
  return {
    headlines: [intake.dream_outcome.slice(0, 30), intake.product_offer.slice(0, 30), intake.business_name.slice(0, 30)],
    descriptions: [intake.product_offer.slice(0, 90), intake.dream_outcome.slice(0, 90)],
    final_url: intake.destination_url,
  }
}
