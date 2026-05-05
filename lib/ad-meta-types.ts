/**
 * Shared types for the Meta ad-launcher: the operator-facing intake
 * payload, the typed AI-generated draft (stored in
 * AdCampaignDraft.payload), and the response shape from Marketing API
 * v21 createCampaign / createAdSet / createAd.
 *
 * Structured here (not in the generator file) so the API routes, UI,
 * and Marketing API client can all import them without pulling in
 * the Anthropic SDK.
 */

export type MetaObjective =
  | 'OUTCOME_LEADS'
  | 'OUTCOME_TRAFFIC'
  | 'OUTCOME_SALES'
  | 'OUTCOME_AWARENESS'
  | 'OUTCOME_ENGAGEMENT'

export type MetaOptimizationGoal =
  | 'LEAD_GENERATION'
  | 'OFFSITE_CONVERSIONS'
  | 'LINK_CLICKS'
  | 'IMPRESSIONS'
  | 'REACH'
  | 'POST_ENGAGEMENT'

export type MetaBillingEvent =
  | 'IMPRESSIONS'
  | 'LINK_CLICKS'
  | 'POST_ENGAGEMENT'
  | 'PAGE_LIKES'

export type MetaCallToAction =
  | 'LEARN_MORE'
  | 'SIGN_UP'
  | 'GET_QUOTE'
  | 'CONTACT_US'
  | 'BOOK_TRAVEL'
  | 'APPLY_NOW'
  | 'DOWNLOAD'
  | 'GET_OFFER'
  | 'SHOP_NOW'
  | 'SUBSCRIBE'

/** Inputs the operator (or wizard) provides to draft a campaign. */
export interface MetaCampaignIntake {
  business_name: string
  product_offer: string
  // What does the prospect want? (used as the hook)
  dream_outcome: string
  // Who are we targeting? Free-text — the AI maps this to ad-set targeting.
  audience_description: string
  // Where should clicks land?
  destination_url: string
  // Daily budget in account currency (cents).
  daily_budget_cents: number
  // Operator's stated objective; the AI may pick a more specific
  // optimization goal (e.g. LEAD_GENERATION → lead-form, but if no form
  // is hosted on Meta we'd use OFFSITE_CONVERSIONS).
  objective: MetaObjective
  // Optional override — defaults to one ad set with one ad.
  num_ad_variants?: number
  // Industry hint helps the AI calibrate copy length and CTA choice.
  industry?: string
  // Country codes for geo targeting (ISO 3166-1 alpha-2). Default ['US'].
  countries?: string[]
  // Min/max age. Default 18-65.
  age_min?: number
  age_max?: number
  // Pixel ID for OFFSITE_CONVERSIONS — required when objective is sales.
  pixel_id?: string
  // Conversion event name — required when objective is sales.
  conversion_event?: string
}

export interface MetaAdCreative {
  name: string
  primary_text: string // body copy, 125 char ideal
  headline: string // 40 char ideal
  description?: string // 30 char ideal — News Feed link description
  call_to_action: MetaCallToAction
  // Headline + body alternates for dynamic-creative variants. Optional.
  body_alternates?: string[]
  headline_alternates?: string[]
}

export interface MetaAdSet {
  name: string
  optimization_goal: MetaOptimizationGoal
  billing_event: MetaBillingEvent
  daily_budget_cents: number
  targeting: {
    geo_locations: { countries: string[] }
    age_min: number
    age_max: number
    // Stringly-typed interest/behavior tags the AI emits — looked up to
    // Meta's targeting taxonomy at launch time. Keeping them as strings
    // for now lets the AI work without an interest-search round-trip.
    interest_keywords?: string[]
    detailed_targeting_rationale?: string
  }
  // Optional — only set for OUTCOME_SALES with OFFSITE_CONVERSIONS.
  promoted_object?: {
    pixel_id: string
    custom_event_type: string
  }
  ads: MetaAdCreative[]
}

/** AI-generated draft persisted to AdCampaignDraft.payload. */
export interface MetaCampaignDraft {
  // Campaign-level
  name: string
  objective: MetaObjective
  // Default 'PAUSED' — operator hits Launch to flip to ACTIVE. If the
  // AI emits 'ACTIVE' we override (extra safety).
  initial_status: 'PAUSED' | 'ACTIVE'
  // ACO budget across ad sets. When set, ad-set-level budgets are
  // ignored. Defaults to "off" (per-ad-set budgeting).
  campaign_budget_optimization?: boolean
  daily_budget_cents?: number
  // The strategic story behind the campaign — why this audience, why
  // this angle, why this objective. Shown to the operator in the draft
  // review pane so they can sanity-check before launch.
  strategic_rationale: string
  // Predicted-performance ranges for the operator (best-effort —
  // explicitly framed as estimates, not commitments).
  expected_metrics?: {
    cpl_low_cents?: number
    cpl_high_cents?: number
    ctr_low_bps?: number // basis points (1.0% = 100 bps)
    ctr_high_bps?: number
    daily_leads_low?: number
    daily_leads_high?: number
  }
  ad_sets: MetaAdSet[]
}

/** Marketing API response after a successful launch. Stored on
 *  AdCampaignDraft.externalCampaignId + AdActivityLog.details. */
export interface MetaLaunchResult {
  ok: boolean
  campaignId?: string
  adSetIds?: string[]
  adIds?: string[]
  // Per-step error messages so the UI can show "campaign created, ad set
  // failed because X" rather than a generic "launch failed".
  errors?: string[]
}
