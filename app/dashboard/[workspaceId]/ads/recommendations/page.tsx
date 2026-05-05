'use client'

/**
 * Ad recommendations dashboard.
 *
 * Lists pending recommendations across every connected ad account.
 * Operator can:
 *   - Trigger fresh generation per account (POST → AI fan-out)
 *   - Mark a recommendation accepted / dismissed / snoozed
 *   - Inspect rationale, action steps, and (when present) draft copy
 *     or draft negative-keyword lists.
 *
 * Recommendations are advisory — applying them in-platform is left to
 * the operator for now (Phase 7f.5: one-click apply for the obvious
 * categories like add_negatives and pause_creative).
 */

import { useEffect, useState, type CSSProperties } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'

interface Rec {
  id: string
  metaAccountId: string | null
  googleAccountId: string | null
  category: string
  title: string
  description: string
  rationale: string | null
  affectedEntity: string | null
  expectedImpact: string | null
  impactRange: string | null
  priority: 'high' | 'medium' | 'low'
  confidence: 'high' | 'medium' | 'low'
  status: 'pending' | 'accepted' | 'dismissed' | 'snoozed'
  actionSteps: string[]
  draftNegatives: string[]
  draftCopy: { headline?: string; primary_text?: string; description?: string } | null
  createdAt: string
}

interface Account { id: string; accountName: string; provider: 'meta' | 'google' }

const card: CSSProperties = { background: 'var(--surface)', borderWidth: '1px', borderStyle: 'solid', borderColor: 'var(--border)' }
const btnPrimary: CSSProperties = { background: 'var(--accent-primary)', color: 'var(--btn-primary-text)' }
const btnSecondary: CSSProperties = { background: 'var(--surface-secondary)', borderWidth: '1px', borderStyle: 'solid', borderColor: 'var(--border)', color: 'var(--text-primary)' }

const PRIORITY_BG: Record<Rec['priority'], string> = {
  high: 'var(--accent-red-bg)',
  medium: 'var(--accent-amber-bg)',
  low: 'var(--surface-secondary)',
}
const PRIORITY_FG: Record<Rec['priority'], string> = {
  high: 'var(--accent-red)',
  medium: 'var(--accent-amber)',
  low: 'var(--text-tertiary)',
}

