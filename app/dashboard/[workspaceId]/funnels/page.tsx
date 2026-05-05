'use client'

/**
 * Funnels list page.
 *
 * Styled with Voxility design tokens (CSS variables on :root) — never
 * hardcoded Tailwind color utilities like bg-white/bg-blue-600. Match
 * the visual language of /dashboard/[workspaceId]/calls and the agents
 * pages so this page slots in cleanly.
 */

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'

interface CampaignRow {
  id: string
  name: string
  goal: string
  status: 'draft' | 'live' | 'paused' | 'ended'
  offerSummary: string | null
  dailyBudget: string | number | null
  createdAt: string
  updatedAt: string
  landingPageId: string | null
  landingPage: { slug: string; published: boolean } | null
  _count: { formSubmissions: number; conversionEvents: number }
}

type Access =
  | { allowed: true }
  | { allowed: false; reason: 'plan' | 'trial_expired'; currentPlan: string }

const STATUS_TOKEN: Record<CampaignRow['status'], { bg: string; fg: string }> = {
  draft: { bg: 'var(--surface-secondary)', fg: 'var(--text-tertiary)' },
  live: { bg: 'var(--accent-emerald-bg)', fg: 'var(--accent-emerald)' },
  paused: { bg: 'var(--accent-amber-bg)', fg: 'var(--accent-amber)' },
  ended: { bg: 'var(--accent-red-bg)', fg: 'var(--accent-red)' },
}

