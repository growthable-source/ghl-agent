/**
 * Meta ad-campaign generator.
 *
 * Anthropic Claude (claude-opus-4-7) with tool calling for typed JSON
 * output. Same shape as lib/vsl-generator.ts (system prompt cached,
 * forced tool_choice — no thinking because tool_choice forces tool use,
 * which is incompatible with `thinking`).
 *
 * Inputs: a MetaCampaignIntake. Outputs: a MetaCampaignDraft ready to
 * persist to AdCampaignDraft.payload.
 */

import Anthropic from '@anthropic-ai/sdk'
import type {
  MetaCampaignDraft,
  MetaCampaignIntake,
  MetaAdSet,
  MetaAdCreative,
  MetaObjective,
  MetaOptimizationGoal,
  MetaBillingEvent,
  MetaCallToAction,
} from './ad-meta-types'

const client = new Anthropic()
// Was pinned to Opus; now routed through the provider layer (lib/llm) so it
// defaults to cheaper Claude Sonnet and can move to DeepSeek via
// LLM_GENERATOR_MODEL. Parsing below is unchanged (layer returns the
// Anthropic-shaped message).
const MODEL = process.env.LLM_GENERATOR_MODEL || 'claude-sonnet'
const msg = async (params: Parameters<typeof client.messages.create>[0]) => {
  const { createMessage } = await import('@/lib/llm')
  return createMessage(MODEL, params as never, { surface: 'ad-meta' }) as unknown as Anthropic.Messages.Message
}

const SYSTEM_PROMPT = `You are a senior performance media buyer who has spent $50M+ on Meta Ads across health, wealth, education, and B2B services. You build campaigns that generate qualified leads at the lowest possible CPA.

You know the platform cold:

OBJECTIVES (post-2023 ODAX):
- OUTCOME_LEADS: lead-form ads OR offsite conversions optimised for leads. Best for service businesses, agencies, coaches.
- OUTCOME_SALES: ecommerce purchases via Pixel events. Requires pixel_id + conversion_event.
- OUTCOME_TRAFFIC: link clicks. Use only when no Pixel events are firing.
- OUTCOME_AWARENESS / OUTCOME_ENGAGEMENT: top-of-funnel. Avoid unless explicitly asked.

OPTIMIZATION GOAL & BILLING:
- Lead generation (form on Meta) → optimization_goal=LEAD_GENERATION, billing_event=IMPRESSIONS
- Offsite conversions (your landing page form) → optimization_goal=OFFSITE_CONVERSIONS, billing_event=IMPRESSIONS, requires promoted_object{pixel_id, custom_event_type}
- Pure traffic → optimization_goal=LINK_CLICKS, billing_event=LINK_CLICKS

AD COPY RULES:
- HEADLINE (40 char ideal, 60 hard cap): the single line that earns the click. Specific outcome > vague benefit. Numbers + timeframes win.
- PRIMARY TEXT (125 char ideal, 1000 hard cap): the body. Open with the hook, agitate the pain, name the mechanism, single CTA.
- DESCRIPTION (30 char ideal): subline under the headline in News Feed link ads. Keep it punchy.
- CALL TO ACTION: pick the lowest-friction option that matches the offer.
  - Free guide / lead magnet → SIGN_UP, LEARN_MORE
  - Booking a call → BOOK_TRAVEL, APPLY_NOW, CONTACT_US
  - Quote / estimate → GET_QUOTE
  - Free trial / sub → SIGN_UP, SUBSCRIBE
  - Discount offer → GET_OFFER
  - Ecommerce → SHOP_NOW
- AVOID AI-tells: "unlock," "supercharge," "transform," "elevate," "in today's world." Concrete > clever.

TARGETING RULES:
- Geo: respect operator-supplied countries. Default ['US'] if missing.
- Age: respect operator override; default 25-65 for B2B/services, 18-65 for B2C/ecommerce.
- Interest keywords: emit 3-8 specific interest STRINGS — e.g. ["Functional medicine", "Anti-aging", "Healthtech founders"]. The launcher resolves these against Meta's interest taxonomy at deploy time. Don't emit interest IDs.
- For OUTCOME_SALES / OUTCOME_LEADS with offsite conversions, lean broad — let the algorithm find the buyer; interests just seed exploration.

VARIANTS:
- Default to ONE ad set with TWO ad variants (different angle each). The operator can request more variants explicitly.
- Each variant should test a meaningfully different ANGLE (problem-first vs outcome-first vs proof-first), not the same copy with one word changed.
- Use body_alternates / headline_alternates for dynamic-creative variations within a single ad.

BUDGET:
- daily_budget_cents lives at AD-SET level by default. Do NOT set campaign_budget_optimization=true unless the operator has multiple ad sets you want to optimise across.
- Always echo the operator's daily_budget_cents — don't invent a different number.

STRATEGIC RATIONALE:
- 2-4 sentences. Why this objective, why this audience, why this angle. Show the operator the thinking.
- Concrete: "Targeting ages 35-55 in AU because chiropractors typically need to be established in their practice (35+) to have the budget for a $497/mo program but young enough to still be growing (under 55)."

EXPECTED METRICS:
- Conservative ranges, NOT promises. Be honest. cpl_low_cents and cpl_high_cents should be 2-3x apart.
- For service-business lead gen at $50-200 CPL, that's 5000-20000 cents.
- For ecommerce sales, CPL becomes CPA; ranges depend on product price.
- If you genuinely can't predict (insufficient context), omit expected_metrics rather than make up numbers.

initial_status MUST be "PAUSED". The operator launches it explicitly.`

