'use client'

/**
 * Draft detail dispatcher. Tries the Meta endpoint first; on 404 falls
 * back to Google. Renders MetaDraftView or GoogleDraftView depending on
 * which one returned the row. The platform field on AdCampaignDraft is
 * the source of truth — but the draft IDs are unique across both
 * platforms, so a single id route works for either.
 *
 * (Cleaner alternative: route as /ads/drafts/[platform]/[id]. Skipped
 * for now to keep the wizard's single-routing model and avoid
 * link-rewriting across the codebase.)
 */

import { useEffect, useState, type CSSProperties } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { MetaDraftView } from './MetaDraftView'
import { GoogleDraftView } from './GoogleDraftView'

const card: CSSProperties = {
  background: 'var(--surface)',
  borderWidth: '1px',
  borderStyle: 'solid',
  borderColor: 'var(--border)',
}

interface AnyDraft {
  id: string
  name: string
  platform: string
  // Each view re-narrows payload to its own typed shape. We pass it
  // through opaquely here so the dispatcher doesn't have to know both.
  payload: unknown
  aiReasoning: string | null
  externalCampaignId: string | null
  campaignId: string | null
  createdAt: string
  updatedAt: string
}

export default function DraftDetailPage() {
  const params = useParams<{ workspaceId: string; id: string }>()
  const { workspaceId, id } = params

  const [draft, setDraft] = useState<AnyDraft | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!workspaceId || !id) return
    let cancelled = false
    ;(async () => {
      try {
        // Try Meta first.
        const m = await fetch(`/api/workspaces/${workspaceId}/ad-drafts/meta/${id}`)
        if (m.ok) {
          const { draft } = await m.json()
          if (!cancelled) setDraft(draft)
          return
        }
        if (m.status !== 404) {
          throw new Error((await m.json().catch(() => ({}))).error ?? `Meta lookup failed (${m.status})`)
        }
        // Fall back to Google.
        const g = await fetch(`/api/workspaces/${workspaceId}/ad-drafts/google/${id}`)
        if (g.ok) {
          const { draft } = await g.json()
          if (!cancelled) setDraft(draft)
          return
        }
        if (g.status === 404) {
          throw new Error('Draft not found')
        }
        throw new Error((await g.json().catch(() => ({}))).error ?? `Google lookup failed (${g.status})`)
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Load failed')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [workspaceId, id])

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

  if (draft.platform === 'meta') {
    // The MetaDraftView's typed shape narrows payload internally — the
    // outer dispatcher passes it through opaquely.
    return <MetaDraftView workspaceId={workspaceId} id={id} initialDraft={draft as never} />
  }
  if (draft.platform === 'google') {
    return <GoogleDraftView workspaceId={workspaceId} id={id} initialDraft={draft as never} />
  }
  return (
    <main className="mx-auto w-full max-w-4xl px-6 py-10">
      <div className="rounded-xl p-8 text-center" style={card}>
        <p className="text-sm" style={{ color: 'var(--accent-red)' }}>Unknown platform: {draft.platform}</p>
      </div>
    </main>
  )
}
