/**
 * AI recommendations engine.
 *
 * Reads the persisted metric tables (AdDailyMetric, AdCreativeMetric,
 * GoogleAdMetric) for an account, builds a structured "performance
 * snapshot" prompt, and asks Claude opus-4-7 to return a list of
 * actionable recommendations with priorities, rationales, and (where
 * relevant) draft copy or negative-keyword lists.
 *
 * Output shape mirrors AdRecommendation columns 1:1 so the API route
 * can persist verbatim. The model is instructed to be conservative —
 * it surfaces fewer high-quality recs rather than flooding the operator.
 *
 * No live API calls — pure DB read + LLM. The recs are advisory until
 * the operator clicks Apply (Phase 7f.5 will wire one-click apply).
 */

import Anthropic from '@anthropic-ai/sdk'
import { db } from './db'

const client = new Anthropic()
const MODEL = 'claude-opus-4-7'

export type RecommendationCategory =
  | 'budget'
  | 'pause_creative'
  | 'scale_creative'
  | 'audience'
  | 'add_negatives'
  | 'bid_strategy'
  | 'tracking'
  | 'creative_test'
  | 'landing_page'

export type RecommendationPriority = 'high' | 'medium' | 'low'
export type RecommendationConfidence = 'high' | 'medium' | 'low'

export interface RecommendationDraft {
  category: RecommendationCategory
  title: string
  description: string
  rationale: string
  affectedEntity?: string
  expectedImpact?: string
  impactRange?: string
  priority: RecommendationPriority
  confidence: RecommendationConfidence
  actionSteps: string[]
  draftNegatives?: string[]
  draftCopy?: { headline?: string; primary_text?: string; description?: string }
}

const SYSTEM_PROMPT = `You are a senior performance media buyer reviewing an ad account's last 30 days of performance data. You have spent $50M+ on Meta + Google Ads and you only surface recommendations that move the CPL/CPA needle.

Be conservative. Don't list 10 generic tips — surface 3-6 specific, high-leverage actions tied to the actual data. If nothing actionable jumps out, return fewer.

Categories you can recommend:
- budget — "Increase X ad set's budget by 20%" / "Cut Y's budget — wasted spend"
- pause_creative — "Pause ad ABC, $300 spent, 0 conversions" (only when SAMPLE SIZE supports the call — at least 50 link clicks or $200 spend)
- scale_creative — "Duplicate ad XYZ — 4x account-average CTR, scale aggressively"
- audience — "Audience is too narrow — broaden geo or interests" / "Audience overlap detected"
- add_negatives — "Add these negative keywords to stop wasted spend" (give 5-15 specific terms)
- bid_strategy — "Switch from Manual CPC to MAXIMIZE_CONVERSIONS — you've hit the volume threshold"
- tracking — "Conversion tracking missing on PMax — set up before scaling"
- creative_test — "Test a problem-led variant against the current outcome-led winner"
- landing_page — "Landing page converting at 1.2% — well below industry — likely the bottleneck, not the ads"

PRIORITY:
- HIGH: actively bleeding money OR a quick win that could double conversions.
- MEDIUM: meaningful incremental improvement.
- LOW: nice-to-have, longer-term.

CONFIDENCE:
- HIGH: clear statistical signal (high spend, big sample, obvious anomaly).
- MEDIUM: the pattern is suggestive but small sample.
- LOW: gut call based on best practice — explicitly say so in rationale.

EXPECTED IMPACT:
- Concrete language. "Could lower CPL from $42 to ~$28 ($14/lead × 200 leads/mo = $2,800/mo savings)."
- If uncertain, omit rather than guess.

ACTION STEPS:
- 2-5 imperative bullet points. "Pause ad ID 123abc." "Lower budget on ad set 'Sydney - 35-55' from $80/day to $50/day."

DRAFT COPY (only when category is creative_test or scale_creative):
- Provide a fully-formed alternative ad. Headline ≤40 char, primary_text ≤125 char.
- Different ANGLE from the current copy — not a one-word tweak.

DRAFT NEGATIVES (only when category is add_negatives):
- 5-15 specific keyword strings the operator should add as negatives.

AVOID:
- Generic advice ("test more creatives", "improve targeting") — useless without specificity.
- Recommendations not grounded in the data ("maybe try LinkedIn" — out of scope).
- Recommendations on metrics with insufficient sample (<10 conversions, <$100 spend on creative-level recs).`

