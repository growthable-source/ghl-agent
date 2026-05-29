'use client'

/**
 * Stop-condition editor for the side panel (Phase 4 — T5).
 *
 * Loads the agent's stop conditions, picks out the row for the clicked
 * node, and lets the user edit the standard fields:
 *   - conditionType + value
 *   - pauseAgent flag
 *   - tagNeedsAttention flag
 *   - enroll/remove workflow IDs
 *
 * The full /goals page mounts a workflow dropdown sourced from
 * /workflows; we keep workflow IDs as free-text in V1 to stay
 * decoupled (the operator can copy/paste the workflow ID — same as
 * what the /goals POST already accepts on the server side).
 *
 * Save PATCHes /stop-conditions/[conditionId] with the changed fields.
 */

import { useEffect, useImperativeHandle, useState, forwardRef } from 'react'
import type { BaseEditorProps, EditorHandle } from './types'

type StopConditionType =
  | 'APPOINTMENT_BOOKED'
  | 'KEYWORD'
  | 'MESSAGE_COUNT'
  | 'OPPORTUNITY_STAGE'
  | 'SENTIMENT'

interface StopCondition {
  id: string
  conditionType: StopConditionType
  value: string | null
  pauseAgent: boolean
  tagNeedsAttention: boolean
  enrollWorkflowId: string | null
  removeWorkflowId: string | null
}

interface Draft {
  conditionType: StopConditionType
  value: string
  pauseAgent: boolean
  tagNeedsAttention: boolean
  enrollWorkflowId: string
  removeWorkflowId: string
}

const TYPE_LABELS: Record<StopConditionType, string> = {
  APPOINTMENT_BOOKED: 'Appointment booked',
  KEYWORD: 'Keyword match',
  MESSAGE_COUNT: 'Message count',
  OPPORTUNITY_STAGE: 'Pipeline stage',
  SENTIMENT: 'Hostile sentiment',
}

const NEEDS_VALUE: Record<StopConditionType, boolean> = {
  APPOINTMENT_BOOKED: false,
  KEYWORD: true,
  MESSAGE_COUNT: true,
  OPPORTUNITY_STAGE: true,
  SENTIMENT: false,
}

function toDraft(c: StopCondition): Draft {
  return {
    conditionType: c.conditionType,
    value: c.value ?? '',
    pauseAgent: c.pauseAgent,
    tagNeedsAttention: c.tagNeedsAttention,
    enrollWorkflowId: c.enrollWorkflowId ?? '',
    removeWorkflowId: c.removeWorkflowId ?? '',
  }
}

interface Props extends BaseEditorProps {
  stopConditionId: string
}

