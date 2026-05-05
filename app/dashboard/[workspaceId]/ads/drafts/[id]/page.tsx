'use client'

/**
 * Draft review + launch page.
 *
 * Shows the AI-generated MetaCampaignDraft as nested cards (campaign →
 * ad sets → ads). Operator can:
 *  - Edit name + ad-set-level / ad-level fields inline.
 *  - Pick which ad account to launch into.
 *  - Optionally provide a Page ID for ad creatives.
 *  - Hit Launch — POSTs to /launch which creates everything in Meta.
 *  - Delete the draft.
 *
 * After a successful launch, externalCampaignId is set and the page
 * locks editing (you'd diverge from Meta state).
 */

import { useEffect, useState, type CSSProperties } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import type {
  MetaAdCreative,
  MetaAdSet,
  MetaCampaignDraft,
  MetaLaunchResult,
} from '@/lib/ad-meta-types'

interface DraftRow {
  id: string
  name: string
  platform: string
  payload: MetaCampaignDraft & { destination_url?: string }
  aiReasoning: string | null
  externalCampaignId: string | null
  campaignId: string | null
  createdAt: string
  updatedAt: string
}

interface MetaAdAccountRow { id: string; accountName: string; metaAccountId: string; isActive: boolean }

const card: CSSProperties = {
  background: 'var(--surface)',
  borderWidth: '1px',
  borderStyle: 'solid',
  borderColor: 'var(--border)',
}
const btnPrimary: CSSProperties = { background: 'var(--accent-primary)', color: 'var(--btn-primary-text)' }
const btnSecondary: CSSProperties = { background: 'var(--surface-secondary)', borderWidth: '1px', borderStyle: 'solid', borderColor: 'var(--border)', color: 'var(--text-primary)' }
const btnDestructive: CSSProperties = { background: 'var(--accent-red-bg)', color: 'var(--accent-red)', borderWidth: '1px', borderStyle: 'solid', borderColor: 'var(--accent-red)' }
const inputStyle: CSSProperties = { background: 'var(--input-bg)', borderColor: 'var(--input-border)', color: 'var(--input-text)' }