const TOOL_SCHEMA = {
  type: 'object' as const,
  required: ['recommendations'],
  properties: {
    recommendations: {
      type: 'array',
      maxItems: 8,
      items: {
        type: 'object',
        required: ['category', 'title', 'description', 'rationale', 'priority', 'confidence', 'actionSteps'],
        properties: {
          category: {
            type: 'string',
            enum: ['budget', 'pause_creative', 'scale_creative', 'audience', 'add_negatives', 'bid_strategy', 'tracking', 'creative_test', 'landing_page'],
          },
          title: { type: 'string', minLength: 5, maxLength: 100 },
          description: { type: 'string', minLength: 20, maxLength: 400 },
          rationale: { type: 'string', minLength: 30, maxLength: 600 },
          affectedEntity: { type: 'string' },
          expectedImpact: { type: 'string' },
          impactRange: { type: 'string' },
          priority: { type: 'string', enum: ['high', 'medium', 'low'] },
          confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
          actionSteps: { type: 'array', minItems: 1, maxItems: 6, items: { type: 'string' } },
          draftNegatives: { type: 'array', items: { type: 'string' } },
          draftCopy: {
            type: 'object',
            properties: {
              headline: { type: 'string' },
              primary_text: { type: 'string' },
              description: { type: 'string' },
            },
          },
        },
      },
    },
  },
}

interface SnapshotData {
  provider: 'meta' | 'google'
  accountName: string
  daysCovered: number
  daily: Array<{ date: string; spend: number; impressions: number; clicks: number; leadsOrConv: number; ctr: number | null; cpl: number | null }>
  topCreatives?: Array<{ adId: string; adName?: string; spend: number; impressions: number; clicks: number; leads: number; ctr: number | null; cpl: number | null }>
  topCampaigns?: Array<{ campaignId: string; spend: number; impressions: number; clicks: number; conversions: number; cpc: number | null; impressionShare: number | null }>
}

/** Build the snapshot for a Meta account. */
async function snapshotMeta(accountId: string, daysBack: number): Promise<SnapshotData | null> {
  const since = new Date()
  since.setUTCDate(since.getUTCDate() - daysBack)
  since.setUTCHours(0, 0, 0, 0)
  const account = await db.metaAdAccount.findUnique({ where: { id: accountId }, select: { accountName: true } })
  if (!account) return null
  const [daily, creative] = await Promise.all([
    db.adDailyMetric.findMany({
      where: { accountId, date: { gte: since } },
      orderBy: { date: 'asc' },
      select: { date: true, spend: true, impressions: true, clicks: true, leads: true, ctr: true, cpl: true },
    }),
    db.adCreativeMetric.findMany({
      where: { accountId, date: { gte: since } },
      orderBy: { date: 'desc' },
    }),
  ])
  // Roll up creative across the window for top-spender summary.
  const byAd = new Map<string, { adName?: string; spend: number; impressions: number; clicks: number; leads: number }>()
  for (const r of creative) {
    const cur = byAd.get(r.adId) ?? { adName: r.adName ?? undefined, spend: 0, impressions: 0, clicks: 0, leads: 0 }
    cur.spend += Number(r.spend); cur.impressions += Number(r.impressions); cur.clicks += r.clicks; cur.leads += r.leads
    byAd.set(r.adId, cur)
  }
  const topCreatives = Array.from(byAd.entries())
    .map(([adId, t]) => ({
      adId,
      adName: t.adName,
      spend: t.spend,
      impressions: t.impressions,
      clicks: t.clicks,
      leads: t.leads,
      ctr: t.impressions > 0 ? t.clicks / t.impressions : null,
      cpl: t.leads > 0 ? t.spend / t.leads : null,
    }))
    .sort((a, b) => b.spend - a.spend)
    .slice(0, 15)

  return {
    provider: 'meta',
    accountName: account.accountName,
    daysCovered: daysBack,
    daily: daily.map((d) => ({
      date: d.date.toISOString().slice(0, 10),
      spend: Number(d.spend),
      impressions: Number(d.impressions),
      clicks: d.clicks,
      leadsOrConv: d.leads,
      ctr: d.ctr === null ? null : Number(d.ctr),
      cpl: d.cpl === null ? null : Number(d.cpl),
    })),
    topCreatives,
  }
}

