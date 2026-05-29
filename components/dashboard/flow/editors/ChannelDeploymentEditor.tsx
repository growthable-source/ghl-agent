'use client'

/**
 * Channel-deployment editor for the side panel (Phase 4 — T7).
 *
 * A channel node in the canvas represents one ChannelDeployment row.
 * The minimal control the side panel needs is the same one the deploy
 * tab offers: a single "Active on this channel" toggle. Save uses the
 * existing PUT /channels bulk-upsert endpoint with a single-entry list,
 * which mirrors how the deploy tab persists the same flag.
 *
 * If we need richer channel config later (channel-specific JSON, scope,
 * etc.) it slots in here without changing the panel wiring.
 */

import { useEffect, useImperativeHandle, useState, forwardRef } from 'react'
import type { BaseEditorProps, EditorHandle } from './types'

interface Deployment {
  id: string
  channel: string
  isActive: boolean
}

interface Draft {
  isActive: boolean
}

interface Props extends BaseEditorProps {
  channel: string
}

const CHANNEL_LABELS: Record<string, string> = {
  SMS: 'SMS',
  WhatsApp: 'WhatsApp',
  FB: 'Facebook Messenger',
  IG: 'Instagram DMs',
  GMB: 'Google Business',
  Live_Chat: 'Live Chat',
  Email: 'Email',
}

export const ChannelDeploymentEditor = forwardRef<EditorHandle, Props>(function ChannelDeploymentEditor(
  { workspaceId, agentId, channel, onSaved, onDirtyChange, onSavingChange },
  ref,
) {
  const [loading, setLoading] = useState(true)
  const [baseline, setBaseline] = useState<Draft | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    fetch(`/api/workspaces/${workspaceId}/agents/${agentId}/channels`, { cache: 'no-store' })
      .then(r => r.ok ? r.json() : Promise.reject(new Error(`Failed (${r.status})`)))
      .then(data => {
        if (cancelled) return
        const found = (data.deployments ?? []).find((d: Deployment) => d.channel === channel)
        // Missing row = the agent has never deployed to this channel, so
        // default isActive=false. Save creates the row via upsert.
        const d: Draft = { isActive: !!found?.isActive }
        setBaseline(d)
        setDraft(d)
      })
      .catch(err => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : 'Failed to load channel')
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [workspaceId, agentId, channel])

  useEffect(() => {
    if (!baseline || !draft) {
      onDirtyChange(false)
      return
    }
    onDirtyChange(baseline.isActive !== draft.isActive)
  }, [baseline, draft, onDirtyChange])

  useImperativeHandle(ref, () => ({
    async save() {
      if (!draft) return false
      setError(null)
      onSavingChange?.(true)
      try {
        const res = await fetch(`/api/workspaces/${workspaceId}/agents/${agentId}/channels`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            channels: [{ channel, isActive: draft.isActive }],
          }),
        })
        if (!res.ok) {
          const body = await res.json().catch(() => ({}))
          throw new Error(body?.error ?? `Save failed (${res.status})`)
        }
        setBaseline(draft)
        onSaved()
        return true
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Save failed')
        return false
      } finally {
        onSavingChange?.(false)
      }
    },
    cancel() {
      if (baseline) setDraft(baseline)
    },
  }), [draft, baseline, workspaceId, agentId, channel, onSaved, onSavingChange])

  if (loading) {
    return <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>Loading channel…</p>
  }
  if (error && !draft) {
    return <p className="text-xs" style={{ color: 'var(--accent-red, #dc2626)' }}>{error}</p>
  }
  if (!draft) return null

  return (
    <div className="space-y-3">
      {error && (
        <p
          className="text-xs rounded px-2 py-1.5"
          style={{
            background: 'var(--accent-red-bg, #fee2e2)',
            color: 'var(--accent-red, #b91c1c)',
          }}
        >
          {error}
        </p>
      )}

      <div
        className="rounded-lg border p-3 space-y-3"
        style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}
      >
        <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
          {CHANNEL_LABELS[channel] ?? channel}
        </p>
        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input
            type="checkbox"
            checked={draft.isActive}
            onChange={e => setDraft({ ...draft, isActive: e.target.checked })}
          />
          <span style={{ color: 'var(--text-primary)' }}>
            Active on this channel
          </span>
        </label>
        <p className="text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
          When off, this agent stops receiving inbound messages from this channel.
          For channel-specific settings (templates, sender IDs, etc.) use the Deploy tab.
        </p>
      </div>
    </div>
  )
})
