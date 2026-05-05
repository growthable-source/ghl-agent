/**
 * Shared types for the Google Ads launcher: operator intake, AI-generated
 * campaign draft (persisted to AdCampaignDraft.payload with platform=
 * 'google'), and the launch result shape.
 *
 * Modeled after lib/ad-meta-types.ts but specific to Google's API
 * concepts: campaign + budget + ad group + responsive search ad
 * (asset-based) for Search/PMax.
 */

export type GoogleCampaignType =
  | 'SEARCH'
  | 'PERFORMANCE_MAX'
  | 'DISPLAY'
  | 'VIDEO'

export type GoogleBiddingStrategy =
  | 'MAXIMIZE_CONVERSIONS'
  | 'MAXIMIZE_CONVERSION_VALUE'
  | 'TARGET_CPA'
  | 'TARGET_ROAS'
  | 'MANUAL_CPC'

export type GoogleObjective =
  | 'LEADS'
  | 'SALES'
  | 'WEBSITE_TRAFFIC'
  | 'BRAND_AWARENESS'

export interface GoogleCampaignIntake {
  business_name: string
  product_offer: string
  dream_outcome: string
  audience_description: string
  destination_url: string
  daily_budget_cents: number
  // High-level objective the operator wants. The AI maps this to a
  // bidding strategy + campaign type combination.
  objective: GoogleObjective
  // Default SEARCH unless operator explicitly picks otherwise. PMax
  // requires conversion tracking — the AI surfaces a warning in the
  // strategic_rationale when those are missing.
  campaign_type?: GoogleCampaignType
  industry?: string
  // ISO 3166-1 alpha-2. Default ['US'].
  countries?: string[]
  // Conversion-tracking action resource name — required for
  // TARGET_CPA / TARGET_ROAS / MAXIMIZE_CONVERSIONS / PMax.
  // Format: customers/<id>/conversionActions/<id>
  conversion_action?: string
  // For TARGET_CPA: target CPA in account currency (cents).
  target_cpa_cents?: number
  // For TARGET_ROAS: target ROAS multiplier (e.g. 3.5 for 350%).
  target_roas?: number
  // Number of ad groups (Search) or asset groups (PMax). Default 1.
  num_ad_groups?: number
}

export interface GoogleResponsiveSearchAd {
  // Up to 15 headlines per ad. Each ≤30 chars.
  headlines: string[]
  // Up to 4 descriptions per ad. Each ≤90 chars.
  descriptions: string[]
  // Final URL the ad lands on (overrides the campaign default if set).
  final_url?: string
  // Optional path1 / path2 — display URL fragments (≤15 chars each).
  path1?: string
  path2?: string
}

export interface GoogleAdGroup {
  name: string
  // Default keyword max CPC bid (only used by MANUAL_CPC). For automated
  // bidding strategies this is ignored by the API but kept here for the
  // UI to display the AI's reasoning.
  default_max_cpc_cents?: number
  // For SEARCH campaigns: keyword themes the AI emits. Each is a
  // keyword string + match type. Resolved at launch into individual
  // keyword resources.
  keywords?: Array<{ text: string; match_type: 'EXACT' | 'PHRASE' | 'BROAD' }>
  // For SEARCH campaigns: negative keywords to exclude.
  negative_keywords?: Array<{ text: string; match_type: 'EXACT' | 'PHRASE' | 'BROAD' }>
  // One Responsive Search Ad per ad group (Google's recommended pattern).
  ads: GoogleResponsiveSearchAd[]
  targeting_rationale?: string
}

export interface GoogleCampaignDraft {
  name: string
  campaign_type: GoogleCampaignType
  objective: GoogleObjective
  bidding_strategy: GoogleBiddingStrategy
  // Initial status — always PAUSED. We never trust the model with ENABLED.
  initial_status: 'PAUSED'
  daily_budget_cents: number
  // ISO 3166-1 alpha-2 country codes for geo targeting.
  geo_targets: string[]
  conversion_action?: string
  target_cpa_cents?: number
  target_roas?: number
  strategic_rationale: string
  expected_metrics?: {
    cpa_low_cents?: number
    cpa_high_cents?: number
    daily_conversions_low?: number
    daily_conversions_high?: number
    impression_share_low?: number // 0..1
    impression_share_high?: number
  }
  ad_groups: GoogleAdGroup[]
}

export interface GoogleLaunchResult {
  ok: boolean
  campaignId?: string // resource name: customers/<cid>/campaigns/<id>
  budgetId?: string
  adGroupIds?: string[]
  adIds?: string[]
  errors?: string[]
}