/** Build the snapshot for a Google customer. */
async function snapshotGoogle(accountId: string, daysBack: number): Promise<SnapshotData | null> {
  const since = new Date()
  since.setUTCDate(since.getUTCDate() - daysBack)
  since.setUTCHours(0, 0, 0, 0)
  const account = await db.googleAdAccount.findUnique({ where: { id: accountId }, select: { accountName: true } })
  if (!account) return null
  const rows = await db.googleAdMetric.findMany({
    where: { accountId, date: { gte: since } },
    orderBy: { date: 'asc' },
  })
  // Per-day totals
  const byDate = new Map<string, { spend: number; impressions: number; clicks: number; conversions: number }>()
  const byCampaign = new Map<string, { spend: number; impressions: number; clicks: number; conversions: number; cpc: number | null; impressionShare: number | null }>()
  for (const r of rows) {
    const day = r.date.toISOString().slice(0, 10)
    const dCur = byDate.get(day) ?? { spend: 0, impressions: 0, clicks: 0, conversions: 0 }
    dCur.spend += Number(r.spend); dCur.impressions += Number(r.impressions); dCur.clicks += r.clicks; dCur.conversions += Number(r.conversions)
    byDate.set(day, dCur)
    const cCur = byCampaign.get(r.campaignId) ?? { spend: 0, impressions: 0, clicks: 0, conversions: 0, cpc: null, impressionShare: null }
    cCur.spend += Number(r.spend); cCur.impressions += Number(r.impressions); cCur.clicks += r.clicks; cCur.conversions += Number(r.conversions)
    if (r.cpc !== null) cCur.cpc = Number(r.cpc)
    if (r.impressionShare !== null) cCur.impressionShare = Number(r.impressionShare)
    byCampaign.set(r.campaignId, cCur)
  }
  const daily = Array.from(byDate.entries()).sort(([a], [b]) => a.localeCompare(b)).map(([date, t]) => ({
    date,
    spend: t.spend,
    impressions: t.impressions,
    clicks: t.clicks,
    leadsOrConv: t.conversions,
    ctr: t.impressions > 0 ? t.clicks / t.impressions : null,
    cpl: t.conversions > 0 ? t.spend / t.conversions : null,
  }))
  const topCampaigns = Array.from(byCampaign.entries())
    .map(([campaignId, t]) => ({ campaignId, ...t }))
    .sort((a, b) => b.spend - a.spend)
    .slice(0, 15)
  return {
    provider: 'google',
    accountName: account.accountName,
    daysCovered: daysBack,
    daily,
    topCampaigns,
  }
}

function buildPrompt(snap: SnapshotData): string {
  const totals = snap.daily.reduce(
    (acc, d) => {
      acc.spend += d.spend; acc.impressions += d.impressions; acc.clicks += d.clicks; acc.leadsOrConv += d.leadsOrConv
      return acc
    },
    { spend: 0, impressions: 0, clicks: 0, leadsOrConv: 0 },
  )
  const ctr = totals.impressions > 0 ? totals.clicks / totals.impressions : null
  const cpl = totals.leadsOrConv > 0 ? totals.spend / totals.leadsOrConv : null
  return `Analyse this ${snap.provider.toUpperCase()} ad account and return up to 6 SPECIFIC, ACTIONABLE recommendations.

Account: ${snap.accountName}
Window: last ${snap.daysCovered} days

PERIOD TOTALS:
- Spend: $${totals.spend.toFixed(2)}
- ${snap.provider === 'meta' ? 'Leads' : 'Conversions'}: ${totals.leadsOrConv}
- Impressions: ${totals.impressions.toLocaleString()}
- Clicks: ${totals.clicks.toLocaleString()}
- CTR: ${ctr === null ? 'n/a' : `${(ctr * 100).toFixed(2)}%`}
- ${snap.provider === 'meta' ? 'CPL' : 'CPA'}: ${cpl === null ? 'n/a' : `$${cpl.toFixed(2)}`}

DAILY (last ${snap.daily.length} days):
${snap.daily.map((d) => `${d.date}: $${d.spend.toFixed(0)} spent, ${d.leadsOrConv} ${snap.provider === 'meta' ? 'leads' : 'conv'}, ${(d.ctr ?? 0) * 100 < 0.01 ? '?' : ((d.ctr ?? 0) * 100).toFixed(2) + '%'} CTR`).join('\n')}

${snap.topCreatives ? `TOP 15 ADS BY SPEND:
${snap.topCreatives.map((a) => `- ${a.adName ?? a.adId}: $${a.spend.toFixed(0)} spent, ${a.leads} leads, ${a.ctr === null ? 'n/a' : ((a.ctr ?? 0) * 100).toFixed(2) + '%'} CTR, CPL ${a.cpl === null ? 'n/a' : '$' + a.cpl.toFixed(2)}`).join('\n')}` : ''}
${snap.topCampaigns ? `TOP 15 CAMPAIGNS BY SPEND:
${snap.topCampaigns.map((c) => `- ${c.campaignId}: $${c.spend.toFixed(0)} spent, ${c.conversions} conv, CPC $${c.cpc?.toFixed(2) ?? 'n/a'}, IS ${c.impressionShare === null ? 'n/a' : ((c.impressionShare ?? 0) * 100).toFixed(0) + '%'}`).join('\n')}` : ''}

Return recommendations via the return_recommendations tool. Be CONSERVATIVE — only surface things you're genuinely confident about. If the data is too thin to recommend something, say so in fewer recs (or zero) rather than padding the list.`
}

