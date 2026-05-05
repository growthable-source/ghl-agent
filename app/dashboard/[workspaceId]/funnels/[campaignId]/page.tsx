'use client'

/**
 * Single funnel / campaign detail page.
 *
 * Surfaces the basics: status, the live URL, the agents wired in,
 * pixel config, recent submissions, recent conversion events. Lets
 * the operator pause / resume / delete the campaign and jump out
 * to the public landing page in a new tab.
 *
 * Edit the page spec → /pages/[id]/edit (Phase 5b followup).
 */

import { useEffect, useState, type CSSProperties } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'

interface CampaignDetail {
  id: string
  name: string
  goal: string
  status: 'draft' | 'live' | 'paused' | 'ended'
  offerSummary: string | null
  brandVoice: string | null
  primaryColor: string | null
  dailyBudget: string | number | null
  totalBudget: string | number | null
  startDate: string | null
  endDate: string | null
  triggeredAgentId: string | null
  conversationalAgentId: string | null
  metaCampaignExternalId: string | null
  googleCampaignExternalId: string | null
  notes: string | null
  createdAt: string
  updatedAt: string
  landingPage: {
    slug: string
    published: boolean
    publishedAt: string | null
    title: string
  } | null
}

interface Agent { id: string; name: string }

const STATUS_COLOR: Record<CampaignDetail['status'], { bg: string; fg: string }> = {
  draft: { bg: 'var(--surface-secondary)', fg: 'var(--text-tertiary)' },
  live: { bg: 'var(--accent-emerald-bg)', fg: 'var(--accent-emerald)' },
  paused: { bg: 'var(--accent-amber-bg)', fg: 'var(--accent-amber)' },
  ended: { bg: 'var(--accent-red-bg)', fg: 'var(--accent-red)' },
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

const btnSecondary: CSSProperties = {
  background: 'var(--surface-secondary)',
  borderWidth: '1px',
  borderStyle: 'solid',
  borderColor: 'var(--border)',
  color: 'var(--text-primary)',
}

const btnDestructive: CSSProperties = {
  background: 'var(--accent-red-bg)',
  color: 'var(--accent-red)',
  borderWidth: '1px',
  borderStyle: 'solid',
  borderColor: 'var(--accent-red)',
}

export default function CampaignDetailPage() {
  const params = useParams<{ workspaceId: string; campaignId: string }>()
  const router = useRouter()
  const { workspaceId, campaignId } = params

  const [campaign, setCampaign] = useState<CampaignDetail | null>(null)
  const [agents, setAgents] = useState<Map<string, Agent>>(new Map())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!workspaceId || !campaignId) return
    setLoading(true)
    Promise.all([
      fetch(`/api/workspaces/${workspaceId}/funnels/${campaignId}`).then(async (r) => {
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? `HTTP ${r.status}`)
        return r.json() as Promise<{ campaign: CampaignDetail }>
      }),
      fetch(`/api/workspaces/${workspaceId}/agents`).then((r) => r.json() as Promise<{ agents?: Agent[] }>).catch(() => ({ agents: [] as Agent[] })),
    ])
      .then(([c, a]) => {
        setCampaign(c.campaign)
        const map = new Map<string, Agent>()
        for (const ag of a.agents ?? []) map.set(ag.id, ag)
        setAgents(map)
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Load failed'))
      .finally(() => setLoading(false))
  }, [workspaceId, campaignId])

  async function patch(body: Record<string, unknown>) {
    if (!campaign) return
    setBusy(true)
    try {
      const r = await fetch(`/api/workspaces/${workspaceId}/funnels/${campaignId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!r.ok) throw new Error((await r.json()).error ?? 'Save failed')
      const { campaign: next } = (await r.json()) as { campaign: CampaignDetail }
      setCampaign(next)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setBusy(false)
    }
  }

  async function destroy() {
    if (!campaign) return
    if (!window.confirm(`Delete "${campaign.name}"? Submissions and conversion events will be detached but not deleted.`)) return
    setBusy(true)
    try {
      const r = await fetch(`/api/workspaces/${workspaceId}/funnels/${campaignId}`, { method: 'DELETE' })
      if (!r.ok) throw new Error((await r.json()).error ?? 'Delete failed')
      router.push(`/dashboard/${workspaceId}/funnels`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed')
      setBusy(false)
    }
  }

  if (loading) {
    return (
      <main className="mx-auto w-full max-w-4xl px-6 py-10">
        <div className="rounded-xl p-8 text-center text-sm" style={{ ...card, color: 'var(--text-tertiary)' }}>
          Loading…
        </div>
      </main>
    )
  }

  if (error || !campaign) {
    return (
      <main className="mx-auto w-full max-w-4xl px-6 py-10">
        <Link href={`/dashboard/${workspaceId}/funnels`} className="text-sm hover:underline" style={{ color: 'var(--accent-primary)' }}>
          ← Back to funnels
        </Link>
        <div className="mt-6 rounded-xl p-8 text-center" style={{ ...card }}>
          <h2 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>Funnel not found</h2>
          {error && <p className="mt-2 text-sm" style={{ color: 'var(--accent-red)' }}>{error}</p>}
        </div>
      </main>
    )
  }

  const liveUrl = campaign.landingPage
    ? `${window.location.origin}/p/${campaign.landingPage.slug}`
    : null

  const triggered = campaign.triggeredAgentId ? agents.get(campaign.triggeredAgentId) : null
  const conversational = campaign.conversationalAgentId ? agents.get(campaign.conversationalAgentId) : null

  return (
    <main className="mx-auto w-full max-w-4xl px-6 py-10">
      <Link href={`/dashboard/${workspaceId}/funnels`} className="text-sm hover:underline" style={{ color: 'var(--accent-primary)' }}>
        ← Back to funnels
      </Link>

      <header className="mt-3 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-3">
            <h1 className="truncate text-2xl font-semibold tracking-tight" style={{ color: 'var(--text-primary)' }}>
              {campaign.name}
            </h1>
            <span
              className="inline-flex rounded-full px-2 py-0.5 text-xs font-medium capitalize"
              style={{ background: STATUS_COLOR[campaign.status].bg, color: STATUS_COLOR[campaign.status].fg }}
            >
              {campaign.status}
            </span>
          </div>
          {campaign.offerSummary && (
            <p className="mt-1 text-sm" style={{ color: 'var(--text-secondary)' }}>{campaign.offerSummary}</p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {campaign.status === 'live' && (
            <button onClick={() => patch({ status: 'paused' })} disabled={busy}
              className="inline-flex h-9 items-center rounded-lg px-3 text-xs font-medium" style={btnSecondary}>
              Pause
            </button>
          )}
          {(campaign.status === 'paused' || campaign.status === 'draft') && (
            <button onClick={() => patch({ status: 'live' })} disabled={busy}
              className="inline-flex h-9 items-center rounded-lg px-3 text-xs font-medium" style={btnPrimary}>
              {campaign.status === 'paused' ? 'Resume' : 'Activate'}
            </button>
          )}
          {liveUrl && campaign.landingPage?.published && (
            <a href={liveUrl} target="_blank" rel="noreferrer"
              className="inline-flex h-9 items-center rounded-lg px-3 text-xs font-medium" style={btnSecondary}>
              Open page ↗
            </a>
          )}
        </div>
      </header>

      {error && (
        <div className="mt-4 rounded-lg p-3 text-sm" style={{ background: 'var(--accent-red-bg)', color: 'var(--accent-red)' }}>
          {error}
        </div>
      )}

      <section className="mt-6 grid gap-4 md:grid-cols-2">
        <div className="rounded-xl p-5" style={card}>
          <h2 className="text-xs uppercase tracking-wider" style={{ color: 'var(--text-tertiary)' }}>Landing page</h2>
          {campaign.landingPage ? (
            <>
              <div className="mt-2 font-medium" style={{ color: 'var(--text-primary)' }}>
                {campaign.landingPage.title}
              </div>
              <div className="mt-1 break-all font-mono text-xs" style={{ color: 'var(--text-secondary)' }}>
                /p/{campaign.landingPage.slug}
              </div>
              <div className="mt-2 text-xs" style={{ color: 'var(--text-tertiary)' }}>
                {campaign.landingPage.published
                  ? `Published ${campaign.landingPage.publishedAt ? new Date(campaign.landingPage.publishedAt).toLocaleString() : ''}`
                  : 'Draft — not published'}
              </div>
            </>
          ) : (
            <p className="mt-2 text-sm" style={{ color: 'var(--text-tertiary)' }}>No page attached.</p>
          )}
        </div>

        <div className="rounded-xl p-5" style={card}>
          <h2 className="text-xs uppercase tracking-wider" style={{ color: 'var(--text-tertiary)' }}>Agents</h2>
          <div className="mt-2 space-y-1.5 text-sm">
            <div>
              <span style={{ color: 'var(--text-tertiary)' }}>Triggered: </span>
              {triggered ? (
                <Link href={`/dashboard/${workspaceId}/agents/${triggered.id}`} className="hover:underline" style={{ color: 'var(--text-primary)' }}>
                  {triggered.name}
                </Link>
              ) : (
                <span style={{ color: 'var(--text-tertiary)' }}>none</span>
              )}
            </div>
            <div>
              <span style={{ color: 'var(--text-tertiary)' }}>Conversational: </span>
              {conversational ? (
                <Link href={`/dashboard/${workspaceId}/agents/${conversational.id}`} className="hover:underline" style={{ color: 'var(--text-primary)' }}>
                  {conversational.name}
                </Link>
              ) : (
                <span style={{ color: 'var(--text-tertiary)' }}>none</span>
              )}
            </div>
          </div>
        </div>

        <div className="rounded-xl p-5" style={card}>
          <h2 className="text-xs uppercase tracking-wider" style={{ color: 'var(--text-tertiary)' }}>Goal & budget</h2>
          <div className="mt-2 space-y-1.5 text-sm" style={{ color: 'var(--text-primary)' }}>
            <div><span style={{ color: 'var(--text-tertiary)' }}>Goal: </span>{campaign.goal.replace(/_/g, ' ')}</div>
            {campaign.dailyBudget != null && (
              <div><span style={{ color: 'var(--text-tertiary)' }}>Daily budget: </span>${String(campaign.dailyBudget)}</div>
            )}
            {campaign.totalBudget != null && (
              <div><span style={{ color: 'var(--text-tertiary)' }}>Total budget: </span>${String(campaign.totalBudget)}</div>
            )}
          </div>
        </div>

        <div className="rounded-xl p-5" style={card}>
          <h2 className="text-xs uppercase tracking-wider" style={{ color: 'var(--text-tertiary)' }}>External ad campaigns</h2>
          <div className="mt-2 space-y-1.5 text-sm" style={{ color: 'var(--text-primary)' }}>
            <div>
              <span style={{ color: 'var(--text-tertiary)' }}>Meta: </span>
              {campaign.metaCampaignExternalId ?? <span style={{ color: 'var(--text-tertiary)' }}>not linked</span>}
            </div>
            <div>
              <span style={{ color: 'var(--text-tertiary)' }}>Google: </span>
              {campaign.googleCampaignExternalId ?? <span style={{ color: 'var(--text-tertiary)' }}>not linked</span>}
            </div>
          </div>
        </div>
      </section>

      <section className="mt-6 rounded-xl p-5" style={card}>
        <h2 className="text-xs uppercase tracking-wider" style={{ color: 'var(--text-tertiary)' }}>Danger zone</h2>
        <p className="mt-2 text-sm" style={{ color: 'var(--text-secondary)' }}>
          Delete this funnel. Submissions and conversion events stay in the database
          (detached via FK SET NULL); the landing page row is also retained.
        </p>
        <button onClick={destroy} disabled={busy}
          className="mt-3 inline-flex h-9 items-center rounded-lg px-3 text-xs font-medium" style={btnDestructive}>
          Delete funnel
        </button>
      </section>
    </main>
  )
}