export default function DraftDetailPage() {
  const params = useParams<{ workspaceId: string; id: string }>()
  const router = useRouter()
  const { workspaceId, id } = params

  const [draft, setDraft] = useState<DraftRow | null>(null)
  const [meta, setMeta] = useState<MetaAdAccountRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // Launch form state
  const [launchAccountId, setLaunchAccountId] = useState('')
  const [launchPageId, setLaunchPageId] = useState('')
  const [launchResult, setLaunchResult] = useState<MetaLaunchResult | null>(null)

  useEffect(() => {
    if (!workspaceId || !id) return
    Promise.all([
      fetch(`/api/workspaces/${workspaceId}/ad-drafts/meta/${id}`).then(async (r) => {
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? `HTTP ${r.status}`)
        return r.json() as Promise<{ draft: DraftRow }>
      }),
      fetch(`/api/workspaces/${workspaceId}/ad-accounts`).then((r) => r.json()).catch(() => ({ meta: [] })),
    ])
      .then(([d, accounts]) => {
        setDraft(d.draft)
        setMeta((accounts.meta || []).filter((a: MetaAdAccountRow) => a.isActive))
        if ((accounts.meta || []).length === 1) setLaunchAccountId(accounts.meta[0].id)
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Load failed'))
      .finally(() => setLoading(false))
  }, [workspaceId, id])

  async function persist(next: DraftRow) {
    setBusy(true)
    try {
      const r = await fetch(`/api/workspaces/${workspaceId}/ad-drafts/meta/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: next.name, payload: next.payload }),
      })
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? `HTTP ${r.status}`)
      const { draft: saved } = await r.json()
      setDraft(saved)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setBusy(false)
    }
  }

  function patchPayload(mut: (p: MetaCampaignDraft) => MetaCampaignDraft) {
    if (!draft) return
    const nextPayload = mut({ ...draft.payload })
    persist({ ...draft, payload: { ...nextPayload, destination_url: draft.payload.destination_url } })
  }

  async function destroy() {
    if (!draft) return
    if (!window.confirm(`Delete draft "${draft.name}"? This cannot be undone.`)) return
    setBusy(true)
    try {
      const r = await fetch(`/api/workspaces/${workspaceId}/ad-drafts/meta/${id}`, { method: 'DELETE' })
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? `HTTP ${r.status}`)
      router.push(`/dashboard/${workspaceId}/ads`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed')
      setBusy(false)
    }
  }

  async function launch() {
    if (!draft || !launchAccountId) return
    setBusy(true)
    setLaunchResult(null)
    try {
      const r = await fetch(`/api/workspaces/${workspaceId}/ad-drafts/meta/${id}/launch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          metaAdAccountId: launchAccountId,
          ...(launchPageId ? { pageId: launchPageId.trim() } : {}),
        }),
      })
      const result = (await r.json()) as MetaLaunchResult & { error?: string; detail?: string }
      if (!r.ok && !result.campaignId) {
        throw new Error(result.detail || result.error || `Launch failed (HTTP ${r.status})`)
      }
      setLaunchResult(result)
      // Refresh draft to pick up externalCampaignId.
      const refresh = await fetch(`/api/workspaces/${workspaceId}/ad-drafts/meta/${id}`).then((x) => x.json())
      setDraft(refresh.draft)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Launch failed')
    } finally {
      setBusy(false)
    }
  }

  if (loading) {
    return (
      <main className="mx-auto w-full max-w-4xl px-6 py-10">
        <div className="rounded-xl p-8 text-center text-sm" style={{ ...card, color: 'var(--text-tertiary)' }}>
          Loading draft…
        </div>
      </main>
    )
  }
  if (!draft) {
    return (
      <main className="mx-auto w-full max-w-4xl px-6 py-10">
        <Link href={`/dashboard/${workspaceId}/ads`} className="text-sm hover:underline" style={{ color: 'var(--accent-primary)' }}>← Back</Link>
        <div className="mt-6 rounded-xl p-8 text-center" style={card}>
          <h2 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>Draft not found</h2>
          {error && <p className="mt-2 text-sm" style={{ color: 'var(--accent-red)' }}>{error}</p>}
        </div>
      </main>
    )
  }

  const launched = !!draft.externalCampaignId

  return (
    <main className="mx-auto w-full max-w-4xl px-6 py-10">
      <Link href={`/dashboard/${workspaceId}/ads`} className="text-sm hover:underline" style={{ color: 'var(--accent-primary)' }}>
        ← Ads
      </Link>

      <header className="mt-3 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <input
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            onBlur={() => persist(draft)}
            disabled={launched}
            className="w-full bg-transparent text-2xl font-semibold tracking-tight focus:outline-none disabled:opacity-70"
            style={{ color: 'var(--text-primary)' }}
          />
          <div className="mt-1 flex items-center gap-2 text-xs">
            <span className="px-1.5 py-0.5 rounded uppercase tracking-wider" style={{ background: 'var(--surface-secondary)', color: 'var(--text-tertiary)' }}>
              {draft.platform}
            </span>
            <span className="px-2 py-0.5 rounded-full" style={{
              background: launched ? 'var(--accent-emerald-bg)' : 'var(--accent-amber-bg)',
              color: launched ? 'var(--accent-emerald)' : 'var(--accent-amber)',
            }}>
              {launched ? `Launched · ${draft.externalCampaignId}` : 'Draft'}
            </span>
          </div>
        </div>
        {!launched && (
          <button
            type="button"
            onClick={destroy}
            disabled={busy}
            className="inline-flex h-9 items-center rounded-lg px-3 text-xs font-medium"
            style={btnDestructive}
          >
            Delete draft
          </button>
        )}
      </header>

      {error && (
        <div className="mt-4 rounded-lg p-3 text-sm" style={{ background: 'var(--accent-red-bg)', color: 'var(--accent-red)' }}>
          {error}
        </div>
      )}

      {/* Strategic rationale */}
      {draft.payload.strategic_rationale && (
        <section className="mt-6 rounded-xl p-5" style={card}>
          <h2 className="text-xs uppercase tracking-wider mb-2" style={{ color: 'var(--text-tertiary)' }}>Why this campaign</h2>
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>{draft.payload.strategic_rationale}</p>
          {draft.payload.expected_metrics && (
            <div className="mt-3 grid grid-cols-2 md:grid-cols-3 gap-2 text-xs">
              {draft.payload.expected_metrics.cpl_low_cents != null && (
                <Stat label="Expected CPL" value={`$${(draft.payload.expected_metrics.cpl_low_cents / 100).toFixed(0)}–$${((draft.payload.expected_metrics.cpl_high_cents ?? draft.payload.expected_metrics.cpl_low_cents) / 100).toFixed(0)}`} />
              )}
              {draft.payload.expected_metrics.ctr_low_bps != null && (
                <Stat label="Expected CTR" value={`${(draft.payload.expected_metrics.ctr_low_bps / 100).toFixed(2)}–${((draft.payload.expected_metrics.ctr_high_bps ?? draft.payload.expected_metrics.ctr_low_bps) / 100).toFixed(2)}%`} />
              )}
              {draft.payload.expected_metrics.daily_leads_low != null && (
                <Stat label="Expected daily leads" value={`${draft.payload.expected_metrics.daily_leads_low}–${draft.payload.expected_metrics.daily_leads_high ?? draft.payload.expected_metrics.daily_leads_low}`} />
              )}
            </div>
          )}
        </section>
      )}

      {/* Ad sets */}
      <section className="mt-6 space-y-4">
        {draft.payload.ad_sets.map((set, setIdx) => (
          <AdSetCard
            key={setIdx}
            set={set}
            disabled={launched}
            onChange={(next) => patchPayload((p) => {
              const ad_sets = p.ad_sets.map((s, i) => i === setIdx ? next : s)
              return { ...p, ad_sets }
            })}
          />
        ))}
      </section>

      {/* Launch panel */}
      {!launched && (
        <section className="mt-8 rounded-xl p-5" style={card}>
          <h2 className="text-sm font-semibold mb-1" style={{ color: 'var(--text-primary)' }}>Launch to Meta</h2>
          <p className="text-xs mb-4" style={{ color: 'var(--text-tertiary)' }}>
            The campaign goes live in <code style={{ color: 'var(--accent-primary)' }}>PAUSED</code> state — you have to flip it to ACTIVE in Meta Ads Manager.
          </p>
          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <label className="block text-xs mb-1.5" style={{ color: 'var(--text-secondary)' }}>Ad account</label>
              <select value={launchAccountId} onChange={(e) => setLaunchAccountId(e.target.value)} className="w-full rounded-lg px-3 py-2 text-sm" style={inputStyle}>
                <option value="">Pick an account…</option>
                {meta.map((a) => (
                  <option key={a.id} value={a.id}>{a.accountName} (act_{a.metaAccountId})</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs mb-1.5" style={{ color: 'var(--text-secondary)' }}>Page ID <span className="opacity-60">(for ad creatives)</span></label>
              <input value={launchPageId} onChange={(e) => setLaunchPageId(e.target.value)} placeholder="e.g. 1234567890" className="w-full rounded-lg px-3 py-2 text-sm" style={inputStyle} />
              <p className="mt-1 text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
                Without a Page, the campaign + ad sets create but ads will be skipped.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={launch}
            disabled={busy || !launchAccountId}
            className="mt-4 inline-flex h-10 items-center rounded-lg px-5 text-sm font-medium disabled:opacity-50"
            style={btnPrimary}
          >
            {busy ? 'Launching…' : 'Launch campaign'}
          </button>

          {launchResult && (
            <div className="mt-4 rounded-lg p-3 text-xs" style={{
              background: launchResult.ok ? 'var(--accent-emerald-bg)' : 'var(--accent-amber-bg)',
              color: launchResult.ok ? 'var(--accent-emerald)' : 'var(--accent-amber)',
            }}>
              <p className="font-medium">
                {launchResult.ok
                  ? `Launched · campaign ${launchResult.campaignId} · ${launchResult.adSetIds?.length ?? 0} ad sets · ${launchResult.adIds?.length ?? 0} ads`
                  : `Partial launch · campaign ${launchResult.campaignId ?? '—'} · ${launchResult.errors?.length ?? 0} errors`}
              </p>
              {launchResult.errors && launchResult.errors.length > 0 && (
                <ul className="mt-2 list-disc list-inside space-y-0.5">
                  {launchResult.errors.map((e, i) => <li key={i}>{e}</li>)}
                </ul>
              )}
            </div>
          )}
        </section>
      )}

      {launched && (
        <section className="mt-8 rounded-xl p-5" style={card}>
          <h2 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Launched</h2>
          <p className="mt-1 text-xs" style={{ color: 'var(--text-secondary)' }}>
            This campaign is now in Meta Ads Manager as <code style={{ color: 'var(--accent-primary)' }}>{draft.externalCampaignId}</code>. Edits to the draft from here are blocked — change the campaign in Meta directly, or duplicate this draft to iterate.
          </p>
        </section>
      )}
    </main>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg p-2" style={{ background: 'var(--surface-secondary)' }}>
      <p className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--text-tertiary)' }}>{label}</p>
      <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{value}</p>
    </div>
  )
}

function AdSetCard({ set, onChange, disabled }: {
  set: MetaAdSet
  onChange: (next: MetaAdSet) => void
  disabled?: boolean
}) {
  const card: CSSProperties = { background: 'var(--surface)', borderWidth: '1px', borderStyle: 'solid', borderColor: 'var(--border)' }
  return (
    <div className="rounded-xl p-5" style={card}>
      <div className="flex items-center justify-between gap-3 mb-3">
        <input
          value={set.name}
          onChange={(e) => onChange({ ...set, name: e.target.value })}
          disabled={disabled}
          className="text-base font-semibold bg-transparent focus:outline-none w-full"
          style={{ color: 'var(--text-primary)' }}
        />
        <div className="flex items-center gap-1.5 text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
          <span>${(set.daily_budget_cents / 100).toFixed(0)}/day</span>
          <span>·</span>
          <span>{set.optimization_goal}</span>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-[11px]">
        <Pill label="Countries" value={set.targeting.geo_locations.countries.join(', ')} />
        <Pill label="Age" value={`${set.targeting.age_min}–${set.targeting.age_max}`} />
        <Pill label="Bid" value="Lowest cost" />
        <Pill label="Billing" value={set.billing_event} />
      </div>

      {set.targeting.detailed_targeting_rationale && (
        <p className="mt-3 text-xs italic" style={{ color: 'var(--text-secondary)' }}>
          {set.targeting.detailed_targeting_rationale}
        </p>
      )}

      <div className="mt-4 space-y-3">
        {set.ads.map((ad, adIdx) => (
          <AdCard
            key={adIdx}
            ad={ad}
            disabled={disabled}
            onChange={(next) => onChange({ ...set, ads: set.ads.map((a, i) => i === adIdx ? next : a) })}
          />
        ))}
      </div>
    </div>
  )
}

function AdCard({ ad, onChange, disabled }: {
  ad: MetaAdCreative
  onChange: (next: MetaAdCreative) => void
  disabled?: boolean
}) {
  return (
    <div className="rounded-lg p-3" style={{ background: 'var(--surface-secondary)' }}>
      <input
        value={ad.headline}
        onChange={(e) => onChange({ ...ad, headline: e.target.value })}
        disabled={disabled}
        className="w-full bg-transparent text-sm font-semibold focus:outline-none"
        style={{ color: 'var(--text-primary)' }}
        placeholder="Headline"
      />
      <textarea
        value={ad.primary_text}
        onChange={(e) => onChange({ ...ad, primary_text: e.target.value })}
        disabled={disabled}
        className="w-full mt-2 bg-transparent text-xs focus:outline-none resize-y min-h-[60px]"
        style={{ color: 'var(--text-secondary)' }}
        placeholder="Primary text"
      />
      <div className="mt-2 flex items-center gap-2 text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
        <span>CTA: {ad.call_to_action}</span>
        {ad.description && <span>· {ad.description}</span>}
        {ad.body_alternates && ad.body_alternates.length > 0 && <span>· +{ad.body_alternates.length} body variants</span>}
        {ad.headline_alternates && ad.headline_alternates.length > 0 && <span>· +{ad.headline_alternates.length} headline variants</span>}
      </div>
    </div>
  )
}

function Pill({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md px-2 py-1.5" style={{ background: 'var(--surface-secondary)' }}>
      <p className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--text-tertiary)' }}>{label}</p>
      <p className="text-xs font-medium truncate" style={{ color: 'var(--text-primary)' }}>{value}</p>
    </div>
  )
}