export default function RecommendationsPage() {
  const params = useParams<{ workspaceId: string }>()
  const { workspaceId } = params

  const [recs, setRecs] = useState<Rec[]>([])
  const [accounts, setAccounts] = useState<Account[]>([])
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState<string | null>(null)
  const [filter, setFilter] = useState<'pending' | 'all' | 'accepted' | 'dismissed' | 'snoozed'>('pending')
  const [error, setError] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    try {
      const [recsRes, accountsRes] = await Promise.all([
        fetch(`/api/workspaces/${workspaceId}/ad-recommendations?status=${filter}`).then((r) => r.json()),
        fetch(`/api/workspaces/${workspaceId}/ad-accounts`).then((r) => r.json()),
      ])
      setRecs(recsRes.recommendations || [])
      const all: Account[] = []
      for (const a of accountsRes.meta || []) all.push({ id: a.id, accountName: a.accountName, provider: 'meta' })
      for (const a of accountsRes.google || []) all.push({ id: a.id, accountName: a.accountName, provider: 'google' })
      setAccounts(all)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Load failed')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (workspaceId) load()
  }, [workspaceId, filter]) // eslint-disable-line react-hooks/exhaustive-deps

  async function generateFor(acc: Account) {
    setGenerating(acc.id)
    setError(null)
    try {
      const r = await fetch(`/api/workspaces/${workspaceId}/ad-recommendations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: acc.provider, accountId: acc.id }),
      })
      if (!r.ok) {
        const err = (await r.json().catch(() => ({}))) as { error?: string; detail?: string }
        throw new Error(err.detail || err.error || `HTTP ${r.status}`)
      }
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Generation failed')
    } finally {
      setGenerating(null)
    }
  }

  async function setStatus(rec: Rec, status: Rec['status']) {
    setRecs((prev) => prev.map((r) => r.id === rec.id ? { ...r, status } : r))
    try {
      await fetch(`/api/workspaces/${workspaceId}/ad-recommendations/${rec.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      })
      // If the filter excludes the new status, drop it from the list.
      if (filter !== 'all' && filter !== status) {
        setRecs((prev) => prev.filter((r) => r.id !== rec.id))
      }
    } catch {
      // Re-load on failure to reconcile.
      load()
    }
  }

  return (
    <main className="mx-auto w-full max-w-5xl px-6 py-10">
      <div className="flex items-center justify-between mb-6">
        <div>
          <Link href={`/dashboard/${workspaceId}/ads`} className="text-sm hover:underline" style={{ color: 'var(--accent-primary)' }}>
            ← Ads
          </Link>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight" style={{ color: 'var(--text-primary)' }}>
            Recommendations
          </h1>
          <p className="mt-1 text-sm" style={{ color: 'var(--text-secondary)' }}>
            Claude reads your last 30 days of metrics and surfaces the highest-leverage actions.
          </p>
        </div>
      </div>

      {error && (
        <div className="mb-4 rounded-lg p-3 text-sm" style={{ background: 'var(--accent-red-bg)', color: 'var(--accent-red)' }}>
          {error}
        </div>
      )}

      {/* Account-level generate buttons */}
      {accounts.length > 0 && (
        <section className="rounded-xl p-5 mb-6" style={card}>
          <h2 className="text-sm font-semibold mb-3" style={{ color: 'var(--text-primary)' }}>Generate fresh recommendations</h2>
          <div className="flex flex-wrap gap-2">
            {accounts.map((a) => (
              <button
                key={a.id}
                type="button"
                onClick={() => generateFor(a)}
                disabled={generating === a.id}
                className="inline-flex h-9 items-center gap-2 rounded-lg px-3 text-xs font-medium disabled:opacity-50"
                style={btnSecondary}
              >
                <span className="uppercase text-[10px] tracking-wider opacity-60">{a.provider}</span>
                <span>{a.accountName}</span>
                {generating === a.id && <span className="opacity-60">· thinking…</span>}
              </button>
            ))}
          </div>
        </section>
      )}

      {/* Filter tabs */}
      <div className="flex gap-1 mb-4">
        {(['pending', 'accepted', 'snoozed', 'dismissed', 'all'] as const).map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            className="rounded-lg px-3 py-1.5 text-xs font-medium capitalize"
            style={
              filter === f
                ? { background: 'var(--accent-primary)', color: 'var(--btn-primary-text)' }
                : { background: 'var(--surface-secondary)', color: 'var(--text-secondary)' }
            }
          >
            {f}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="rounded-xl p-10 text-center text-sm" style={{ ...card, color: 'var(--text-tertiary)' }}>Loading…</div>
      ) : recs.length === 0 ? (
        <div className="rounded-xl p-10 text-center" style={card}>
          <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>
            {filter === 'pending'
              ? 'No pending recommendations. Click an account above to generate fresh ones.'
              : `No ${filter} recommendations.`}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {recs.map((r) => (
            <article key={r.id} className="rounded-xl p-5" style={card}>
              <header className="flex items-start justify-between gap-3 mb-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                    <span className="px-1.5 py-0.5 rounded uppercase text-[10px] tracking-wider" style={{ background: PRIORITY_BG[r.priority], color: PRIORITY_FG[r.priority] }}>
                      {r.priority}
                    </span>
                    <span className="px-1.5 py-0.5 rounded uppercase text-[10px] tracking-wider" style={{ background: 'var(--surface-secondary)', color: 'var(--text-tertiary)' }}>
                      {r.category.replace(/_/g, ' ')}
                    </span>
                    <span className="text-[10px]" style={{ color: 'var(--text-tertiary)' }}>
                      Confidence: {r.confidence}
                    </span>
                    {r.status !== 'pending' && (
                      <span className="px-1.5 py-0.5 rounded uppercase text-[10px] tracking-wider" style={{ background: 'var(--accent-emerald-bg)', color: 'var(--accent-emerald)' }}>
                        {r.status}
                      </span>
                    )}
                  </div>
                  <h2 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>{r.title}</h2>
                  <p className="mt-1 text-sm" style={{ color: 'var(--text-secondary)' }}>{r.description}</p>
                </div>
                <div className="flex flex-col gap-1 shrink-0">
                  {r.status === 'pending' && (
                    <>
                      <button onClick={() => setStatus(r, 'accepted')} className="text-[11px] px-2 py-1 rounded" style={btnPrimary}>Accept</button>
                      <button onClick={() => setStatus(r, 'snoozed')} className="text-[11px] px-2 py-1 rounded" style={btnSecondary}>Snooze</button>
                      <button onClick={() => setStatus(r, 'dismissed')} className="text-[11px] px-2 py-1 rounded" style={{ ...btnSecondary, color: 'var(--text-tertiary)' }}>Dismiss</button>
                    </>
                  )}
                  {r.status !== 'pending' && (
                    <button onClick={() => setStatus(r, 'pending')} className="text-[11px] px-2 py-1 rounded" style={btnSecondary}>Move back to pending</button>
                  )}
                </div>
              </header>

              {r.rationale && (
                <p className="text-xs italic mb-3" style={{ color: 'var(--text-secondary)' }}>{r.rationale}</p>
              )}

              {(r.expectedImpact || r.impactRange || r.affectedEntity) && (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-2 mb-3 text-[11px]">
                  {r.affectedEntity && <Pill label="Affected" value={r.affectedEntity} />}
                  {r.expectedImpact && <Pill label="Expected impact" value={r.expectedImpact} />}
                  {r.impactRange && <Pill label="Range" value={r.impactRange} />}
                </div>
              )}

              {r.actionSteps.length > 0 && (
                <div className="mb-3">
                  <p className="text-[10px] uppercase tracking-wider mb-1" style={{ color: 'var(--text-tertiary)' }}>Action steps</p>
                  <ol className="list-decimal list-inside space-y-0.5 text-xs" style={{ color: 'var(--text-primary)' }}>
                    {r.actionSteps.map((s, i) => <li key={i}>{s}</li>)}
                  </ol>
                </div>
              )}

              {r.draftNegatives.length > 0 && (
                <div className="mb-3">
                  <p className="text-[10px] uppercase tracking-wider mb-1" style={{ color: 'var(--text-tertiary)' }}>Suggested negative keywords</p>
                  <div className="flex flex-wrap gap-1">
                    {r.draftNegatives.map((n, i) => (
                      <span key={i} className="text-[11px] font-mono px-1.5 py-0.5 rounded" style={{ background: 'var(--accent-red-bg)', color: 'var(--accent-red)' }}>
                        -{n}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {r.draftCopy && (r.draftCopy.headline || r.draftCopy.primary_text) && (
                <div className="rounded-lg p-3 mt-2" style={{ background: 'var(--surface-secondary)' }}>
                  <p className="text-[10px] uppercase tracking-wider mb-1" style={{ color: 'var(--text-tertiary)' }}>Suggested ad copy</p>
                  {r.draftCopy.headline && <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{r.draftCopy.headline}</p>}
                  {r.draftCopy.primary_text && <p className="mt-1 text-xs" style={{ color: 'var(--text-secondary)' }}>{r.draftCopy.primary_text}</p>}
                  {r.draftCopy.description && <p className="mt-1 text-[11px]" style={{ color: 'var(--text-tertiary)' }}>{r.draftCopy.description}</p>}
                </div>
              )}
            </article>
          ))}
        </div>
      )}
    </main>
  )
}

function Pill({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md px-2 py-1.5" style={{ background: 'var(--surface-secondary)' }}>
      <p className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--text-tertiary)' }}>{label}</p>
      <p className="text-xs font-medium" style={{ color: 'var(--text-primary)' }}>{value}</p>
    </div>
  )
}