export default function FunnelsListPage() {
  const params = useParams<{ workspaceId: string }>()
  const workspaceId = params.workspaceId
  const [campaigns, setCampaigns] = useState<CampaignRow[]>([])
  const [access, setAccess] = useState<Access | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!workspaceId) return
    setLoading(true)
    fetch(`/api/workspaces/${workspaceId}/funnels`)
      .then(async (r) => {
        if (!r.ok) {
          const body = (await r.json().catch(() => ({}))) as { error?: string }
          throw new Error(body.error ?? `Load failed (HTTP ${r.status})`)
        }
        return r.json() as Promise<{ campaigns: CampaignRow[]; access: Access }>
      })
      .then((d) => { setCampaigns(d.campaigns); setAccess(d.access) })
      .catch((e) => setError(e instanceof Error ? e.message : 'Load failed'))
      .finally(() => setLoading(false))
  }, [workspaceId])

  return (
    <main className="mx-auto w-full max-w-6xl px-6 py-10">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight" style={{ color: 'var(--text-primary)' }}>
            Funnels
          </h1>
          <p className="mt-1 text-sm" style={{ color: 'var(--text-secondary)' }}>
            Each funnel = landing page + form + agent response + tracking — in one workflow.
          </p>
        </div>
        {access?.allowed && (
          <Link
            href={`/dashboard/${workspaceId}/funnels/new`}
            className="inline-flex h-10 items-center rounded-lg px-4 text-sm font-medium transition-colors"
            style={{ background: 'var(--accent-primary)', color: 'var(--btn-primary-text)' }}
          >
            New funnel
          </Link>
        )}
      </header>

      {error && (
        <div
          className="mt-6 rounded-lg p-3 text-sm"
          style={{ background: 'var(--accent-red-bg)', color: 'var(--accent-red)' }}
        >
          {error}
        </div>
      )}

      {access && !access.allowed && (
        <div
          className="mt-6 rounded-xl p-5"
          style={{
            background: 'var(--accent-amber-bg)',
            borderWidth: '1px',
            borderStyle: 'solid',
            borderColor: 'var(--border)',
          }}
        >
          <div className="text-sm font-semibold" style={{ color: 'var(--accent-amber)' }}>
            {access.reason === 'trial_expired'
              ? 'Your trial has expired'
              : 'Funnel builder requires Growth or Scale'}
          </div>
          <p className="mt-1 text-sm" style={{ color: 'var(--text-secondary)' }}>
            {access.reason === 'trial_expired'
              ? 'Upgrade to keep using the funnel builder. Your existing funnels stay accessible.'
              : `You are on the ${access.currentPlan} plan. Funnels are available on Growth and Scale.`}
          </p>
          <Link
            href={`/dashboard/${workspaceId}/settings/billing`}
            className="mt-3 inline-flex h-9 items-center rounded-lg px-4 text-xs font-medium"
            style={{ background: 'var(--accent-primary)', color: 'var(--btn-primary-text)' }}
          >
            Upgrade plan
          </Link>
        </div>
      )}

      <section className="mt-6">
        {loading ? (
          <div
            className="rounded-xl p-8 text-center text-sm"
            style={{
              background: 'var(--surface)',
              borderWidth: '1px',
              borderStyle: 'solid',
              borderColor: 'var(--border)',
              color: 'var(--text-tertiary)',
            }}
          >
            Loading…
          </div>
        ) : campaigns.length === 0 ? (
          <div
            className="rounded-xl p-12 text-center"
            style={{
              background: 'var(--surface)',
              borderWidth: '1px',
              borderStyle: 'solid',
              borderColor: 'var(--border)',
            }}
          >
            <h2 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
              No funnels yet
            </h2>
            <p className="mt-2 text-sm" style={{ color: 'var(--text-secondary)' }}>
              Launch your first funnel — describe the offer, generate a page, pick agents, and publish in under five minutes.
            </p>
            {access?.allowed && (
              <Link
                href={`/dashboard/${workspaceId}/funnels/new`}
                className="mt-5 inline-flex h-10 items-center rounded-lg px-4 text-sm font-medium"
                style={{ background: 'var(--accent-primary)', color: 'var(--btn-primary-text)' }}
              >
                Create your first funnel
              </Link>
            )}
          </div>
        ) : (
          <div
            className="overflow-hidden rounded-xl"
            style={{
              background: 'var(--surface)',
              borderWidth: '1px',
              borderStyle: 'solid',
              borderColor: 'var(--border)',
            }}
          >
            <table className="w-full text-sm">
              <thead
                style={{
                  background: 'var(--surface-secondary)',
                  borderBottomWidth: '1px',
                  borderBottomStyle: 'solid',
                  borderBottomColor: 'var(--border)',
                }}
              >
                <tr style={{ color: 'var(--text-tertiary)' }}>
                  <th className="px-4 py-3 text-left text-xs uppercase tracking-wider font-medium">Name</th>
                  <th className="px-4 py-3 text-left text-xs uppercase tracking-wider font-medium">Status</th>
                  <th className="px-4 py-3 text-left text-xs uppercase tracking-wider font-medium">Goal</th>
                  <th className="px-4 py-3 text-left text-xs uppercase tracking-wider font-medium">Submissions</th>
                  <th className="px-4 py-3 text-left text-xs uppercase tracking-wider font-medium">Page</th>
                  <th className="px-4 py-3 text-right text-xs uppercase tracking-wider font-medium">Updated</th>
                </tr>
              </thead>
              <tbody>
                {campaigns.map((c, i) => (
                  <tr
                    key={c.id}
                    style={{
                      borderTopWidth: i === 0 ? '0' : '1px',
                      borderTopStyle: 'solid',
                      borderTopColor: 'var(--border)',
                    }}
                  >
                    <td className="px-4 py-3">
                      <Link
                        href={`/dashboard/${workspaceId}/funnels/${c.id}`}
                        className="font-medium hover:underline"
                        style={{ color: 'var(--text-primary)' }}
                      >
                        {c.name}
                      </Link>
                      {c.offerSummary && (
                        <div className="mt-0.5 truncate text-xs" style={{ color: 'var(--text-tertiary)' }}>
                          {c.offerSummary}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className="inline-flex rounded-full px-2 py-0.5 text-xs font-medium capitalize"
                        style={{ background: STATUS_TOKEN[c.status].bg, color: STATUS_TOKEN[c.status].fg }}
                      >
                        {c.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 capitalize" style={{ color: 'var(--text-secondary)' }}>
                      {c.goal.replace(/_/g, ' ')}
                    </td>
                    <td className="px-4 py-3 tabular-nums" style={{ color: 'var(--text-primary)' }}>
                      {c._count.formSubmissions}
                    </td>
                    <td className="px-4 py-3">
                      {c.landingPage ? (
                        <a
                          href={`/p/${c.landingPage.slug}`}
                          target="_blank"
                          rel="noreferrer"
                          className="text-xs hover:underline"
                          style={{
                            color: c.landingPage.published ? 'var(--accent-primary)' : 'var(--text-muted)',
                          }}
                        >
                          /p/{c.landingPage.slug}{!c.landingPage.published && ' (draft)'}
                        </a>
                      ) : (
                        <span className="text-xs" style={{ color: 'var(--text-muted)' }}>no page</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right text-xs" style={{ color: 'var(--text-tertiary)' }}>
                      {new Date(c.updatedAt).toLocaleDateString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  )
}
