'use client'

/**
 * Follow-up sequence editor for the side panel (Phase 4 — T9).
 *
 * The /follow-ups page hosts the full multi-step builder (create new
 * sequences, add/remove steps, edit per-step message + delay). The
 * side-panel editor is the trimmed-down inline version: it edits the
 * sequence's metadata — name, active flag, trigger type, trigger value
 * — via PATCH /follow-up-sequences/[sequenceId]. The existing PATCH
 * route only accepts these top-level fields, which means the steps
 * editor stays on the dedicated tab. We render the current steps
 * read-only as a summary so the operator knows what's in the sequence
 * before they toggle it on/off.
 */

import { useEffect, useImperativeHandle, useState, forwardRef } from 'react'
import type { BaseEditorProps, EditorHandle } from './types'

type TriggerType = 'no_reply' | 'keyword' | 'agent' | 'always'

interface FollowUpStep {
  id: string
  stepNumber: number
  delayHours: number
  message: string
}

interface FollowUpSequence {
  id: string
  name: string
  isActive: boolean
  triggerType: string
  triggerValue: string | null
  steps: FollowUpStep[]
}

interface Draft {
  name: string
  isActive: boolean
  triggerType: TriggerType
  triggerValue: string
}

const TRIGGER_OPTIONS: { value: TriggerType; label: string; needsValue: boolean; placeholder?: string }[] = [
  { value: 'no_reply', label: 'No reply', needsValue: false },
  { value: 'keyword', label: 'Keyword detected', needsValue: true, placeholder: 'follow up, call me back' },
  { value: 'agent', label: 'Agent decides (tool call)', needsValue: false },
  { value: 'always', label: 'After every exchange', needsValue: false },
]

function toDraft(s: FollowUpSequence): Draft {
  return {
    name: s.name,
    isActive: s.isActive,
    triggerType: (s.triggerType as TriggerType),
    triggerValue: s.triggerValue ?? '',
  }
}

interface Props extends BaseEditorProps {
  followUpId: string
}

export const FollowUpEditor = forwardRef<EditorHandle, Props>(function FollowUpEditor(
  { workspaceId, agentId, followUpId, onSaved, onDirtyChange, onSavingChange },
  ref,
) {
  const [loading, setLoading] = useState(true)
  const [seq, setSeq] = useState<FollowUpSequence | null>(null)
  const [baseline, setBaseline] = useState<Draft | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    fetch(`/api/workspaces/${workspaceId}/agents/${agentId}/follow-up-sequences`, { cache: 'no-store' })
      .then(r => r.ok ? r.json() : Promise.reject(new Error(`Failed (${r.status})`)))
      .then(data => {
        if (cancelled) return
        const found = (data.sequences ?? []).find((s: FollowUpSequence) => s.id === followUpId) ?? null
        if (!found) {
          setError('Follow-up sequence not found.')
          setSeq(null)
          setBaseline(null)
          setDraft(null)
          return
        }
        const d = toDraft(found)
        setSeq(found)
        setBaseline(d)
        setDraft(d)
      })
      .catch(err => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : 'Failed to load follow-up')
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [workspaceId, agentId, followUpId])

  useEffect(() => {
    if (!baseline || !draft) {
      onDirtyChange(false)
      return
    }
    const dirty =
      baseline.name !== draft.name
      || baseline.isActive !== draft.isActive
      || baseline.triggerType !== draft.triggerType
      || baseline.triggerValue !== draft.triggerValue
    onDirtyChange(dirty)
  }, [baseline, draft, onDirtyChange])

  useImperativeHandle(ref, () => ({
    async save() {
      if (!draft) return false
      setError(null)
      onSavingChange?.(true)
      try {
        const triggerOpt = TRIGGER_OPTIONS.find(o => o.value === draft.triggerType)
        const res = await fetch(
          `/api/workspaces/${workspaceId}/agents/${agentId}/follow-up-sequences/${followUpId}`,
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              name: draft.name,
              isActive: draft.isActive,
              triggerType: draft.triggerType,
              triggerValue: triggerOpt?.needsValue ? draft.triggerValue : null,
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
  }), [draft, baseline, workspaceId, agentId, followUpId, onSaved, onSavingChange])

  if (loading) {
    return <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>Loading follow-up…</p>
  }
  if (error && !draft) {
    return <p className="text-xs" style={{ color: 'var(--accent-red, #dc2626)' }}>{error}</p>
  }
  if (!draft || !seq) return null

  const triggerOpt = TRIGGER_OPTIONS.find(o => o.value === draft.triggerType)

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
            Name
          </label>
          <input
            type="text"
            value={draft.name}
            onChange={e => setDraft({ ...draft, name: e.target.value })}
            className="w-full text-sm px-2.5 py-1.5 rounded border"
            style={{
              borderColor: 'var(--border)',
              background: 'var(--surface)',
              color: 'var(--text-primary)',
            }}
          />
        </div>

        <div>
          <label className="text-xs block mb-1 font-medium" style={{ color: 'var(--text-secondary)' }}>
            Trigger
          </label>
          <select
            value={draft.triggerType}
            onChange={e => setDraft({ ...draft, triggerType: e.target.value as TriggerType, triggerValue: '' })}
            className="w-full text-sm px-2.5 py-1.5 rounded border"
            style={{
              borderColor: 'var(--border)',
              background: 'var(--surface)',
              color: 'var(--text-primary)',
            }}
          >
            {TRIGGER_OPTIONS.map(o => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>

        {triggerOpt?.needsValue && (
          <div>
            <label className="text-xs block mb-1 font-medium" style={{ color: 'var(--text-secondary)' }}>
              Trigger value
            </label>
            <input
              type="text"
              value={draft.triggerValue}
              onChange={e => setDraft({ ...draft, triggerValue: e.target.value })}
              placeholder={triggerOpt.placeholder}
              className="w-full text-sm px-2.5 py-1.5 rounded border"
              style={{
                borderColor: 'var(--border)',
                background: 'var(--surface)',
                color: 'var(--text-primary)',
              }}
            />
          </div>
        )}
      </div>

      {seq.steps.length > 0 && (
        <div
          className="rounded-lg border p-3 space-y-2"
          style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}
        >
          <p className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
            Steps ({seq.steps.length})
          </p>
          <ul className="space-y-1.5">
            {seq.steps.map(step => (
              <li
                key={step.id}
                className="text-[11px] rounded px-2 py-1.5"
                style={{
                  background: 'var(--surface-secondary, #f3f4f6)',
                  color: 'var(--text-primary)',
                }}
              >
                <span className="font-medium">Step {step.stepNumber}</span>
                <span className="opacity-70"> · after {step.delayHours}h</span>
                <p className="mt-0.5 line-clamp-2 opacity-80">{step.message || '(empty)'}</p>
              </li>
            ))}
          </ul>
          <p className="text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
            Edit step contents on the Follow-ups tab.
          </p>
        </div>
      )}
    </div>
  )
})
