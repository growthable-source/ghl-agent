'use client'

/**
 * CRM-trigger editor for the side panel (Phase 4 — T6).
 *
 * The existing CrmEventsEditor list/create-form is a full section
 * editor for the /trigger page. For the side panel we want single-row
 * editing of an existing AgentTrigger, so this is a slimmer version
 * that hits the same PATCH /triggers/[triggerId] endpoint.
 *
 * Fields edited: isActive, eventType, tagFilter, channel, messageMode,
 * fixedMessage, aiInstructions, delaySeconds. Tag is a plain text
 * input (not a TagCombobox) because the combobox needs locationId
 * threading we don't want to plumb just yet — TODO to switch to it.
 */

import { useEffect, useImperativeHandle, useState, forwardRef } from 'react'
import type { BaseEditorProps, EditorHandle } from './types'

type EventType = 'ContactCreate' | 'ContactTagUpdate'
type MessageMode = 'FIXED' | 'AI_GENERATE'

const CHANNELS: { key: string; label: string }[] = [
  { key: 'SMS', label: 'SMS' },
  { key: 'WhatsApp', label: 'WhatsApp' },
  { key: 'FB', label: 'Facebook' },
  { key: 'IG', label: 'Instagram' },
  { key: 'GMB', label: 'Google Business' },
  { key: 'Live_Chat', label: 'Live Chat' },
  { key: 'Email', label: 'Email' },
]

interface AgentTrigger {
  id: string
  eventType: EventType
  tagFilter: string | null
  channel: string
  messageMode: MessageMode
  fixedMessage: string | null
  aiInstructions: string | null
  delaySeconds: number
  isActive: boolean
}

interface Draft {
  eventType: EventType
  tagFilter: string
  channel: string
  messageMode: MessageMode
  fixedMessage: string
  aiInstructions: string
  delaySeconds: number
  isActive: boolean
}

function toDraft(t: AgentTrigger): Draft {
  return {
    eventType: t.eventType,
    tagFilter: t.tagFilter ?? '',
    channel: t.channel,
    messageMode: t.messageMode,
    fixedMessage: t.fixedMessage ?? '',
    aiInstructions: t.aiInstructions ?? '',
    delaySeconds: t.delaySeconds,
    isActive: t.isActive,
  }
}

interface Props extends BaseEditorProps {
  triggerId: string
}

