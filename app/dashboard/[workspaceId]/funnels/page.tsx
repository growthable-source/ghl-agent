'use client'

/**
 * Funnels list page.
 *
 * One row per Campaign in the workspace. Status badges drive the
 * sort/scan logic at a glance. The "New funnel" CTA jumps to the
 * 5-step wizard at /funnels/new.
 *
 * Client component — uses fetch() against the funnels API. No edit
 * surface here; the wizard creates campaigns and the per-campaign
 * detail page (Phase 5b) handles edits.
 */

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'

type Access =
  | { allowed: true }
  | { allowed: false; reason: 'plan' | 'trial_expired'; currentPlan: string }

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

const STATUS_COLOR: Record<CampaignRow['status'], string> = {
  draft: 'bg-neutral-100 text-neutral-600',
  live: 'bg-green-100 text-green-700',
  paused: 'bg-amber-100 text-amber-700',
  ended: 'bg-red-100 text-red-700',
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
          <h1 className="text-2xl font-semibold tracking-tight">Funnels</h1>
          <p className="mt-1 text-sm text-neutral-600">
            Each funnel = landing page + form + agent response + tracking — in one workflow.
          </p>
        </div>
        {access?.allowed && (
          <Link
            href={`/dashboard/${workspaceId}/funnels/new`}
            className="inline-flex h-10 items-center rounded-md bg-blue-600 px-4 text-sm font-semibold text-white hover:bg-blue-700"
          >
            New funnel
          </Link>
        )}
      </header>

      {access && !access.allowed && (
        <div className="mt-6 rounded-md border border-amber-200 bg-amber-50 p-4">
          <div className="text-sm font-semibold text-amber-900">
            {access.reason === 'trial_expired'
              ? 'Your trial has expired'
              : 'Funnel builder requires Growth or Scale'}
          </div>
          <p className="mt-1 text-sm text-amber-800">
            {access.reason === 'trial_expired'
              ? 'Upgrade to keep using the funnel builder. Your existing funnels stay accessible.'
              : `You are on the ${access.currentPlan} plan. Funnels are available on Growth and Scale.`}
          </p>
          <Link
            href={`/dashboard/${workspaceId}/settings/billing`}
            className="mt-3 inline-flex h-9 items-center rounded-md bg-amber-600 px-4 text-xs font-semibold text-white hover:bg-amber-700"
          >
            Upgrade plan
          </Link>
        </div>
      )}

      {error && (
        <div className="mt-6 rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</div>
      )}

      <section className="mt-6">
        {loading ? (
          <div className="rounded-md border border-neutral-200 bg-white p-8 text-center text-sm text-neutral-500">
            Loading…
          </div>
        ) : campaigns.length === 0 ? (
          <div className="rounded-md border border-dashed border-neutral-300 bg-white p-12 text-center">
            <h2 className="text-lg font-semibold">No funnels yet</h2>
            <p className="mt-2 text-sm text-neutral-600">
              Launch your first funnel — describe the offer, generate a page, pick agents, and publish in under five minutes.
            </p>
            <Link
              href={`/dashboard/${workspaceId}/funnels/new`}
              className="mt-5 inline-flex h-10 items-center rounded-md bg-blue-600 px-4 text-sm font-semibold text-white hover:bg-blue-700"
            >
              Create your first funnel
            </Link>
          </div>
        ) : (
          <div className="overflow-hidden rounded-md border border-neutral-200 bg-white">
            <table className="w-full text-sm">
              <thead className="border-b border-neutral-200 bg-neutral-50 text-left text-xs uppercase tracking-wider text-neutral-500">
                <tr>
                  <th className="px-4 py-3">Name</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Goal</th>
                  <th className="px-4 py-3">Submissions</th>
                  <th className="px-4 py-3">Page</th>
                  <th className="px-4 py-3 text-right">Updated</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {campaigns.map((c) => (
                  <tr key={c.id} className="hover:bg-neutral-50">
                    <td className="px-4 py-3">
                      <Link href={`/dashboard/${workspaceId}/funnels/${c.id}`} className="font-medium text-neutral-900 hover:underline">
                        {c.name}
                      </Link>
                      {c.offerSummary && (
                        <div className="mt-0.5 truncate text-xs text-neutral-500">{c.offerSummary}</div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium capitalize ${STATUS_COLOR[c.status]}`}>
                        {c.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-neutral-600 capitalize">{c.goal.replace(/_/g, ' ')}</td>
                    <td className="px-4 py-3 tabular-nums">{c._count.formSubmissions}</td>
                    <td className="px-4 py-3">
                      {c.landingPage ? (
                        <a
                          href={`/p/${c.landingPage.slug}`}
                          target="_blank"
                          rel="noreferrer"
                          className={`text-xs ${c.landingPage.published ? 'text-blue-600 hover:underline' : 'text-neutral-400'}`}
                        >
                          /p/{c.landingPage.slug} {!c.landingPage.published && '(draft)'}
                        </a>
                      ) : (
                        <span className="text-xs text-neutral-400">no page</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right text-xs text-neutral-500">
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
