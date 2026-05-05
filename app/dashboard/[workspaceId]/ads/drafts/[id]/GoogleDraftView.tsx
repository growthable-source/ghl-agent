'use client'

/**
 * Google-specific draft detail UI. Same shape as MetaDraftView but
 * renders the GoogleCampaignDraft tree (campaign → ad groups → RSAs +
 * keywords) and posts to /ad-drafts/google/[id]/launch.
 */

import { useEffect, useState, type CSSProperties } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import type {
  GoogleAdGroup,
  GoogleCampaignDraft,
  GoogleLaunchResult,
  GoogleResponsiveSearchAd,
} from '@/lib/ad-google-types'

interface DraftRow {
  id: string
  name: string
  platform: string
  payload: GoogleCampaignDraft & { destination_url?: string }
  aiReasoning: string | null
  externalCampaignId: string | null
  campaignId: string | null
  createdAt: string
  updatedAt: string
}

interface GoogleAdAccountRow { id: string; accountName: string; googleCustomerId: string; isActive: boolean }

const card: CSSProperties = { background: 'var(--surface)', borderWidth: '1px', borderStyle: 'solid', borderColor: 'var(--border)' }
const btnPrimary: CSSProperties = { background: 'var(--accent-primary)', color: 'var(--btn-primary-text)' }
const btnDestructive: CSSProperties = { background: 'var(--accent-red-bg)', color: 'var(--accent-red)', borderWidth: '1px', borderStyle: 'solid', borderColor: 'var(--accent-red)' }
const inputStyle: CSSProperties = { background: 'var(--input-bg)', borderColor: 'var(--input-border)', color: 'var(--input-text)' }

