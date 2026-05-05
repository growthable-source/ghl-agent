'use client'

/**
 * New ad-campaign wizard.
 *
 * Steps:
 *   1. Pick platform + ad account (and optionally attach to a funnel
 *      campaign so the destination URL auto-fills to the landing page).
 *   2. Brief: product offer, dream outcome, audience, daily budget,
 *      objective, country, age range.
 *   3. Generate (Claude streams the AI draft into AdCampaignDraft).
 *   4. Redirect to /ads/drafts/[id] for the operator to review + launch.
 *
 * Voxility-style design tokens throughout. The same animation pattern as
 * the funnel wizard is reused, but with media-buyer-themed status lines.
 */

import { useEffect, useState, type CSSProperties } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'

interface MetaAdAccountRow { id: string; accountName: string; metaAccountId: string; isActive: boolean }
interface GoogleAdAccountRow { id: string; accountName: string; googleCustomerId: string; isActive: boolean }
interface FunnelOption { id: string; name: string; landingPage: { slug: string; published: boolean } | null }

const card: CSSProperties = {
  background: 'var(--surface)',
  borderWidth: '1px',
  borderStyle: 'solid',
  borderColor: 'var(--border)',
}
const btnPrimary: CSSProperties = {
  background: 'var(--accent-primary)',
  color: 'var(--btn-primary-text)',
}
const btnSecondary: CSSProperties = {
  background: 'var(--surface-secondary)',
  borderWidth: '1px',
  borderStyle: 'solid',
  borderColor: 'var(--border)',
  color: 'var(--text-primary)',
}
const inputStyle: CSSProperties = {
  background: 'var(--input-bg)',
  borderColor: 'var(--input-border)',
  color: 'var(--input-text)',
}

const OBJECTIVES: { value: string; label: string; description: string }[] = [
  { value: 'OUTCOME_LEADS', label: 'Leads', description: 'Maximise lead-form completions or offsite conversions' },
  { value: 'OUTCOME_SALES', label: 'Sales', description: 'Optimise for purchases tracked via your Pixel' },
  { value: 'OUTCOME_TRAFFIC', label: 'Traffic', description: 'Pure link clicks — best when no Pixel events exist yet' },
  { value: 'OUTCOME_AWARENESS', label: 'Awareness', description: 'Reach + brand lift; not for direct response' },
  { value: 'OUTCOME_ENGAGEMENT', label: 'Engagement', description: 'Comments, shares, post engagement' },
]

