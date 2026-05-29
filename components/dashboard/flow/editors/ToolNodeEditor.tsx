'use client'

/**
 * Per-tool config editor extracted from AgentToolRulesEditor for the
 * side-panel mode of the Visual Workflow Canvas (Phase 4 — T3).
 *
 * Loads the agent's tool-config bundle, finds the row for `toolName`,
 * lets the user toggle enabled / edit useWhen / set on-failure mode /
 * write a canned message. Save PATCHes the same tool-config endpoint
 * the /tools page uses with a single-row `tools: [thisOne]` body so
 * the autonomy mode and other tools aren't touched.
 *
 * Wired into the side panel via the EditorHandle ref pattern — the
 * panel owns the footer buttons; this component reports dirty / saving
 * upward via callbacks.
 */

import { useEffect, useImperativeHandle, useState, forwardRef } from 'react'
import type { BaseEditorProps, EditorHandle } from './types'

type OnFailureMode = 'default' | 'transfer_to_human' | 'canned_message' | 'silent_skip'

interface ResolvedToolConfig {
  toolName: string
  enabled: boolean
  useWhen: string
  onFailure: OnFailureMode
  onFailureMessage: string | null
}

const ON_FAILURE_LABELS: Record<OnFailureMode, string> = {
  default: 'Default — graceful AI fallback + pause + email',
  transfer_to_human: 'Transfer to human (skip AI fallback)',
  canned_message: 'Send canned message + pause',
  silent_skip: 'Silent skip (pretend success, continue)',
}

interface Props extends BaseEditorProps {
  toolName: string
}

export const ToolNodeEditor = forwardRef<EditorHandle, Props>(function ToolNodeEditor(
  { workspaceId, agentId, toolName, onSaved, onDirtyChange, onSavingChange },
  ref,
) {
  const [loading, setLoading] = useState(true)
  const [baseline, setBaseline] = useState<ResolvedToolConfig | null>(null)
  const [draft, setDraft] = useState<ResolvedToolConfig | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Load the agent's resolved tool config and pick out the row for this tool.
  // If the row is missing (catalog tool not surfaced by /tool-config GET — should
  // not happen, but defensive) we render an error state and disable save.
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    fetch(`/api/workspaces/${workspaceId}/agents/${agentId}/tool-config`, { cache: 'no-store' })
      .then(r => r.ok ? r.json() : Promise.reject(new Error(`Failed (${r.status})`)))
      .then(data => {
        if (cancelled) return
        const list: ResolvedToolConfig[] = data.tools ?? []
        const row = list.find(t => t.toolName === toolName)
        if (!row) {
          setError(`No catalog entry for "${toolName}".`)
          setBaseline(null)
          setDraft(null)
        } else {
          setBaseline(row)
          setDraft(row)
        }
      })
      .catch(err => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : 'Failed to load tool config')
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [workspaceId, agentId, toolName])

  // Re-derive dirty whenever the draft diverges from baseline.
  useEffect(() => {
    if (!baseline || !draft) {
      onDirtyChange(false)
      return
    }
    const dirty =
      baseline.enabled !== draft.enabled
      || (baseline.useWhen ?? '') !== (draft.useWhen ?? '')
      || baseline.onFailure !== draft.onFailure
      || (baseline.onFailureMessage ?? '') !== (draft.onFailureMessage ?? '')
    onDirtyChange(dirty)
  }, [baseline, draft, onDirtyChange])

  useImperativeHandle(ref, () => ({
    async save() {
      if (!draft) return false
      setError(null)
      onSavingChange?.(true)
      try {
        const res = await fetch(`/api/workspaces/${workspaceId}/agents/${agentId}/tool-config`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            tools: [{
              toolName: draft.toolName,
              enabled: draft.enabled,
              useWhen: draft.useWhen,
              onFailure: draft.onFailure,
              onFailureMessage: draft.onFailureMessage,
            }],
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
  }), [draft, baseline, workspaceId, agentId, onSaved, onSavingChange])

  if (loading) {
    return (
      <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
        Loading tool config…
      </p>
    )
  }
  if (error && !draft) {
    return (
      <p className="text-xs" style={{ color: 'var(--accent-red, #dc2626)' }}>
        {error}
      </p>
    )
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
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={draft.enabled}
            onChange={e => setDraft({ ...draft, enabled: e.target.checked })}
          />
          <span className="text-sm" style={{ color: 'var(--text-primary)' }}>
            Enabled
          </span>
          <code className="text-[11px] font-mono ml-1" style={{ color: 'var(--text-tertiary)' }}>
            {draft.toolName}
          </code>
        </label>

        <div>
          <label className="text-xs block mb-1" style={{ color: 'var(--text-secondary)' }}>
            Use this tool when:
          </label>
          <textarea
            value={draft.useWhen}
            onChange={e => setDraft({ ...draft, useWhen: e.target.value })}
            placeholder="(catalog default applies)"
            rows={3}
            className="w-full text-sm px-2.5 py-1.5 rounded border resize-y"
            style={{
              borderColor: 'var(--border)',
              background: 'var(--surface)',
              color: 'var(--text-primary)',
            }}
          />
        </div>

        <div>
          <label className="text-xs block mb-1" style={{ color: 'var(--text-secondary)' }}>
            On failure:
          </label>
          <select
            value={draft.onFailure}
            onChange={e => setDraft({
              ...draft,
              onFailure: e.target.value as OnFailureMode,
              onFailureMessage: e.target.value === 'canned_message'
                ? (draft.onFailureMessage ?? '')
                : null,
            })}
            className="w-full text-sm px-2.5 py-1.5 rounded border"
            style={{
              borderColor: 'var(--border)',
              background: 'var(--surface)',
              color: 'var(--text-primary)',
            }}
          >
            {(['default', 'transfer_to_human', 'canned_message', 'silent_skip'] as OnFailureMode[]).map(m => (
              <option key={m} value={m}>{ON_FAILURE_LABELS[m]}</option>
            ))}
          </select>
        </div>

        {draft.onFailure === 'canned_message' && (
          <div>
            <label className="text-xs block mb-1" style={{ color: 'var(--text-secondary)' }}>
              Canned message:
            </label>
            <textarea
              value={draft.onFailureMessage ?? ''}
              onChange={e => setDraft({ ...draft, onFailureMessage: e.target.value })}
              rows={3}
              placeholder="Message sent to the contact when this tool fails."
              className="w-full text-sm px-2.5 py-1.5 rounded border resize-y"
              style={{
                borderColor: 'var(--border)',
                background: 'var(--surface)',
                color: 'var(--text-primary)',
              }}
            />
          </div>
        )}
      </div>
    </div>
  )
})