export function GoogleDraftView({
  workspaceId,
  id,
  initialDraft,
}: { workspaceId: string; id: string; initialDraft: DraftRow }) {
  const router = useRouter()
  const [draft, setDraft] = useState<DraftRow>(initialDraft)
  const [google, setGoogle] = useState<GoogleAdAccountRow[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const [launchAccountId, setLaunchAccountId] = useState('')
  const [loginCustomerId, setLoginCustomerId] = useState('')
  const [launchResult, setLaunchResult] = useState<GoogleLaunchResult | null>(null)

  useEffect(() => {
    fetch(`/api/workspaces/${workspaceId}/ad-accounts`)
      .then((r) => r.json())
      .then((accounts: { google: GoogleAdAccountRow[] }) => {
        const active = (accounts.google || []).filter((a) => a.isActive)
        setGoogle(active)
        if (active.length === 1) setLaunchAccountId(active[0].id)
      })
      .catch(() => {})
  }, [workspaceId])

  async function persist(next: DraftRow) {
    setBusy(true)
    try {
      const r = await fetch(`/api/workspaces/${workspaceId}/ad-drafts/google/${id}`, {
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

  function patchPayload(mut: (p: GoogleCampaignDraft) => GoogleCampaignDraft) {
    const nextPayload = mut({ ...draft.payload })
    persist({ ...draft, payload: { ...nextPayload, destination_url: draft.payload.destination_url } })
  }

  async function destroy() {
    if (!window.confirm(`Delete draft "${draft.name}"? This cannot be undone.`)) return
    setBusy(true)
    try {
      const r = await fetch(`/api/workspaces/${workspaceId}/ad-drafts/google/${id}`, { method: 'DELETE' })
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? `HTTP ${r.status}`)
      router.push(`/dashboard/${workspaceId}/ads`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed')
      setBusy(false)
    }
  }

  async function launch() {
    if (!launchAccountId) return
    setBusy(true)
    setLaunchResult(null)
    try {
      const r = await fetch(`/api/workspaces/${workspaceId}/ad-drafts/google/${id}/launch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          googleAdAccountId: launchAccountId,
          ...(loginCustomerId ? { loginCustomerId: loginCustomerId.trim() } : {}),
        }),
      })
      const result = (await r.json()) as GoogleLaunchResult & { error?: string; detail?: string }
      if (!r.ok && !result.campaignId) {
        throw new Error(result.detail || result.error || `Launch failed (HTTP ${r.status})`)
      }
      setLaunchResult(result)
      const refresh = await fetch(`/api/workspaces/${workspaceId}/ad-drafts/google/${id}`).then((x) => x.json())
      setDraft(refresh.draft)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Launch failed')
    } finally {
      setBusy(false)
    }
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
              google
            </span>
            <span className="px-2 py-0.5 rounded-full" style={{
              background: launched ? 'var(--accent-emerald-bg)' : 'var(--accent-amber-bg)',
              color: launched ? 'var(--accent-emerald)' : 'var(--accent-amber)',
            }}>
              {launched ? `Launched · ${draft.externalCampaignId}` : 'Draft'}
            </span>
            <span className="text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
              {draft.payload.campaign_type} · {draft.payload.bidding_strategy}
            </span>
          </div>
        </div>
        {!launched && (
          <button type="button" onClick={destroy} disabled={busy}
            className="inline-flex h-9 items-center rounded-lg px-3 text-xs font-medium" style={btnDestructive}>
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
              {draft.payload.expected_metrics.cpa_low_cents != null && (
                <Stat label="Expected CPA" value={`$${(draft.payload.expected_metrics.cpa_low_cents / 100).toFixed(0)}–$${((draft.payload.expected_metrics.cpa_high_cents ?? draft.payload.expected_metrics.cpa_low_cents) / 100).toFixed(0)}`} />
              )}
              {draft.payload.expected_metrics.daily_conversions_low != null && (
                <Stat label="Expected daily conversions" value={`${draft.payload.expected_metrics.daily_conversions_low}–${draft.payload.expected_metrics.daily_conversions_high ?? draft.payload.expected_metrics.daily_conversions_low}`} />
              )}
              {draft.payload.expected_metrics.impression_share_low != null && (
                <Stat label="Expected impression share" value={`${(draft.payload.expected_metrics.impression_share_low * 100).toFixed(0)}–${((draft.payload.expected_metrics.impression_share_high ?? draft.payload.expected_metrics.impression_share_low) * 100).toFixed(0)}%`} />
              )}
            </div>
          )}
        </section>
      )}

      {/* Campaign-level facts */}
      <section className="mt-6 rounded-xl p-5" style={card}>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-[11px]">
          <Pill label="Daily budget" value={`$${(draft.payload.daily_budget_cents / 100).toFixed(0)}/day`} />
          <Pill label="Geo" value={draft.payload.geo_targets.join(', ')} />
          <Pill label="Objective" value={draft.payload.objective} />
          <Pill label="Bidding" value={draft.payload.bidding_strategy} />
        </div>
        {draft.payload.conversion_action && (
          <p className="mt-2 text-[11px] font-mono" style={{ color: 'var(--text-tertiary)' }}>
            Conversion action: {draft.payload.conversion_action}
          </p>
        )}
      </section>

      {/* Ad groups */}
      <section className="mt-6 space-y-4">
        {draft.payload.ad_groups.map((group, gIdx) => (
          <AdGroupCard key={gIdx} group={group} disabled={launched}
            onChange={(next) => patchPayload((p) => ({ ...p, ad_groups: p.ad_groups.map((g, i) => i === gIdx ? next : g) }))} />
        ))}
      </section>

      {!launched && (
        <section className="mt-8 rounded-xl p-5" style={card}>
          <h2 className="text-sm font-semibold mb-1" style={{ color: 'var(--text-primary)' }}>Launch to Google Ads</h2>
          <p className="text-xs mb-4" style={{ color: 'var(--text-tertiary)' }}>
            The campaign deploys in <code style={{ color: 'var(--accent-primary)' }}>PAUSED</code> state. Flip it to ENABLED in Google Ads.
          </p>
          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <label className="block text-xs mb-1.5" style={{ color: 'var(--text-secondary)' }}>Customer</label>
              <select value={launchAccountId} onChange={(e) => setLaunchAccountId(e.target.value)} className="w-full rounded-lg px-3 py-2 text-sm" style={inputStyle}>
                <option value="">Pick a customer…</option>
                {google.map((a) => (
                  <option key={a.id} value={a.id}>{a.accountName} ({a.googleCustomerId})</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs mb-1.5" style={{ color: 'var(--text-secondary)' }}>Login customer ID <span className="opacity-60">(if managed via MCC)</span></label>
              <input value={loginCustomerId} onChange={(e) => setLoginCustomerId(e.target.value)} placeholder="e.g. 1234567890" className="w-full rounded-lg px-3 py-2 text-sm" style={inputStyle} />
              <p className="mt-1 text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
                Required if the OAuth account is a manager (MCC) above the target customer.
              </p>
            </div>
          </div>
          <button type="button" onClick={launch} disabled={busy || !launchAccountId}
            className="mt-4 inline-flex h-10 items-center rounded-lg px-5 text-sm font-medium disabled:opacity-50" style={btnPrimary}>
            {busy ? 'Launching…' : 'Launch campaign'}
          </button>
          {launchResult && (
            <div className="mt-4 rounded-lg p-3 text-xs" style={{
              background: launchResult.ok ? 'var(--accent-emerald-bg)' : 'var(--accent-amber-bg)',
              color: launchResult.ok ? 'var(--accent-emerald)' : 'var(--accent-amber)',
            }}>
              <p className="font-medium">
                {launchResult.ok
                  ? `Launched · ${launchResult.campaignId} · ${launchResult.adGroupIds?.length ?? 0} ad groups · ${launchResult.adIds?.length ?? 0} ads`
                  : `Failed · ${launchResult.errors?.length ?? 0} errors`}
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
            This campaign is in Google Ads as <code style={{ color: 'var(--accent-primary)' }}>{draft.externalCampaignId}</code>. Edits to the draft from here are blocked.
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

function Pill({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md px-2 py-1.5" style={{ background: 'var(--surface-secondary)' }}>
      <p className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--text-tertiary)' }}>{label}</p>
      <p className="text-xs font-medium truncate" style={{ color: 'var(--text-primary)' }}>{value}</p>
    </div>
  )
}

function AdGroupCard({ group, onChange, disabled }: {
  group: GoogleAdGroup
  onChange: (next: GoogleAdGroup) => void
  disabled?: boolean
}) {
  return (
    <div className="rounded-xl p-5" style={card}>
      <div className="flex items-center justify-between gap-3 mb-3">
        <input
          value={group.name}
          onChange={(e) => onChange({ ...group, name: e.target.value })}
          disabled={disabled}
          className="text-base font-semibold bg-transparent focus:outline-none w-full"
          style={{ color: 'var(--text-primary)' }}
        />
      </div>

      {group.targeting_rationale && (
        <p className="mb-3 text-xs italic" style={{ color: 'var(--text-secondary)' }}>{group.targeting_rationale}</p>
      )}

      {/* Keywords */}
      {group.keywords && group.keywords.length > 0 && (
        <div className="mb-3">
          <p className="text-[10px] uppercase tracking-wider mb-1" style={{ color: 'var(--text-tertiary)' }}>Keywords ({group.keywords.length})</p>
          <div className="flex flex-wrap gap-1">
            {group.keywords.map((k, i) => (
              <span key={i} className="text-[11px] px-1.5 py-0.5 rounded" style={{ background: 'var(--surface-secondary)', color: 'var(--text-primary)' }}>
                {k.match_type === 'EXACT' ? `[${k.text}]` : k.match_type === 'PHRASE' ? `"${k.text}"` : k.text}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Negatives */}
      {group.negative_keywords && group.negative_keywords.length > 0 && (
        <div className="mb-3">
          <p className="text-[10px] uppercase tracking-wider mb-1" style={{ color: 'var(--text-tertiary)' }}>Negative keywords ({group.negative_keywords.length})</p>
          <div className="flex flex-wrap gap-1">
            {group.negative_keywords.map((k, i) => (
              <span key={i} className="text-[11px] px-1.5 py-0.5 rounded" style={{ background: 'var(--accent-red-bg)', color: 'var(--accent-red)' }}>
                -{k.match_type === 'EXACT' ? `[${k.text}]` : k.match_type === 'PHRASE' ? `"${k.text}"` : k.text}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* RSAs */}
      <div className="space-y-3">
        {group.ads.map((ad, aIdx) => (
          <RsaCard key={aIdx} ad={ad} disabled={disabled}
            onChange={(next) => onChange({ ...group, ads: group.ads.map((a, i) => i === aIdx ? next : a) })} />
        ))}
      </div>
    </div>
  )
}

function RsaCard({ ad, onChange, disabled }: {
  ad: GoogleResponsiveSearchAd
  onChange: (next: GoogleResponsiveSearchAd) => void
  disabled?: boolean
}) {
  return (
    <div className="rounded-lg p-3" style={{ background: 'var(--surface-secondary)' }}>
      <p className="text-[10px] uppercase tracking-wider mb-1.5" style={{ color: 'var(--text-tertiary)' }}>Headlines ({ad.headlines.length})</p>
      <div className="space-y-1 mb-3">
        {ad.headlines.map((h, i) => (
          <input
            key={i}
            value={h}
            onChange={(e) => onChange({ ...ad, headlines: ad.headlines.map((x, j) => j === i ? e.target.value : x) })}
            disabled={disabled}
            maxLength={30}
            className="w-full bg-transparent text-xs focus:outline-none border-b py-0.5"
            style={{ color: 'var(--text-primary)', borderColor: 'var(--border)' }}
          />
        ))}
      </div>
      <p className="text-[10px] uppercase tracking-wider mb-1.5" style={{ color: 'var(--text-tertiary)' }}>Descriptions ({ad.descriptions.length})</p>
      <div className="space-y-1">
        {ad.descriptions.map((d, i) => (
          <textarea
            key={i}
            value={d}
            onChange={(e) => onChange({ ...ad, descriptions: ad.descriptions.map((x, j) => j === i ? e.target.value : x) })}
            disabled={disabled}
            maxLength={90}
            className="w-full bg-transparent text-xs focus:outline-none border-b py-0.5 resize-none"
            style={{ color: 'var(--text-primary)', borderColor: 'var(--border)' }}
            rows={2}
          />
        ))}
      </div>
      {ad.final_url && (
        <p className="mt-2 text-[10px] truncate" style={{ color: 'var(--text-tertiary)' }}>
          → {ad.final_url}
        </p>
      )}
    </div>
  )
}
