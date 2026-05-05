/**
 * Meta Marketing API Insights fetcher.
 *
 * One function per metric grain we sync:
 *  - fetchAccountDailyMetrics: per-account totals for a date range (-> AdDailyMetric)
 *  - fetchCreativeDailyMetrics: per-ad totals for a date range (-> AdCreativeMetric)
 *
 * No retry / queue here — the cron picks back up on the next run. We
 * deliberately request smaller date ranges (default last 3 days) so a
 * transient failure doesn't lose more than 72h of data, and the upsert
 * key (accountId+date) makes the next run idempotent.
 */

const META_API = 'https://graph.facebook.com/v21.0'

interface InsightsRow {
  date_start?: string
  spend?: string
  impressions?: string
  clicks?: string
  ctr?: string
  cpc?: string
  cpm?: string
  cost_per_action_type?: Array<{ action_type: string; value: string }>
  actions?: Array<{ action_type: string; value: string }>
  ad_id?: string
  ad_name?: string
}

interface AccountDailyRow {
  date: string
  spend: number // dollars (decimal-ish)
  leads: number
  impressions: number
  clicks: number
  cpl: number | null
  cpm: number | null
  ctr: number | null
  cpc: number | null
}

interface CreativeDailyRow {
  date: string
  adId: string
  adName?: string
  spend: number
  impressions: number
  clicks: number
  leads: number
  ctr: number | null
  cpl: number | null
}

const LEAD_ACTION_TYPES = new Set([
  'lead',
  'leadgen_grouped',
  'onsite_conversion.lead_grouped',
  'offsite_conversion.fb_pixel_lead',
])

function leadCount(actions: Array<{ action_type: string; value: string }> | undefined): number {
  if (!actions) return 0
  let total = 0
  for (const a of actions) {
    if (LEAD_ACTION_TYPES.has(a.action_type)) total += Number(a.value) || 0
  }
  return total
}

function isoDateNDaysAgo(n: number): string {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() - n)
  return d.toISOString().slice(0, 10)
}

function isoDateToday(): string {
  return new Date().toISOString().slice(0, 10)
}

/** Per-account daily totals. */
export async function fetchAccountDailyMetrics(args: {
  metaAccountId: string // bare numeric, no act_ prefix
  accessToken: string
  daysBack?: number // default 3
}): Promise<{ ok: true; rows: AccountDailyRow[] } | { ok: false; error: string }> {
  const days = args.daysBack ?? 3
  const since = isoDateNDaysAgo(days)
  const until = isoDateToday()
  const url = new URL(`${META_API}/act_${args.metaAccountId}/insights`)
  url.searchParams.set('access_token', args.accessToken)
  url.searchParams.set('time_increment', '1') // one row per day
  url.searchParams.set('time_range', JSON.stringify({ since, until }))
  url.searchParams.set('fields', 'spend,impressions,clicks,ctr,cpc,cpm,actions,cost_per_action_type')
  url.searchParams.set('limit', '500')

  const res = await fetch(url.toString())
  const json = (await res.json().catch(() => ({}))) as { data?: InsightsRow[]; error?: { message?: string } }
  if (!res.ok || json.error) {
    return { ok: false, error: json.error?.message ?? `HTTP ${res.status}` }
  }
  const rows: AccountDailyRow[] = (json.data ?? []).map((r) => {
    const spend = Number(r.spend) || 0
    const impressions = Number(r.impressions) || 0
    const clicks = Number(r.clicks) || 0
    const ctr = r.ctr ? Number(r.ctr) : null
    const cpc = r.cpc ? Number(r.cpc) : null
    const cpm = r.cpm ? Number(r.cpm) : null
    const leads = leadCount(r.actions)
    const cpl = leads > 0 ? spend / leads : null
    return {
      date: r.date_start ?? since,
      spend,
      impressions,
      clicks,
      ctr,
      cpc,
      cpm,
      leads,
      cpl,
    }
  })
  return { ok: true, rows }
}

/** Per-ad (creative) daily totals. */
export async function fetchCreativeDailyMetrics(args: {
  metaAccountId: string
  accessToken: string
  daysBack?: number
}): Promise<{ ok: true; rows: CreativeDailyRow[] } | { ok: false; error: string }> {
  const days = args.daysBack ?? 3
  const since = isoDateNDaysAgo(days)
  const until = isoDateToday()
  const url = new URL(`${META_API}/act_${args.metaAccountId}/insights`)
  url.searchParams.set('access_token', args.accessToken)
  url.searchParams.set('time_increment', '1')
  url.searchParams.set('time_range', JSON.stringify({ since, until }))
  url.searchParams.set('level', 'ad')
  url.searchParams.set('fields', 'ad_id,ad_name,spend,impressions,clicks,ctr,actions')
  url.searchParams.set('limit', '500')

  const res = await fetch(url.toString())
  const json = (await res.json().catch(() => ({}))) as { data?: InsightsRow[]; error?: { message?: string } }
  if (!res.ok || json.error) {
    return { ok: false, error: json.error?.message ?? `HTTP ${res.status}` }
  }
  const rows: CreativeDailyRow[] = (json.data ?? [])
    .filter((r) => r.ad_id)
    .map((r) => {
      const spend = Number(r.spend) || 0
      const impressions = Number(r.impressions) || 0
      const clicks = Number(r.clicks) || 0
      const ctr = r.ctr ? Number(r.ctr) : null
      const leads = leadCount(r.actions)
      const cpl = leads > 0 ? spend / leads : null
      return {
        date: r.date_start ?? since,
        adId: r.ad_id as string,
        adName: r.ad_name,
        spend,
        impressions,
        clicks,
        leads,
        ctr,
        cpl,
      }
    })
  return { ok: true, rows }
}
