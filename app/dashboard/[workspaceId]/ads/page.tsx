'use client'

/**
 * Ads dashboard — workspace-scoped overview of connected ad accounts and
 * campaign drafts. Acts as the entry point to the new-campaign wizard
 * and the draft list. Performance metrics + recommendations land here in
 * Phase 7e/7f.
 */

import { useEffect, useState, type CSSProperties } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'

interface MetaAdAccountRow {
  id: string
  accountName: string
  metaAccountId: string
  isActive: boolean
  autoPilotEnabled: boolean
}

interface GoogleAdAccountRow {
  id: string
  accountName: string
  googleCustomerId: string
  isActive: boolean
  autoPilotEnabled: boolean
}

interface DraftRow {
  id: string
  name: string
  platform: string
  externalCampaignId: string | null
  campaignId: string | null
  aiReasoning: string | null
  createdAt: string
}

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

export default function AdsDashboardPage() {
  const params = useParams<{ workspaceId: string }>()
  const { workspaceId } = params
  const [meta, setMeta] = useState<MetaAdAccountRow[]>([])
  const [google, setGoogle] = useState<GoogleAdAccountRow[]>([])
  const [drafts, setDrafts] = useState<DraftRow[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!workspaceId) return
    Promise.all([
      fetch(`/api/workspaces/${workspaceId}/ad-accounts`).then((r) => r.json()).catch(() => ({ meta: [], google: [] })),
      fetch(`/api/workspaces/${workspaceId}/ad-drafts/meta`).then((r) => r.json()).catch(() => ({ drafts: [] })),
      fetch(`/api/workspaces/${workspaceId}/ad-drafts/google`).then((r) => r.json()).catch(() => ({ drafts: [] })),
    ])
      .then(([accounts, metaDrafts, googleDrafts]) => {
        setMeta(accounts.meta || [])
        setGoogle(accounts.google || [])
        // Combine + sort by createdAt desc so newest from either platform
        // surfaces first.
        const combined: DraftRow[] = [...(metaDrafts.drafts || []), ...(googleDrafts.drafts || [])]
        combined.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
        setDrafts(combined)
      })
      .finally(() => setLoading(false))
  }, [workspaceId])

  const activeMeta = meta.filter((a) => a.isActive).length
  const activeGoogle = google.filter((a) => a.isActive).length
  const noAdAccounts = meta.length === 0 && google.length === 0

  return (
    <main className="mx-auto w-full max-w-5xl px-6 py-10">
      <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight" style={{ color: 'var(--text-primary)' }}>
            Ads
          </h1>
          <p className="mt-1 text-sm" style={{ color: 'var(--text-secondary)' }}>
            Draft, launch, and optimise Meta and Google ad campaigns from inside Xovera.
          </p>
        </div>
        <div className="flex gap-2">
          {!noAdAccounts && (
            <>
              <Link
                href={`/dashboard/${workspaceId}/ads/recommendations`}
                className="inline-flex h-9 items-center rounded-lg px-3 text-xs font-medium"
                style={{ background: 'var(--surface-secondary)', borderWidth: '1px', borderStyle: 'solid', borderColor: 'var(--border)', color: 'var(--text-primary)' }}
              >
                Recommendations
              </Link>
              <Link
                href={`/dashboard/${workspaceId}/ads/performance`}
                className="inline-flex h-9 items-center rounded-lg px-3 text-xs font-medium"
                style={{ background: 'var(--surface-secondary)', borderWidth: '1px', borderStyle: 'solid', borderColor: 'var(--border)', color: 'var(--text-primary)' }}
              >
                Performance
              </Link>
              <Link
                href={`/dashboard/${workspaceId}/ads/new`}
                className="inline-flex h-9 items-center rounded-lg px-3 text-xs font-medium"
                style={btnPrimary}
              >
                + New campaign
              </Link>
            </>
          )}
        </div>
      </header>

      {/* Account summary cards */}
      <section className="grid gap-3 md:grid-cols-2 mb-6">
        <div className="rounded-xl p-5" style={card}>
          <div className="flex items-center justify-between">
            <h2 className="text-xs uppercase tracking-wider" style={{ color: 'var(--text-tertiary)' }}>Meta Ads accounts</h2>
            <Link href={`/dashboard/${workspaceId}/integrations`} className="text-xs hover:underline" style={{ color: 'var(--accent-primary)' }}>
              Manage
            </Link>
          </div>
          <p className="mt-2 text-2xl font-semibold" style={{ color: 'var(--text-primary)' }}>{activeMeta}<span className="text-sm font-normal ml-2" style={{ color: 'var(--text-tertiary)' }}>active{meta.length > activeMeta ? ` of ${meta.length}` : ''}</span></p>
          {meta.length === 0 && (
            <p className="mt-2 text-xs" style={{ color: 'var(--text-tertiary)' }}>
              <Link href={`/dashboard/${workspaceId}/integrations`} className="hover:underline" style={{ color: 'var(--accent-primary)' }}>Connect Meta Ads</Link> to draft Facebook + Instagram campaigns.
            </p>
          )}
        </div>
        <div className="rounded-xl p-5" style={card}>
          <div className="flex items-center justify-between">
            <h2 className="text-xs uppercase tracking-wider" style={{ color: 'var(--text-tertiary)' }}>Google Ads customers</h2>
            <Link href={`/dashboard/${workspaceId}/integrations`} className="text-xs hover:underline" style={{ color: 'var(--accent-primary)' }}>
              Manage
            </Link>
          </div>
          <p className="mt-2 text-2xl font-semibold" style={{ color: 'var(--text-primary)' }}>{activeGoogle}<span className="text-sm font-normal ml-2" style={{ color: 'var(--text-tertiary)' }}>active{google.length > activeGoogle ? ` of ${google.length}` : ''}</span></p>
          {google.length === 0 && (
            <p className="mt-2 text-xs" style={{ color: 'var(--text-tertiary)' }}>
              <Link href={`/dashboard/${workspaceId}/integrations`} className="hover:underline" style={{ color: 'var(--accent-primary)' }}>Connect Google Ads</Link> to draft Search and Performance Max campaigns.
            </p>
          )}
        </div>
      </section>

      {/* Drafts */}
      <section className="rounded-xl p-5" style={card}>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Campaign drafts</h2>
          <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>{drafts.length} {drafts.length === 1 ? 'draft' : 'drafts'}</span>
        </div>
        {loading ? (
          <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>Loading…</p>
        ) : drafts.length === 0 ? (
          <div className="py-6 text-center">
            <p className="text-sm mb-3" style={{ color: 'var(--text-tertiary)' }}>
              No drafts yet. Generate one from a campaign brief and an AI media buyer will write the targeting + copy.
            </p>
            {!noAdAccounts && (
              <Link
                href={`/dashboard/${workspaceId}/ads/new`}
                className="inline-flex h-9 items-center rounded-lg px-4 text-xs font-medium"
                style={btnPrimary}
              >
                Generate first campaign
              </Link>
            )}
          </div>
        ) : (
          <ul className="divide-y" style={{ borderColor: 'var(--border)' }}>
            {drafts.map((d) => (
              <li key={d.id}>
                <Link
                  href={`/dashboard/${workspaceId}/ads/drafts/${d.id}`}
                  className="flex items-start justify-between py-3 hover:opacity-80"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium truncate" style={{ color: 'var(--text-primary)' }}>{d.name}</span>
                      <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded" style={{ background: 'var(--surface-secondary)', color: 'var(--text-tertiary)' }}>
                        {d.platform}
                      </span>
                      {d.externalCampaignId && (
                        <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded" style={{ background: 'var(--accent-emerald-bg)', color: 'var(--accent-emerald)' }}>
                          Launched
                        </span>
                      )}
                    </div>
                    {d.aiReasoning && (
                      <p className="mt-1 text-xs line-clamp-2" style={{ color: 'var(--text-secondary)' }}>{d.aiReasoning}</p>
                    )}
                  </div>
                  <span className="text-xs ml-3 shrink-0" style={{ color: 'var(--text-tertiary)' }}>
                    {new Date(d.createdAt).toLocaleDateString()}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  )
}