export default function NewAdCampaignPage() {
  const params = useParams<{ workspaceId: string }>()
  const router = useRouter()
  const { workspaceId } = params

  const [step, setStep] = useState(1)
  const [meta, setMeta] = useState<MetaAdAccountRow[]>([])
  const [google, setGoogle] = useState<GoogleAdAccountRow[]>([])
  const [funnels, setFunnels] = useState<FunnelOption[]>([])

  // Step 1
  const [platform, setPlatform] = useState<'meta' | 'google'>('meta')
  const [adAccountId, setAdAccountId] = useState('')
  const [funnelCampaignId, setFunnelCampaignId] = useState('')

  // Step 2
  const [businessName, setBusinessName] = useState('')
  const [productOffer, setProductOffer] = useState('')
  const [dreamOutcome, setDreamOutcome] = useState('')
  const [audience, setAudience] = useState('')
  const [destinationUrl, setDestinationUrl] = useState('')
  const [dailyBudget, setDailyBudget] = useState('50') // dollars in UI, cents on the wire
  const [objective, setObjective] = useState('OUTCOME_LEADS')
  const [countries, setCountries] = useState('US')
  const [ageMin, setAgeMin] = useState('25')
  const [ageMax, setAgeMax] = useState('65')

  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!workspaceId) return
    Promise.all([
      fetch(`/api/workspaces/${workspaceId}/ad-accounts`).then((r) => r.json()).catch(() => ({ meta: [], google: [] })),
      fetch(`/api/workspaces/${workspaceId}/funnels`).then((r) => r.json()).catch(() => ({ campaigns: [] })),
    ]).then(([accounts, fnnels]) => {
      setMeta(accounts.meta || [])
      setGoogle(accounts.google || [])
      setFunnels((fnnels.campaigns || []) as FunnelOption[])
    })
  }, [workspaceId])

  // Auto-fill destination + business name when a funnel is selected.
  useEffect(() => {
    if (!funnelCampaignId) return
    const f = funnels.find((c) => c.id === funnelCampaignId)
    if (!f) return
    if (f.landingPage?.slug) {
      const origin = typeof window !== 'undefined' ? window.location.origin : ''
      setDestinationUrl(`${origin}/p/${f.landingPage.slug}`)
    }
    if (f.name && !productOffer) setProductOffer(f.name)
  }, [funnelCampaignId, funnels, productOffer])

  const activeMeta = meta.filter((a) => a.isActive)
  const activeGoogle = google.filter((a) => a.isActive)
  const noAccounts = activeMeta.length === 0 && activeGoogle.length === 0

  function step1Valid(): boolean {
    return !!adAccountId
  }
  function step2Valid(): boolean {
    return !!(businessName && productOffer && dreamOutcome && audience && destinationUrl && dailyBudget)
  }

  async function generate() {
    if (!step2Valid()) return
    setGenerating(true)
    setError(null)
    try {
      if (platform === 'google') {
        // Phase 7d will wire this. Surface a clear 501 instead of a
        // mysterious 404.
        throw new Error('Google Ads campaign generation lands in Phase 7d. For now use Meta or generate the brief and we’ll wire Google next.')
      }
      const dailyBudgetCents = Math.round(parseFloat(dailyBudget) * 100)
      const countryList = countries.split(/[,\s]+/).map((c) => c.trim().toUpperCase()).filter(Boolean)
      const body = {
        business_name: businessName.trim(),
        product_offer: productOffer.trim(),
        dream_outcome: dreamOutcome.trim(),
        audience_description: audience.trim(),
        destination_url: destinationUrl.trim(),
        daily_budget_cents: dailyBudgetCents,
        objective,
        countries: countryList.length ? countryList : ['US'],
        age_min: parseInt(ageMin, 10) || 18,
        age_max: parseInt(ageMax, 10) || 65,
        ...(funnelCampaignId ? { campaignId: funnelCampaignId } : {}),
      }
      const r = await fetch(`/api/workspaces/${workspaceId}/ad-drafts/meta`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!r.ok) {
        const err = (await r.json().catch(() => ({}))) as { error?: string; detail?: string }
        throw new Error(err.detail || err.error || `HTTP ${r.status}`)
      }
      const { draft } = await r.json()
      router.push(`/dashboard/${workspaceId}/ads/drafts/${draft.id}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Generation failed')
    } finally {
      setGenerating(false)
    }
  }

  if (noAccounts) {
    return (
      <main className="mx-auto w-full max-w-3xl px-6 py-10">
        <Link href={`/dashboard/${workspaceId}/ads`} className="text-sm hover:underline" style={{ color: 'var(--accent-primary)' }}>
          ← Back
        </Link>
        <div className="mt-6 rounded-xl p-8 text-center" style={card}>
          <h2 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>No ad accounts connected</h2>
          <p className="mt-2 text-sm" style={{ color: 'var(--text-secondary)' }}>
            Connect Meta Ads or Google Ads in Integrations to start drafting campaigns.
          </p>
          <Link
            href={`/dashboard/${workspaceId}/integrations`}
            className="mt-4 inline-flex h-9 items-center rounded-lg px-4 text-xs font-medium"
            style={btnPrimary}
          >
            Go to Integrations
          </Link>
        </div>
      </main>
    )
  }

  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-10">
      <Link href={`/dashboard/${workspaceId}/ads`} className="text-sm hover:underline" style={{ color: 'var(--accent-primary)' }}>
        ← Back
      </Link>
      <h1 className="mt-3 text-2xl font-semibold tracking-tight" style={{ color: 'var(--text-primary)' }}>New campaign</h1>
      <p className="mt-1 text-sm" style={{ color: 'var(--text-secondary)' }}>
        An AI media buyer drafts the campaign, ad sets, and ad copy. You review and launch — nothing goes live until you say so.
      </p>

      {/* Stepper */}
      <div className="mt-5 flex items-center gap-2">
        {[1, 2, 3].map((s) => (
          <div key={s} className="flex items-center gap-2">
            <span
              className="inline-flex h-7 w-7 items-center justify-center rounded-full text-xs font-medium"
              style={
                s <= step
                  ? { background: 'var(--accent-primary)', color: 'var(--btn-primary-text)' }
                  : { background: 'var(--surface-secondary)', color: 'var(--text-tertiary)' }
              }
            >
              {s}
            </span>
            <span className="text-xs" style={{ color: s <= step ? 'var(--text-primary)' : 'var(--text-tertiary)' }}>
              {s === 1 ? 'Account' : s === 2 ? 'Brief' : 'Generate'}
            </span>
            {s < 3 && <span className="mx-1 text-xs" style={{ color: 'var(--text-tertiary)' }}>—</span>}
          </div>
        ))}
      </div>

      {error && (
        <div className="mt-4 rounded-lg p-3 text-sm" style={{ background: 'var(--accent-red-bg)', color: 'var(--accent-red)' }}>
          {error}
        </div>
      )}

      {/* Step 1: Account */}
      {step === 1 && (
        <div className="mt-6 space-y-4">
          <div className="rounded-xl p-5" style={card}>
            <h2 className="text-sm font-semibold mb-3" style={{ color: 'var(--text-primary)' }}>Platform</h2>
            <div className="grid grid-cols-2 gap-2">
              {(['meta', 'google'] as const).map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => { setPlatform(p); setAdAccountId('') }}
                  className="rounded-lg p-3 text-left text-sm"
                  style={
                    platform === p
                      ? { ...card, borderColor: 'var(--accent-primary)', background: 'var(--surface)' }
                      : card
                  }
                >
                  <p className="font-medium" style={{ color: 'var(--text-primary)' }}>
                    {p === 'meta' ? 'Meta Ads' : 'Google Ads'}
                  </p>
                  <p className="text-xs mt-0.5" style={{ color: 'var(--text-tertiary)' }}>
                    {p === 'meta' ? 'Facebook + Instagram' : 'Search + Performance Max'}
                  </p>
                </button>
              ))}
            </div>
          </div>

          <div className="rounded-xl p-5" style={card}>
            <h2 className="text-sm font-semibold mb-3" style={{ color: 'var(--text-primary)' }}>Ad account</h2>
            <select
              value={adAccountId}
              onChange={(e) => setAdAccountId(e.target.value)}
              className="w-full rounded-lg px-3 py-2 text-sm"
              style={inputStyle}
            >
              <option value="">Select an account…</option>
              {(platform === 'meta' ? activeMeta : activeGoogle).map((a) => (
                <option key={a.id} value={a.id}>
                  {a.accountName} {platform === 'meta' ? `(act_${(a as MetaAdAccountRow).metaAccountId})` : `(${(a as GoogleAdAccountRow).googleCustomerId})`}
                </option>
              ))}
            </select>
          </div>

          <div className="rounded-xl p-5" style={card}>
            <h2 className="text-sm font-semibold mb-1" style={{ color: 'var(--text-primary)' }}>Attach to a funnel <span className="text-xs font-normal" style={{ color: 'var(--text-tertiary)' }}>(optional)</span></h2>
            <p className="text-xs mb-3" style={{ color: 'var(--text-tertiary)' }}>
              Linking a funnel auto-fills the destination URL and lets us pre-fill business name + offer from the page.
            </p>
            <select
              value={funnelCampaignId}
              onChange={(e) => setFunnelCampaignId(e.target.value)}
              className="w-full rounded-lg px-3 py-2 text-sm"
              style={inputStyle}
            >
              <option value="">No funnel (use a custom URL)</option>
              {funnels.map((f) => (
                <option key={f.id} value={f.id}>{f.name}{f.landingPage ? ` — /p/${f.landingPage.slug}` : ''}</option>
              ))}
            </select>
          </div>

          <div className="flex justify-end">
            <button
              type="button"
              disabled={!step1Valid()}
              onClick={() => setStep(2)}
              className="inline-flex h-10 items-center rounded-lg px-5 text-sm font-medium disabled:opacity-50"
              style={btnPrimary}
            >
              Next: Brief →
            </button>
          </div>
        </div>
      )}

      {/* Step 2: Brief */}
      {step === 2 && (
        <div className="mt-6 space-y-4">
          <div className="rounded-xl p-5 space-y-3" style={card}>
            <Field label="Business name" value={businessName} onChange={setBusinessName} />
            <Field label="Product / offer" value={productOffer} onChange={setProductOffer} placeholder="Free 30-day chiropractic audit" />
            <Field label="Dream outcome (what the prospect wants)" value={dreamOutcome} onChange={setDreamOutcome} placeholder="Add 12 new patients/month without spending on ads" />
            <Field label="Audience" value={audience} onChange={setAudience} placeholder="Australian chiropractors with 1-3 locations, $300-$800k revenue" textarea />
            <Field label="Destination URL" value={destinationUrl} onChange={setDestinationUrl} placeholder="https://yoursite.com/landing" />
          </div>

          <div className="rounded-xl p-5 space-y-3" style={card}>
            <h3 className="text-xs uppercase tracking-wider" style={{ color: 'var(--text-tertiary)' }}>Budget &amp; objective</h3>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Daily budget ($)" value={dailyBudget} onChange={setDailyBudget} type="number" />
              <div>
                <label className="block text-xs mb-1.5" style={{ color: 'var(--text-secondary)' }}>Objective</label>
                <select value={objective} onChange={(e) => setObjective(e.target.value)} className="w-full rounded-lg px-3 py-2 text-sm" style={inputStyle}>
                  {OBJECTIVES.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
                <p className="mt-1 text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
                  {OBJECTIVES.find((o) => o.value === objective)?.description}
                </p>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <Field label="Countries (comma-separated)" value={countries} onChange={setCountries} placeholder="US, AU" />
              <Field label="Age min" value={ageMin} onChange={setAgeMin} type="number" />
              <Field label="Age max" value={ageMax} onChange={setAgeMax} type="number" />
            </div>
          </div>

          <div className="flex justify-between">
            <button type="button" onClick={() => setStep(1)} className="inline-flex h-10 items-center rounded-lg px-4 text-xs font-medium" style={btnSecondary}>
              ← Back
            </button>
            <button
              type="button"
              disabled={!step2Valid()}
              onClick={() => { setStep(3); generate() }}
              className="inline-flex h-10 items-center rounded-lg px-5 text-sm font-medium disabled:opacity-50"
              style={btnPrimary}
            >
              Generate campaign →
            </button>
          </div>
        </div>
      )}

      {/* Step 3: Generating */}
      {step === 3 && (
        <div className="mt-10 rounded-xl p-10 text-center" style={card}>
          {generating ? (
            <GeneratingAnimation />
          ) : error ? (
            <div>
              <p className="text-sm mb-3" style={{ color: 'var(--accent-red)' }}>{error}</p>
              <button
                type="button"
                onClick={() => setStep(2)}
                className="inline-flex h-9 items-center rounded-lg px-4 text-xs font-medium"
                style={btnSecondary}
              >
                ← Edit brief
              </button>
            </div>
          ) : null}
        </div>
      )}
    </main>
  )
}

function Field(props: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  type?: string
  textarea?: boolean
}) {
  return (
    <div>
      <label className="block text-xs mb-1.5" style={{ color: 'var(--text-secondary)' }}>{props.label}</label>
      {props.textarea ? (
        <textarea
          value={props.value}
          onChange={(e) => props.onChange(e.target.value)}
          placeholder={props.placeholder}
          className="w-full min-h-[80px] rounded-lg px-3 py-2 text-sm"
          style={inputStyle}
        />
      ) : (
        <input
          type={props.type ?? 'text'}
          value={props.value}
          onChange={(e) => props.onChange(e.target.value)}
          placeholder={props.placeholder}
          className="w-full rounded-lg px-3 py-2 text-sm"
          style={inputStyle}
        />
      )}
    </div>
  )
}

function GeneratingAnimation() {
  const STATUS = [
    'Reading the brief…',
    'Choosing the optimisation goal…',
    'Picking the ad-set targeting…',
    'Drafting the hook…',
    'Stacking proof into the body…',
    'Writing the call-to-action…',
    'Predicting CPL ranges…',
    'Tightening the copy…',
    'Almost done…',
  ]
  const QUOTES = [
    { text: 'The audience is everything.', author: 'Eugene Schwartz' },
    { text: 'A great idea will only sell to people in the market for it.', author: 'Gary Bencivenga' },
    { text: 'Test everything. Trust no one.', author: 'David Ogilvy' },
    { text: 'Money flows to where attention is.', author: 'Gary Vaynerchuk' },
    { text: 'The best targeting is a great offer.', author: 'Direct response cliché, but true.' },
  ]
  const [statusIdx, setStatusIdx] = useState(0)
  const [quoteIdx, setQuoteIdx] = useState(0)

  useEffect(() => {
    const a = setInterval(() => setStatusIdx((i) => (i + 1) % STATUS.length), 4000)
    const b = setInterval(() => setQuoteIdx((i) => (i + 1) % QUOTES.length), 7000)
    return () => { clearInterval(a); clearInterval(b) }
  }, [STATUS.length, QUOTES.length])

  return (
    <div className="flex flex-col items-center gap-6">
      <div className="relative w-20 h-20">
        <div className="absolute inset-0 rounded-full opacity-30 animate-ping" style={{ background: 'var(--accent-primary)' }} />
        <div className="absolute inset-2 rounded-full opacity-60 animate-pulse" style={{ background: 'var(--accent-primary)' }} />
        <div className="absolute inset-5 rounded-full" style={{ background: 'var(--accent-primary)' }} />
      </div>
      <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{STATUS[statusIdx]}</p>
      <div className="max-w-md">
        <p className="text-xs italic" style={{ color: 'var(--text-secondary)' }}>&ldquo;{QUOTES[quoteIdx].text}&rdquo;</p>
        <p className="mt-1 text-[10px] uppercase tracking-wider" style={{ color: 'var(--text-tertiary)' }}>— {QUOTES[quoteIdx].author}</p>
      </div>
    </div>
  )
}