const TOOL_SCHEMA = {
  type: 'object' as const,
  required: ['name', 'objective', 'initial_status', 'strategic_rationale', 'ad_sets'],
  properties: {
    name: { type: 'string', description: 'Campaign name. Format: "<offer> — <date>" e.g. "Free Chiro Audit — Q2 2026".' },
    objective: {
      type: 'string',
      enum: [
        'OUTCOME_LEADS',
        'OUTCOME_TRAFFIC',
        'OUTCOME_SALES',
        'OUTCOME_AWARENESS',
        'OUTCOME_ENGAGEMENT',
      ],
    },
    initial_status: { type: 'string', enum: ['PAUSED'] },
    campaign_budget_optimization: { type: 'boolean' },
    daily_budget_cents: { type: 'integer', minimum: 100 },
    strategic_rationale: { type: 'string', minLength: 80 },
    expected_metrics: {
      type: 'object',
      properties: {
        cpl_low_cents: { type: 'integer' },
        cpl_high_cents: { type: 'integer' },
        ctr_low_bps: { type: 'integer' },
        ctr_high_bps: { type: 'integer' },
        daily_leads_low: { type: 'number' },
        daily_leads_high: { type: 'number' },
      },
    },
    ad_sets: {
      type: 'array',
      minItems: 1,
      maxItems: 6,
      items: {
        type: 'object',
        required: ['name', 'optimization_goal', 'billing_event', 'daily_budget_cents', 'targeting', 'ads'],
        properties: {
          name: { type: 'string' },
          optimization_goal: {
            type: 'string',
            enum: ['LEAD_GENERATION', 'OFFSITE_CONVERSIONS', 'LINK_CLICKS', 'IMPRESSIONS', 'REACH', 'POST_ENGAGEMENT'],
          },
          billing_event: {
            type: 'string',
            enum: ['IMPRESSIONS', 'LINK_CLICKS', 'POST_ENGAGEMENT', 'PAGE_LIKES'],
          },
          daily_budget_cents: { type: 'integer', minimum: 100 },
          targeting: {
            type: 'object',
            required: ['geo_locations', 'age_min', 'age_max'],
            properties: {
              geo_locations: {
                type: 'object',
                required: ['countries'],
                properties: {
                  countries: { type: 'array', items: { type: 'string' } },
                },
              },
              age_min: { type: 'integer', minimum: 13, maximum: 65 },
              age_max: { type: 'integer', minimum: 13, maximum: 65 },
              interest_keywords: { type: 'array', items: { type: 'string' } },
              detailed_targeting_rationale: { type: 'string' },
            },
          },
          promoted_object: {
            type: 'object',
            properties: {
              pixel_id: { type: 'string' },
              custom_event_type: { type: 'string' },
            },
          },
          ads: {
            type: 'array',
            minItems: 1,
            maxItems: 6,
            items: {
              type: 'object',
              required: ['name', 'primary_text', 'headline', 'call_to_action'],
              properties: {
                name: { type: 'string' },
                primary_text: { type: 'string', minLength: 20, maxLength: 1000 },
                headline: { type: 'string', minLength: 5, maxLength: 80 },
                description: { type: 'string', maxLength: 80 },
                call_to_action: {
                  type: 'string',
                  enum: ['LEARN_MORE','SIGN_UP','GET_QUOTE','CONTACT_US','BOOK_TRAVEL','APPLY_NOW','DOWNLOAD','GET_OFFER','SHOP_NOW','SUBSCRIBE'],
                },
                body_alternates: { type: 'array', items: { type: 'string' } },
                headline_alternates: { type: 'array', items: { type: 'string' } },
              },
            },
          },
        },
      },
    },
  },
}

