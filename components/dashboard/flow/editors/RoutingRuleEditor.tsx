'use client'

/**
 * Simplified routing-rule editor for the side panel (Phase 4 — T4).
 *
 * The full compound-condition builder lives on /routing and is tightly
 * coupled to that page's group/clause state machine — extracting it
 * cleanly would be a half-day yak shave. V1 ships a slim editor that
 * covers the two things operators actually toggle inline: priority and
 * per-channel scope. The compound conditions render as a read-only
 * summary with a "edit on the routing page" hint.
 *
 * Save PATCHes /routing/[ruleId] with the editable fields only —
 * conditions are not touched.
 *
 * TODO: extract the ChannelFilterBuilder / routing-page clause editor
 * into a shared component and mount it here for full parity.
 * Marked DONE_WITH_CONCERNS for that reason.
 */

import { useEffect, useImperativeHandle, useState, forwardRef } from 'react'
import type { BaseEditorProps, EditorHandle } from './types'

const CHANNELS = [
  { key: 'SMS', label: 'SMS' },
  { key: 'WhatsApp', label: 'WhatsApp' },
  { key: 'FB', label: 'Facebook' },
  { key: 'IG', label: 'Instagram' },
  { key: 'GMB', label: 'Google Business' },
  { key: 'Live_Chat', label: 'Live Chat' },
  { key: 'Email', label: 'Email' },
] as const

interface RoutingRule {
  id: string
  ruleType: string
  value: string | null
  priority: number
  channels: string[]
  conditions: unknown
}

interface Draft {
  priority: number
  channels: string[]
}

interface Props extends BaseEditorProps {
  routingRuleId: string
}

function describeConditions(rule: RoutingRule): string {
  const c = rule.conditions as
    | { groups?: Array<{ clauses?: Array<{ ruleType?: string; values?: string[] }> }>; clauses?: Array<{ ruleType?: string; values?: string[] }> }
    | null
  if (c?.groups && c.groups.length > 0) {
    return c.groups.map(g =>
      (g.clauses ?? []).map(cl => `${cl.ruleType ?? '?'}: ${(cl.values ?? []).join(', ')}`).join(' AND '),
    ).join(' OR ')
  }
  if (c?.clauses && c.clauses.length > 0) {
    return c.clauses.map(cl => `${cl.ruleType ?? '?'}: ${(cl.values ?? []).join(', ')}`).join(' AND ')
  }
  if (rule.ruleType === 'ALL') return 'All inbound messages'
  return rule.value ? `${rule.ruleType} = ${rule.value}` : rule.ruleType
}

export const RoutingRuleEditor = forwardRef<EditorHandle, Props>(function RoutingRuleEditor(
  { workspaceId, agentId, routingRuleId, onSaved, onDirtyChange, onSavingChange },
  ref,
) {
  const [loading, setLoading] = useState(true)
  const [rule, setRule] = useState<RoutingRule | null>(null)
  const [baseline, setBaseline] = useState<Draft | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    fetch(`/api/workspaces/${workspaceId}/agents/${agentId}/routing`, { cache: 'no-store' })
      .then(r => r.ok ? r.json() : Promise.reject(new Error(`Failed (${r.status})`)))
      .then(data => {
        if (cancelled) return
        const list: RoutingRule[] = (data.rules ?? []).map((r: any) => ({
          ...r,
          channels: Array.isArray(r.channels) ? r.channels : [],
        }))
        const found = list.find(r => r.id === routingRuleId) ?? null
        if (!found) {
          setError('Routing rule not found.')
          setRule(null)
          setBaseline(null)
          setDraft(null)
          return
        }
        const base: Draft = { priority: found.priority, channels: [...found.channels] }
        setRule(found)
        setBaseline(base)
        setDraft(base)
      })
      .catch(err => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : 'Failed to load routing rules')
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [workspaceId, agentId, routingRuleId])

  useEffect(() => {
    if (!baseline || !draft) {
      onDirtyChange(false)
      return
    }
    const sameChannels =
      baseline.channels.length === draft.channels.length
      && baseline.channels.every(c => draft.channels.includes(c))
    onDirtyChange(baseline.priority !== draft.priority || !sameChannels)
  }, [baseline, draft, onDirtyChange])

  useImperativeHandle(ref, () => ({
    async save() {
      if (!draft) return false
      setError(null)
      onSavingChange?.(true)
      try {
        const res = await fetch(
          `/api/workspaces/${workspaceId}/agents/${agentId}/routing/${routingRuleId}`,
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              priority: draft.priority,
              channels: draft.channels,
            }),
          },
        )
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
  }), [draft, baseline, workspaceId, agentId, routingRuleId, onSaved, onSavingChange])

  if (loading) {
    return <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>Loading rule…</p>
  }
  if (error && !draft) {
    return <p className="text-xs" style={{ color: 'var(--accent-red, #dc2626)' }}>{error}</p>
  }
  if (!draft || !rule) return null

  function toggleChannel(key: string) {
    if (!draft) return
    setDraft({
      ...draft,
      channels: draft.channels.includes(key)
        ? draft.channels.filter(c => c !== key)
        : [...draft.channels, key],
    })
  }

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
        className="rounded-lg border p-3 space-y-2"
        style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}
      >
        <label className="text-xs block font-medium" style={{ color: 'var(--text-secondary)' }}>
          Match conditions
        </label>
        <p
          className="text-xs rounded px-2 py-1.5 font-mono"
          style={{
            background: 'var(--surface-secondary, #f3f4f6)',
            color: 'var(--text-primary)',
          }}
        >
          {describeConditions(rule)}
        </p>
        <p className="text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
          To rewrite the condition itself, open the agent&rsquo;s Routing tab. This panel only
          edits priority + scope.
        </p>
      </div>

      <div
        className="rounded-lg border p-3 space-y-2"
        style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}
      >
        <label className="text-xs block font-medium" style={{ color: 'var(--text-secondary)' }}>
          Priority
        </label>
        <input
          type="number"
          value={draft.priority}
          onChange={e => setDraft({ ...draft, priority: parseInt(e.target.value, 10) || 0 })}
          className="w-full text-sm px-2.5 py-1.5 rounded border"
          style={{
            borderColor: 'var(--border)',
            background: 'var(--surface)',
            color: 'var(--text-primary)',
          }}
        />
        <p className="text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
          Lower number = evaluated first. 999 is reserved for catch-all rules.
        </p>
      </div>

      <div
        className="rounded-lg border p-3 space-y-2"
        style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}
      >
        <label className="text-xs block font-medium" style={{ color: 'var(--text-secondary)' }}>
          Channels
        </label>
        <p className="text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
          Empty list = applies to every channel this agent listens on.
        </p>
        <div className="space-y-1.5">
          {CHANNELS.map(c => (
            <label key={c.key} className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={draft.channels.includes(c.key)}
                onChange={() => toggleChannel(c.key)}
              />
              <span style={{ color: 'var(--text-primary)' }}>{c.label}</span>
            </label>
          ))}
        </div>
      </div>
    </div>
  )
})