export const CrmTriggerEditor = forwardRef<EditorHandle, Props>(function CrmTriggerEditor(
  { workspaceId, agentId, triggerId, onSaved, onDirtyChange, onSavingChange },
  ref,
) {
  const [loading, setLoading] = useState(true)
  const [baseline, setBaseline] = useState<Draft | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    fetch(`/api/workspaces/${workspaceId}/agents/${agentId}/triggers`, { cache: 'no-store' })
      .then(r => r.ok ? r.json() : Promise.reject(new Error(`Failed (${r.status})`)))
      .then(data => {
        if (cancelled) return
        const found = (data.triggers ?? []).find((t: AgentTrigger) => t.id === triggerId) ?? null
        if (!found) {
          setError('Trigger not found.')
          setBaseline(null)
          setDraft(null)
          return
        }
        const d = toDraft(found)
        setBaseline(d)
        setDraft(d)
      })
      .catch(err => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : 'Failed to load trigger')
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [workspaceId, agentId, triggerId])

  useEffect(() => {
    if (!baseline || !draft) {
      onDirtyChange(false)
      return
    }
    const keys: (keyof Draft)[] = [
      'eventType', 'tagFilter', 'channel', 'messageMode',
      'fixedMessage', 'aiInstructions', 'delaySeconds', 'isActive',
    ]
    const dirty = keys.some(k => baseline[k] !== draft[k])
    onDirtyChange(dirty)
  }, [baseline, draft, onDirtyChange])

  useImperativeHandle(ref, () => ({
    async save() {
      if (!draft) return false
      setError(null)
      onSavingChange?.(true)
      try {
        const res = await fetch(
          `/api/workspaces/${workspaceId}/agents/${agentId}/triggers/${triggerId}`,
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              isActive: draft.isActive,
              eventType: draft.eventType,
              tagFilter: draft.tagFilter || null,
              channel: draft.channel,
              messageMode: draft.messageMode,
              fixedMessage: draft.fixedMessage || null,
              aiInstructions: draft.aiInstructions || null,
              delaySeconds: draft.delaySeconds,
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
  }), [draft, baseline, workspaceId, agentId, triggerId, onSaved, onSavingChange])

  if (loading) {
    return <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>Loading trigger…</p>
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
        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input
            type="checkbox"
            checked={draft.isActive}
            onChange={e => setDraft({ ...draft, isActive: e.target.checked })}
          />
          <span style={{ color: 'var(--text-primary)' }}>Active</span>
        </label>

        <div>
          <label className="text-xs block mb-1 font-medium" style={{ color: 'var(--text-secondary)' }}>
            Event
          </label>
          <select
            value={draft.eventType}
            onChange={e => setDraft({ ...draft, eventType: e.target.value as EventType })}
            className="w-full text-sm px-2.5 py-1.5 rounded border"
            style={{
              borderColor: 'var(--border)',
              background: 'var(--surface)',
              color: 'var(--text-primary)',
            }}
          >
            <option value="ContactCreate">New contact created</option>
            <option value="ContactTagUpdate">Tag added</option>
          </select>
        </div>

        {draft.eventType === 'ContactTagUpdate' && (
          <div>
            <label className="text-xs block mb-1 font-medium" style={{ color: 'var(--text-secondary)' }}>
              Tag
            </label>
            <input
              type="text"
              value={draft.tagFilter}
              onChange={e => setDraft({ ...draft, tagFilter: e.target.value })}
              placeholder="e.g. handoff-to-ai"
              className="w-full text-sm px-2.5 py-1.5 rounded border font-mono"
              style={{
                borderColor: 'var(--border)',
                background: 'var(--surface)',
                color: 'var(--text-primary)',
              }}
            />
          </div>
        )}

        <div>
          <label className="text-xs block mb-1 font-medium" style={{ color: 'var(--text-secondary)' }}>
            Channel
          </label>
          <select
            value={draft.channel}
            onChange={e => setDraft({ ...draft, channel: e.target.value })}
            className="w-full text-sm px-2.5 py-1.5 rounded border"
            style={{
              borderColor: 'var(--border)',
              background: 'var(--surface)',
              color: 'var(--text-primary)',
            }}
          >
            {CHANNELS.map(c => (
              <option key={c.key} value={c.key}>{c.label}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="text-xs block mb-1 font-medium" style={{ color: 'var(--text-secondary)' }}>
            Message mode
          </label>
          <select
            value={draft.messageMode}
            onChange={e => setDraft({ ...draft, messageMode: e.target.value as MessageMode })}
            className="w-full text-sm px-2.5 py-1.5 rounded border"
            style={{
              borderColor: 'var(--border)',
              background: 'var(--surface)',
              color: 'var(--text-primary)',
            }}
          >
            <option value="AI_GENERATE">AI generates message</option>
            <option value="FIXED">Send fixed message</option>
          </select>
        </div>

        {draft.messageMode === 'AI_GENERATE' ? (
          <div>
            <label className="text-xs block mb-1 font-medium" style={{ color: 'var(--text-secondary)' }}>
              Instructions for the AI
            </label>
            <textarea
              value={draft.aiInstructions}
              onChange={e => setDraft({ ...draft, aiInstructions: e.target.value })}
              placeholder="Pick up the conversation, summarise where it left off…"
              rows={3}
              className="w-full text-sm px-2.5 py-1.5 rounded border resize-y"
              style={{
                borderColor: 'var(--border)',
                background: 'var(--surface)',
                color: 'var(--text-primary)',
              }}
            />
          </div>
        ) : (
          <div>
            <label className="text-xs block mb-1 font-medium" style={{ color: 'var(--text-secondary)' }}>
              Fixed message
            </label>
            <textarea
              value={draft.fixedMessage}
              onChange={e => setDraft({ ...draft, fixedMessage: e.target.value })}
              placeholder="Hi {{contact.first_name}}, just following up…"
              rows={3}
              className="w-full text-sm px-2.5 py-1.5 rounded border resize-y"
              style={{
                borderColor: 'var(--border)',
                background: 'var(--surface)',
                color: 'var(--text-primary)',
              }}
            />
          </div>
        )}

        <div>
          <label className="text-xs block mb-1 font-medium" style={{ color: 'var(--text-secondary)' }}>
            Delay (seconds)
          </label>
          <input
            type="number"
            min={0}
            value={draft.delaySeconds}
            onChange={e => setDraft({ ...draft, delaySeconds: Math.max(0, parseInt(e.target.value, 10) || 0) })}
            className="w-full text-sm px-2.5 py-1.5 rounded border"
            style={{
              borderColor: 'var(--border)',
              background: 'var(--surface)',
              color: 'var(--text-primary)',
            }}
          />
        </div>
      </div>
    </div>
  )
})
