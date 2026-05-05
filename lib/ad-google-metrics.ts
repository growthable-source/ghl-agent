/**
 * Google Ads metrics fetcher via googleAds:searchStream.
 *
 * Two grains:
 *  - fetchCustomerDailyMetrics: per-customer daily totals across all
 *    campaigns (rolled up). Used for the dashboard headlines.
 *  - fetchCampaignDailyMetrics: per-campaign daily, which we persist to
 *    GoogleAdMetric for charting + recommendation source data.
 *
 * Reuses lib/ad-google-client.refreshGoogleAdsAccessToken — caller is
 * responsible for passing in a fresh access_token rather than refreshing
 * inside each call (cron does it once per account, then both fetchers
 * piggy-back on the same token).
 */

const GOOGLE_ADS_API = 'https://googleads.googleapis.com/v20'

interface CustomerDailyRow {
  date: string // YYYY-MM-DD
  spend: number // dollars
  impressions: number
  clicks: number
  conversions: number
  conversionValue: number
  ctr: number | null
  cpc: number | null
  cpm: number | null
  costPerConversion: number | null
}

interface CampaignDailyRow extends CustomerDailyRow {
  campaignId: string
  impressionShare: number | null
}

function isoDateNDaysAgo(n: number): string {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() - n)
  return d.toISOString().slice(0, 10)
}
function isoDateToday(): string { return new Date().toISOString().slice(0, 10) }

/**
 * Send a GAQL query against searchStream and collect the streamed rows.
 *
 * The endpoint returns a JSON array of stream chunks; each chunk has
 * `results: GoogleAdsRow[]`. We flatten into one array.
 */
async function searchStream(p: {
  customerId: string
  accessToken: string
  developerToken: string
  loginCustomerId?: string
  query: string
}): Promise<{ ok: true; rows: Record<string, unknown>[] } | { ok: false; error: string }> {
  const url = `${GOOGLE_ADS_API}/customers/${p.customerId}/googleAds:searchStream`
  let res: Response
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${p.accessToken}`,
        'developer-token': p.developerToken,
        'Content-Type': 'application/json',
        ...(p.loginCustomerId ? { 'login-customer-id': p.loginCustomerId } : {}),
      },
      body: JSON.stringify({ query: p.query }),
    })
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'network_error' }
  }
  const json = (await res.json().catch(() => ({}))) as Array<{ results?: Record<string, unknown>[]; error?: { message?: string } }>
  if (!res.ok) {
    const errBody = (json as unknown as { error?: { message?: string } }).error
    return { ok: false, error: errBody?.message ?? `HTTP ${res.status}` }
  }
  const rows: Record<string, unknown>[] = []
  for (const chunk of Array.isArray(json) ? json : []) {
    if (chunk.error) return { ok: false, error: chunk.error.message ?? 'searchStream_error' }
    for (const r of chunk.results ?? []) rows.push(r)
  }
  return { ok: true, rows }
}

/** micros (1e-6 of currency unit) → dollars. Google returns spend in micros. */
function microsToDollars(micros: unknown): number {
  if (typeof micros === 'string') return Number(micros) / 1_000_000
  if (typeof micros === 'number') return micros / 1_000_000
  return 0
}

export async function fetchCampaignDailyMetrics(args: {
  customerId: string
  accessToken: string
  developerToken: string
  loginCustomerId?: string
  daysBack?: number
}): Promise<{ ok: true; rows: CampaignDailyRow[] } | { ok: false; error: string }> {
  const days = args.daysBack ?? 3
  // GAQL: `WHERE segments.date BETWEEN '...' AND '...'` is the standard
  // shape. Quotes around dates required. customer-level segments.date
  // gives one row per (campaign, date).
  const query = `
    SELECT
      campaign.id,
      campaign.status,
      segments.date,
      metrics.cost_micros,
      metrics.impressions,
      metrics.clicks,
      metrics.conversions,
      metrics.conversions_value,
      metrics.ctr,
      metrics.average_cpc,
      metrics.average_cpm,
      metrics.cost_per_conversion,
      metrics.search_impression_share
    FROM campaign
    WHERE segments.date BETWEEN '${isoDateNDaysAgo(days)}' AND '${isoDateToday()}'
  `
  const res = await searchStream({
    customerId: args.customerId,
    accessToken: args.accessToken,
    developerToken: args.developerToken,
    loginCustomerId: args.loginCustomerId,
    query,
  })
  if (!res.ok) return res

  const rows: CampaignDailyRow[] = res.rows.map((r) => {
    const campaign = (r.campaign as Record<string, unknown>) ?? {}
    const segments = (r.segments as Record<string, unknown>) ?? {}
    const metrics = (r.metrics as Record<string, unknown>) ?? {}
    return {
      date: typeof segments.date === 'string' ? (segments.date as string) : isoDateToday(),
      campaignId: typeof campaign.id === 'string' ? (campaign.id as string) : String(campaign.id ?? ''),
      spend: microsToDollars(metrics.costMicros),
      impressions: Number(metrics.impressions) || 0,
      clicks: Number(metrics.clicks) || 0,
      conversions: Number(metrics.conversions) || 0,
      conversionValue: Number(metrics.conversionsValue) || 0,
      ctr: typeof metrics.ctr === 'number' ? (metrics.ctr as number) : null,
      cpc: typeof metrics.averageCpc !== 'undefined' ? microsToDollars(metrics.averageCpc) : null,
      cpm: typeof metrics.averageCpm !== 'undefined' ? microsToDollars(metrics.averageCpm) : null,
      costPerConversion:
        typeof metrics.costPerConversion !== 'undefined' ? microsToDollars(metrics.costPerConversion) : null,
      impressionShare:
        typeof metrics.searchImpressionShare === 'number'
          ? (metrics.searchImpressionShare as number)
          : null,
    }
  })
  return { ok: true, rows }
}

/**
 * Customer-level rollup. Just sums campaign rows so we don't pay for a
 * second searchStream when the cron already pulled per-campaign. Kept
 * separate so callers can request just the rollup.
 */
export function rollupCustomerDaily(rows: CampaignDailyRow[]): CustomerDailyRow[] {
  const byDate = new Map<string, CustomerDailyRow>()
  for (const r of rows) {
    const cur = byDate.get(r.date) ?? {
      date: r.date,
      spend: 0,
      impressions: 0,
      clicks: 0,
      conversions: 0,
      conversionValue: 0,
      ctr: null,
      cpc: null,
      cpm: null,
      costPerConversion: null,
    }
    cur.spend += r.spend
    cur.impressions += r.impressions
    cur.clicks += r.clicks
    cur.conversions += r.conversions
    cur.conversionValue += r.conversionValue
    byDate.set(r.date, cur)
  }
  // Compute derived metrics from totals (more reliable than averaging).
  for (const cur of byDate.values()) {
    cur.ctr = cur.impressions > 0 ? cur.clicks / cur.impressions : null
    cur.cpc = cur.clicks > 0 ? cur.spend / cur.clicks : null
    cur.cpm = cur.impressions > 0 ? (cur.spend / cur.impressions) * 1000 : null
    cur.costPerConversion = cur.conversions > 0 ? cur.spend / cur.conversions : null
  }
  return Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date))
}