/** Generate AI recommendations for a single ad account. Persists each
 *  recommendation as an AdRecommendation row. Returns the inserted rows. */
export async function generateAccountRecommendations(args: {
  provider: 'meta' | 'google'
  accountId: string
  daysBack?: number
}): Promise<RecommendationDraft[]> {
  const days = args.daysBack ?? 30
  const snap = args.provider === 'meta'
    ? await snapshotMeta(args.accountId, days)
    : await snapshotGoogle(args.accountId, days)
  if (!snap) throw new Error(`account_not_found: ${args.accountId}`)
  if (snap.daily.length === 0) {
    // Don't waste tokens on an empty account — surface a single tracking
    // recommendation pointing at the missing data instead.
    return [{
      category: 'tracking',
      title: 'No metric data yet — connect tracking',
      description: `No metrics have been synced for "${snap.accountName}" in the last ${days} days. The cron may not have run yet, or this account may have no live campaigns.`,
      rationale: 'Without data, no other recommendations can be made.',
      priority: 'high',
      confidence: 'high',
      actionSteps: [
        'Confirm the account has at least one active campaign delivering impressions.',
        'Wait 24h for the next cron run, or hit /api/cron/sync-ad-metrics with the bearer token to backfill.',
      ],
    }]
  }
  const prompt = buildPrompt(snap)
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 8000,
    system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
    tools: [{
      name: 'return_recommendations',
      description: 'Return a prioritised list of specific, actionable ad-account recommendations.',
      input_schema: TOOL_SCHEMA,
    }],
    tool_choice: { type: 'tool', name: 'return_recommendations' },
    messages: [{ role: 'user', content: prompt }],
  })
  let raw: { recommendations?: RecommendationDraft[] } | null = null
  for (const block of response.content) {
    if (block.type === 'tool_use' && block.name === 'return_recommendations') {
      raw = block.input as { recommendations?: RecommendationDraft[] }
      break
    }
  }
  if (!raw) {
    throw new Error(`Model did not return recommendations. stop_reason=${response.stop_reason ?? 'unknown'}`)
  }
  return Array.isArray(raw.recommendations) ? raw.recommendations : []
}

/** Persist a list of drafts to AdRecommendation. */
export async function persistRecommendations(p: {
  provider: 'meta' | 'google'
  accountId: string
  drafts: RecommendationDraft[]
}): Promise<number> {
  let count = 0
  for (const d of p.drafts) {
    await db.adRecommendation.create({
      data: {
        ...(p.provider === 'meta' ? { metaAccountId: p.accountId } : { googleAccountId: p.accountId }),
        category: d.category,
        title: d.title.slice(0, 200),
        description: d.description.slice(0, 1000),
        rationale: d.rationale?.slice(0, 1000),
        affectedEntity: d.affectedEntity?.slice(0, 500),
        expectedImpact: d.expectedImpact?.slice(0, 500),
        impactRange: d.impactRange?.slice(0, 200),
        priority: d.priority,
        confidence: d.confidence,
        status: 'pending',
        actionSteps: d.actionSteps ?? [],
        draftNegatives: d.draftNegatives ?? [],
        draftCopy: (d.draftCopy as object) ?? undefined,
      },
    })
    count++
  }
  return count
}