export const StopConditionEditor = forwardRef<EditorHandle, Props>(function StopConditionEditor(
  { workspaceId, agentId, stopConditionId, onSaved, onDirtyChange, onSavingChange },
  ref,
) {
  const [loading, setLoading] = useState(true)
  const [baseline, setBaseline] = useState<Draft | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    fetch(`/api/workspaces/${workspaceId}/agents/${agentId}/stop-conditions`, { cache: 'no-store' })
      .then(r => r.ok ? r.json() : Promise.reject(new Error(`Failed (${r.status})`)))
      .then(data => {
        if (cancelled) return
        const found = (data.conditions ?? []).find((c: StopCondition) => c.id === stopConditionId) ?? null
        if (!found) {
          setError('Stop condition not found.')
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
        setError(err instanceof Error ? err.message : 'Failed to load stop condition')
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [workspaceId, agentId, stopConditionId])

  useEffect(() => {
    if (!baseline || !draft) {
      onDirtyChange(false)
      return
    }
    const dirty =
      baseline.conditionType !== draft.conditionType
      || baseline.value !== draft.value
      || baseline.pauseAgent !== draft.pauseAgent
      || baseline.tagNeedsAttention !== draft.tagNeedsAttention
      || baseline.enrollWorkflowId !== draft.enrollWorkflowId
      || baseline.removeWorkflowId !== draft.removeWorkflowId
    onDirtyChange(dirty)
  }, [baseline, draft, onDirtyChange])

  useImperativeHandle(ref, () => ({
    async save() {
      if (!draft) return false
      setError(null)
      onSavingChange?.(true)
      try {
        const res = await fetch(
          `/api/workspaces/${workspaceId}/agents/${agentId}/stop-conditions/${stopConditionId}`,
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              conditionType: draft.conditionType,
              value: draft.value || null,
              pauseAgent: draft.pauseAgent,
              tagNeedsAttention: draft.tagNeedsAttention,
              enrollWorkflowId: draft.enrollWorkflowId || null,
              removeWorkflowId: draft.removeWorkflowId || null,
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
  }), [draft, baseline, workspaceId, agentId, stopConditionId, onSaved, onSavingChange])

  if (loading) {
    return <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>Loading stop condition…</p>
  }
  if (error && !draft) {
    return <p className="text-xs" style={{ color: 'var(--accent-red, #dc2626)' }}>{error}</p>
  }
  if (!draft) return null

  const showsValueInput = NEEDS_VALUE[draft.conditionType]

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
        <div>
          <label className="text-xs block mb-1 font-medium" style={{ color: 'var(--text-secondary)' }}>
            Trigger
          </label>
          <select
            value={draft.conditionType}
            onChange={e => setDraft({ ...draft, conditionType: e.target.value as StopConditionType, value: '' })}
            className="w-full text-sm px-2.5 py-1.5 rounded border"
            style={{
              borderColor: 'var(--border)',
              background: 'var(--surface)',
              color: 'var(--text-primary)',
            }}
          >
            {(Object.keys(TYPE_LABELS) as StopConditionType[]).map(t => (
              <option key={t} value={t}>{TYPE_LABELS[t]}</option>
            ))}
          </select>
        </div>

        {showsValueInput && (
          <div>
            <label className="text-xs block mb-1 font-medium" style={{ color: 'var(--text-secondary)' }}>
              Value
            </label>
            <input
              type={draft.conditionType === 'MESSAGE_COUNT' ? 'number' : 'text'}
              value={draft.value}
              onChange={e => setDraft({ ...draft, value: e.target.value })}
              placeholder={
                draft.conditionType === 'KEYWORD' ? 'stop, unsubscribe' :
                draft.conditionType === 'MESSAGE_COUNT' ? '10' :
                draft.conditionType === 'OPPORTUNITY_STAGE' ? 'Pipeline stage ID' : ''
              }
              className="w-full text-sm px-2.5 py-1.5 rounded border"
              style={{
                borderColor: 'var(--border)',
                background: 'var(--surface)',
                color: 'var(--text-primary)',
              }}
            />
          </div>
        )}

        <label className="flex items-start gap-2 text-sm cursor-pointer">
          <input
            type="checkbox"
            checked={draft.pauseAgent}
            onChange={e => setDraft({ ...draft, pauseAgent: e.target.checked })}
            className="mt-0.5"
          />
          <span style={{ color: 'var(--text-primary)' }}>
            Pause the agent
            <span className="block text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
              Stops further replies until a human resumes the conversation.
            </span>
          </span>
        </label>

        <label className="flex items-start gap-2 text-sm cursor-pointer">
          <input
            type="checkbox"
            checked={draft.tagNeedsAttention}
            onChange={e => setDraft({ ...draft, tagNeedsAttention: e.target.checked })}
            className="mt-0.5"
          />
          <span style={{ color: 'var(--text-primary)' }}>
            Tag contact <code style={{ color: 'var(--text-secondary)' }}>needs-attention</code>
            <span className="block text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
              Surfaces the contact on the Needs Attention review page.
            </span>
          </span>
        </label>

        <div>
          <label className="text-xs block mb-1 font-medium" style={{ color: 'var(--text-secondary)' }}>
            Enrol in workflow (ID)
          </label>
          <input
            type="text"
            value={draft.enrollWorkflowId}
            onChange={e => setDraft({ ...draft, enrollWorkflowId: e.target.value })}
            placeholder="(none)"
            className="w-full text-sm px-2.5 py-1.5 rounded border font-mono"
            style={{
              borderColor: 'var(--border)',
              background: 'var(--surface)',
              color: 'var(--text-primary)',
            }}
          />
        </div>

        <div>
          <label className="text-xs block mb-1 font-medium" style={{ color: 'var(--text-secondary)' }}>
            Remove from workflow (ID)
          </label>
          <input
            type="text"
            value={draft.removeWorkflowId}
            onChange={e => setDraft({ ...draft, removeWorkflowId: e.target.value })}
            placeholder="(none)"
            className="w-full text-sm px-2.5 py-1.5 rounded border font-mono"
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
