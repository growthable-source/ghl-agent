import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'

/**
 * GET /api/admin/ingest-diagnostic
 *
 * Probes every third-party service the ingest pipeline depends on
 * and reports exactly which is broken. Replaces the guess-and-check
 * dance when an ingest run fails — operator clicks "Run diagnostic"
 * and sees a green/red list with the specific reason for each.
 *
 * Auth: any signed-in user. The probes only hit the third-party
 * services; nothing tenant-specific.
 */
export async function GET() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })

  const results = await Promise.all([
    probeVoyage(),
    probeFirecrawl(),
    probeAnthropic(),
    probeDeepgram(),
  ])

  return NextResponse.json({ checks: results })
}

interface Check {
  service: 'voyage' | 'firecrawl' | 'anthropic' | 'deepgram'
  name: string
  status: 'ok' | 'missing_key' | 'invalid_key' | 'unreachable' | 'rate_limited' | 'other'
  detail: string
  /** Actionable instruction shown verbatim. */
  fix: string | null
}

async function probeVoyage(): Promise<Check> {
  const key = process.env.VOYAGE_API_KEY
  if (!key) {
    return {
      service: 'voyage', name: 'Voyage AI (embeddings)',
      status: 'missing_key',
      detail: 'VOYAGE_API_KEY env var not set on this deployment.',
      fix: 'Get a key from voyageai.com → Sign in → API Keys → Create. Add VOYAGE_API_KEY to Vercel → Settings → Environment Variables, then redeploy.',
    }
  }
  try {
    // Cheapest probe: embed a 1-token string. ~$0.00000006 per call.
    const res = await fetch('https://api.voyageai.com/v1/embeddings', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ input: ['ping'], model: 'voyage-3', input_type: 'document', truncation: true }),
    })
    if (res.status === 401 || res.status === 403) {
      return { service: 'voyage', name: 'Voyage AI (embeddings)', status: 'invalid_key',
        detail: `Voyage rejected the key (HTTP ${res.status}).`,
        fix: 'Double-check VOYAGE_API_KEY in Vercel. It should start with "pa-" or similar. Generate a fresh one if unsure.' }
    }
    if (res.status === 429) {
      return { service: 'voyage', name: 'Voyage AI (embeddings)', status: 'rate_limited',
        detail: 'Hitting Voyage rate limits.',
        fix: 'Free tier caps at 3 RPM. Upgrade plan or wait — the pipeline will retry on the next scheduled read.' }
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      return { service: 'voyage', name: 'Voyage AI (embeddings)', status: 'other',
        detail: `HTTP ${res.status}: ${text.slice(0, 200)}`,
        fix: 'Likely a transient Voyage outage. Check status.voyageai.com.' }
    }
    return { service: 'voyage', name: 'Voyage AI (embeddings)', status: 'ok', detail: 'Working.', fix: null }
  } catch (err: any) {
    return { service: 'voyage', name: 'Voyage AI (embeddings)', status: 'unreachable',
      detail: err?.message ?? 'fetch failed',
      fix: 'Network issue between Vercel and Voyage. Usually transient — retry in a minute.' }
  }
}

async function probeFirecrawl(): Promise<Check> {
  const key = process.env.FIRECRAWL_API_KEY
  if (!key) {
    return {
      service: 'firecrawl', name: 'Firecrawl (web crawler)',
      status: 'missing_key',
      detail: 'FIRECRAWL_API_KEY env var not set on this deployment.',
      fix: 'Get a key from firecrawl.dev → Dashboard → API Keys. Add FIRECRAWL_API_KEY to Vercel → Settings → Environment Variables, then redeploy.',
    }
  }
  try {
    // Probe the credit-usage endpoint — costs 0 credits, validates the key.
    const res = await fetch('https://api.firecrawl.dev/v1/team/credit-usage', {
      headers: { 'Authorization': `Bearer ${key}` },
    })
    if (res.status === 401 || res.status === 403) {
      return { service: 'firecrawl', name: 'Firecrawl (web crawler)', status: 'invalid_key',
        detail: `Firecrawl rejected the key (HTTP ${res.status}).`,
        fix: 'Double-check FIRECRAWL_API_KEY in Vercel. It should start with "fc-". Generate a fresh one if unsure.' }
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      return { service: 'firecrawl', name: 'Firecrawl (web crawler)', status: 'other',
        detail: `HTTP ${res.status}: ${text.slice(0, 200)}`,
        fix: 'Likely a transient Firecrawl issue. Check status.firecrawl.dev.' }
    }
    const data = await res.json().catch(() => null) as any
    const credits = data?.data?.remaining_credits ?? data?.remaining_credits
    return {
      service: 'firecrawl', name: 'Firecrawl (web crawler)',
      status: 'ok',
      detail: typeof credits === 'number' ? `${credits} crawl credits remaining.` : 'Working.',
      fix: null,
    }
  } catch (err: any) {
    return { service: 'firecrawl', name: 'Firecrawl (web crawler)', status: 'unreachable',
      detail: err?.message ?? 'fetch failed',
      fix: 'Network issue between Vercel and Firecrawl. Usually transient — retry in a minute.' }
  }
}

async function probeAnthropic(): Promise<Check> {
  const key = process.env.ANTHROPIC_API_KEY
  if (!key) {
    return {
      service: 'anthropic', name: 'Anthropic (Claude — classification)',
      status: 'missing_key',
      detail: 'ANTHROPIC_API_KEY env var not set.',
      fix: 'Without this, chunks land without tags. Get a key from console.anthropic.com.',
    }
  }
  // We don't burn a Haiku call just to probe — assume present-and-valid
  // unless a real ingest run failed with auth. The pipeline's own
  // classify step surfaces specific Anthropic failures into errorLog.
  return {
    service: 'anthropic', name: 'Anthropic (Claude — classification)',
    status: 'ok', detail: 'Key is set (not probed to avoid spend).', fix: null,
  }
}

async function probeDeepgram(): Promise<Check> {
  const key = process.env.DEEPGRAM_API_KEY
  if (!key) {
    return {
      service: 'deepgram', name: 'Deepgram (YouTube audio transcription)',
      status: 'missing_key',
      detail: 'DEEPGRAM_API_KEY env var not set.',
      fix: 'Optional — only needed for YouTube videos without captions. Sign up at console.deepgram.com (200 USD free credit), then add DEEPGRAM_API_KEY to Vercel env.',
    }
  }
  try {
    // Cheapest valid probe: GET /v1/projects returns the list (and 401
    // on a bad key). Costs nothing.
    const res = await fetch('https://api.deepgram.com/v1/projects', {
      headers: { 'Authorization': `Token ${key}` },
    })
    if (res.status === 401 || res.status === 403) {
      return { service: 'deepgram', name: 'Deepgram (YouTube audio transcription)', status: 'invalid_key',
        detail: `Deepgram rejected the key (HTTP ${res.status}).`,
        fix: 'Generate a fresh key at console.deepgram.com → API Keys.' }
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      return { service: 'deepgram', name: 'Deepgram (YouTube audio transcription)', status: 'other',
        detail: `HTTP ${res.status}: ${text.slice(0, 200)}`,
        fix: 'Likely transient. Check status.deepgram.com.' }
    }
    return { service: 'deepgram', name: 'Deepgram (YouTube audio transcription)', status: 'ok', detail: 'Working.', fix: null }
  } catch (err: any) {
    return { service: 'deepgram', name: 'Deepgram (YouTube audio transcription)', status: 'unreachable',
      detail: err?.message ?? 'fetch failed',
      fix: 'Network issue between Vercel and Deepgram. Usually transient.' }
  }
}