function userPrompt(intake: MetaCampaignIntake): string {
  return `Build a Meta Ads campaign for this business.

Business: ${intake.business_name}
${intake.industry ? `Industry: ${intake.industry}` : ''}
Offer / product: ${intake.product_offer}
Dream outcome (what the prospect actually wants): ${intake.dream_outcome}
Audience: ${intake.audience_description}
Destination URL (where the click lands): ${intake.destination_url}
Daily budget (cents): ${intake.daily_budget_cents}
Operator-stated objective: ${intake.objective}
${intake.num_ad_variants ? `Number of ad variants: ${intake.num_ad_variants}` : ''}
${intake.countries?.length ? `Country targeting: ${intake.countries.join(', ')}` : ''}
${intake.age_min ? `Age min: ${intake.age_min}` : ''}
${intake.age_max ? `Age max: ${intake.age_max}` : ''}
${intake.pixel_id ? `Pixel ID: ${intake.pixel_id}` : ''}
${intake.conversion_event ? `Conversion event: ${intake.conversion_event}` : ''}

Return the complete campaign via the return_meta_campaign tool. ONE ad set with TWO ad variants is the default unless num_ad_variants overrides. initial_status MUST be PAUSED.`
}

export async function generateMetaCampaign(input: {
  intake: MetaCampaignIntake
}): Promise<MetaCampaignDraft> {
  const { intake } = input
  if (!intake.business_name || !intake.product_offer || !intake.dream_outcome || !intake.destination_url) {
    throw new Error('intake.business_name, product_offer, dream_outcome, and destination_url are required')
  }
  if (!intake.daily_budget_cents || intake.daily_budget_cents < 100) {
    throw new Error('daily_budget_cents must be at least 100 (Meta minimum is $1/day)')
  }

  const response = await msg({
    model: MODEL,
    max_tokens: 12000,
    system: [
      { type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } },
    ],
    tools: [
      {
        name: 'return_meta_campaign',
        description: 'Return the complete Meta Ads campaign draft (campaign + ad sets + ads) as typed JSON.',
        input_schema: TOOL_SCHEMA,
      },
    ],
    tool_choice: { type: 'tool', name: 'return_meta_campaign' },
    messages: [{ role: 'user', content: userPrompt(intake) }],
  })

  let raw: Record<string, unknown> | null = null
  for (const block of response.content) {
    if (block.type === 'tool_use' && block.name === 'return_meta_campaign') {
      raw = block.input as Record<string, unknown>
      break
    }
  }
  if (!raw) {
    throw new Error(`Model did not return a campaign draft. stop_reason=${response.stop_reason ?? 'unknown'}`)
  }

  return normaliseDraft(raw, intake)
}

function normaliseDraft(raw: Record<string, unknown>, intake: MetaCampaignIntake): MetaCampaignDraft {
  const objective = (raw.objective as MetaObjective) ?? intake.objective
  const adSetsRaw = Array.isArray(raw.ad_sets) ? raw.ad_sets : []
  const adSets: MetaAdSet[] = adSetsRaw.map((s) => normaliseAdSet(s as Record<string, unknown>, intake))

  // Force PAUSED — never trust the model with ACTIVE.
  const draft: MetaCampaignDraft = {
    name: typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : `${intake.product_offer.slice(0, 40)} — ${new Date().toISOString().slice(0, 10)}`,
    objective,
    initial_status: 'PAUSED',
    strategic_rationale: typeof raw.strategic_rationale === 'string' ? raw.strategic_rationale : '',
    ad_sets: adSets.length > 0 ? adSets : [defaultAdSet(intake)],
  }
  if (typeof raw.campaign_budget_optimization === 'boolean') {
    draft.campaign_budget_optimization = raw.campaign_budget_optimization
  }
  if (typeof raw.daily_budget_cents === 'number') {
    draft.daily_budget_cents = raw.daily_budget_cents
  }
  if (raw.expected_metrics && typeof raw.expected_metrics === 'object') {
    const em = raw.expected_metrics as Record<string, unknown>
    const out: NonNullable<MetaCampaignDraft['expected_metrics']> = {}
    for (const k of ['cpl_low_cents', 'cpl_high_cents', 'ctr_low_bps', 'ctr_high_bps', 'daily_leads_low', 'daily_leads_high'] as const) {
      if (typeof em[k] === 'number') out[k] = em[k] as number
    }
    if (Object.keys(out).length > 0) draft.expected_metrics = out
  }
  return draft
}

function normaliseAdSet(raw: Record<string, unknown>, intake: MetaCampaignIntake): MetaAdSet {
  const targeting = (raw.targeting ?? {}) as Record<string, unknown>
  const geo = (targeting.geo_locations ?? {}) as Record<string, unknown>
  const adsRaw = Array.isArray(raw.ads) ? raw.ads : []
  const ads: MetaAdCreative[] = adsRaw.map((a) => normaliseAd(a as Record<string, unknown>))

  const set: MetaAdSet = {
    name: typeof raw.name === 'string' ? raw.name : 'Ad set',
    optimization_goal: (raw.optimization_goal as MetaOptimizationGoal) ?? 'LINK_CLICKS',
    billing_event: (raw.billing_event as MetaBillingEvent) ?? 'IMPRESSIONS',
    daily_budget_cents: typeof raw.daily_budget_cents === 'number' ? raw.daily_budget_cents : intake.daily_budget_cents,
    targeting: {
      geo_locations: {
        countries: Array.isArray(geo.countries) ? (geo.countries as string[]) : (intake.countries ?? ['US']),
      },
      age_min: typeof targeting.age_min === 'number' ? (targeting.age_min as number) : (intake.age_min ?? 18),
      age_max: typeof targeting.age_max === 'number' ? (targeting.age_max as number) : (intake.age_max ?? 65),
      interest_keywords: Array.isArray(targeting.interest_keywords)
        ? (targeting.interest_keywords as string[])
        : undefined,
      detailed_targeting_rationale: typeof targeting.detailed_targeting_rationale === 'string'
        ? (targeting.detailed_targeting_rationale as string)
        : undefined,
    },
    ads: ads.length > 0 ? ads : [defaultAd(intake)],
  }
  if (raw.promoted_object && typeof raw.promoted_object === 'object') {
    const po = raw.promoted_object as Record<string, unknown>
    if (typeof po.pixel_id === 'string' && typeof po.custom_event_type === 'string') {
      set.promoted_object = { pixel_id: po.pixel_id, custom_event_type: po.custom_event_type }
    }
  }
  return set
}

function normaliseAd(raw: Record<string, unknown>): MetaAdCreative {
  return {
    name: typeof raw.name === 'string' ? raw.name : 'Ad',
    primary_text: typeof raw.primary_text === 'string' ? raw.primary_text : '',
    headline: typeof raw.headline === 'string' ? raw.headline : '',
    description: typeof raw.description === 'string' ? raw.description : undefined,
    call_to_action: (raw.call_to_action as MetaCallToAction) ?? 'LEARN_MORE',
    body_alternates: Array.isArray(raw.body_alternates) ? (raw.body_alternates as string[]) : undefined,
    headline_alternates: Array.isArray(raw.headline_alternates) ? (raw.headline_alternates as string[]) : undefined,
  }
}

function defaultAdSet(intake: MetaCampaignIntake): MetaAdSet {
  return {
    name: 'Default ad set',
    optimization_goal: 'LINK_CLICKS',
    billing_event: 'IMPRESSIONS',
    daily_budget_cents: intake.daily_budget_cents,
    targeting: {
      geo_locations: { countries: intake.countries ?? ['US'] },
      age_min: intake.age_min ?? 18,
      age_max: intake.age_max ?? 65,
    },
    ads: [defaultAd(intake)],
  }
}

function defaultAd(intake: MetaCampaignIntake): MetaAdCreative {
  return {
    name: 'Default ad',
    primary_text: intake.product_offer,
    headline: intake.dream_outcome.slice(0, 60),
    call_to_action: 'LEARN_MORE',
  }
}
