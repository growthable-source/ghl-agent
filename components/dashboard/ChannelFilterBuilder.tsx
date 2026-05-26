'use client'

/**
 * Per-channel inline filter editor. Renders under each enabled channel
 * row on /trigger. Manages ONE RoutingRule scoped to this channel (via
 * the rule's `channels` array). Two modes:
 *
 *   - "All inbound messages"  → rule with ruleType=ALL, no conditions
 *   - "Filter messages"       → rule with compound clauses (AND'd
 *                                inside one group). For OR semantics
 *                                users go to the dedicated /routing
 *                                page; this inline editor stays single-
 *                                group to keep the per-channel surface
 *                                tight.
 *
 * Save / delete is per-channel, independent of the channel toggle save
 * bar that lives at the page level. Each builder owns its own rule
 * lifecycle so users can iterate one channel at a time without committing
 * the rest.
 */

import { useEffect, useState } from 'react'
import TagCombobox from '@/components/TagCombobox'

type RuleType = 'ALL' | 'TAG' | 'PIPELINE_STAGE' | 'KEYWORD'

interface Clause {
  ruleType: RuleType
  values: string[]
  negate?: boolean
}

export interface RoutingRule {
  id: string
  ruleType: string
  value: string | null
  channels?: string[] | null
  conditions: {
    groups?: { clauses: { ruleType: string; values?: string[]; negate?: boolean }[] }[]
    clauses?: { ruleType: string; values?: string[]; negate?: boolean }[]
  } | null
}

interface Props {
  channel: string                   // 'SMS' | 'FB' | …
  channelLabel: string              // display name
  workspaceId: string
  agentId: string
  locationId: string                // for TagCombobox
  existingRule: RoutingRule | null  // the rule scoped to this channel, if any
  onChanged: () => void             // called after successful save/delete; parent refetches
}

const RULE_TYPE_OPTIONS: { value: RuleType; label: string; takesValues: boolean; supportsNegate: boolean }[] = [
  { value: 'TAG',            label: 'Contact has tag',              takesValues: true,  supportsNegate: true  },
  { value: 'PIPELINE_STAGE', label: 'Contact in pipeline stage',    takesValues: true,  supportsNegate: true  },
  { value: 'KEYWORD',        label: 'Message contains keyword',     takesValues: true,  supportsNegate: true  },
]

function ruleToClauses(rule: RoutingRule | null): { mode: 'all' | 'filter'; clauses: Clause[] } {
  if (!rule) return { mode: 'all', clauses: [{ ruleType: 'TAG', values: [] }] }
  // ALL rule with no conditions → "All inbound" mode.
  const hasConditions =
    (rule.conditions?.groups?.length ?? 0) > 0 || (rule.conditions?.clauses?.length ?? 0) > 0
  if (!hasConditions && rule.ruleType === 'ALL') {
    return { mode: 'all', clauses: [{ ruleType: 'TAG', values: [] }] }
  }
  // Pick the first group (or the legacy single-clauses shape) and
  // surface its clauses for editing. Multi-group OR rules collapse to
  // their first group inline — users with OR semantics edit at /routing.
  const sourceClauses =
    rule.conditions?.groups?.[0]?.clauses ?? rule.conditions?.clauses ?? []
  if (sourceClauses.length === 0) {
    return { mode: 'all', clauses: [{ ruleType: 'TAG', values: [] }] }
  }
  return {
    mode: 'filter',
    clauses: sourceClauses.map(c => ({
      ruleType: (c.ruleType ?? 'TAG') as RuleType,
      values: c.values ?? [],
      negate: c.negate,
    })),
  }
}

export default function ChannelFilterBuilder({
  channel,
  channelLabel,
  workspaceId,
  agentId,
  locationId,
  existingRule,
  onChanged,
}: Props) {
  const initial = ruleToClauses(existingRule)
  const [mode, setMode] = useState<'all' | 'filter'>(initial.mode)
  const [clauses, setClauses] = useState<Clause[]>(initial.clauses)
  // Per-clause search text for TagCombobox / stage / keyword inputs.
  // Keyed by clause index so adjacent clauses don't share input state.
  const [searchText, setSearchText] = useState<Record<number, string>>({})
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Re-sync local state ONLY when the rule's identity changes (id) —
  // not when the parent refetches and returns a structurally-equal but
  // referentially-different conditions object. Without this guard,
  // saving the SMS filter would refetch the whole agent payload, give
  // every sibling builder a fresh `existingRule.conditions` reference,
  // and the effect would fire — wiping any in-progress edits the user
  // had typed into other channels' filters. The id-only key is safe
  // because we own all writes through this component; the only time
  // the rule's content changes mid-edit is when WE just saved it,
  // which already updates local state on the success path.
  useEffect(() => {
    const next = ruleToClauses(existingRule)
    setMode(next.mode)
    setClauses(next.clauses)
    setSearchText({})
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional id-only key, see comment
  }, [existingRule?.id])

  function updateClause(i: number, patch: Partial<Clause>) {
    setClauses(prev => prev.map((c, idx) => (idx === i ? { ...c, ...patch } : c)))
  }
  function addClause() {
    setClauses(prev => [...prev, { ruleType: 'TAG', values: [] }])
  }
  function removeClause(i: number) {
    setClauses(prev => prev.filter((_, idx) => idx !== i))
  }
  function addValue(i: number, value: string) {
    const v = value.trim()
    if (!v) return
    setClauses(prev =>
      prev.map((c, idx) => {
        if (idx !== i) return c
        if (c.values.includes(v)) return c
        return { ...c, values: [...c.values, v] }
      }),
    )
    setSearchText(prev => ({ ...prev, [i]: '' }))
  }
  function removeValue(i: number, value: string) {
    setClauses(prev =>
      prev.map((c, idx) => (idx === i ? { ...c, values: c.values.filter(v => v !== value) } : c)),
    )
  }

  async function handleSave() {
    setSaving(true)
    setError(null)
    try {
      const payload: any = { channels: [channel] }
      if (mode === 'all') {
        payload.ruleType = 'ALL'
        // null conditions on update; the API clears value too.
        payload.conditions = null
      } else {
        const cleaned = clauses
          .map(c => ({
            ruleType: c.ruleType,
            values: c.values.filter(v => v && v.trim()),
            ...(c.negate ? { negate: true } : {}),
          }))
          .filter(c => c.values.length > 0)
        if (cleaned.length === 0) {
          setError('Add at least one filter condition with a value.')
          setSaving(false)
          return
        }
        payload.conditions = { clauses: cleaned }
      }

      if (existingRule) {
        const res = await fetch(`/api/workspaces/${workspaceId}/agents/${agentId}/routing/${existingRule.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `HTTP ${res.status}`)
      } else {
        const res = await fetch(`/api/workspaces/${workspaceId}/agents/${agentId}/routing`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `HTTP ${res.status}`)
      }
      onChanged()
    } catch (err: any) {
      setError(err?.message ?? 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (!existingRule) return
    setSaving(true)
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/agents/${agentId}/routing/${existingRule.id}`, {
        method: 'DELETE',
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      onChanged()
    } catch (err: any) {
      setError(err?.message ?? 'Delete failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      className="mt-2 rounded-lg border p-3 space-y-3"
      style={{ borderColor: 'var(--border)', background: 'var(--background)' }}
    >
      {/* Mode radio */}
      <div className="flex gap-2">
        {[
          { value: 'all' as const,    label: 'All inbound messages',  hint: `Respond to every ${channelLabel} message.` },
          { value: 'filter' as const, label: 'Filter messages',       hint: 'Only respond when conditions match.' },
        ].map(opt => {
          const selected = mode === opt.value
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => setMode(opt.value)}
              className="flex-1 text-left rounded-md border px-2.5 py-2 transition-colors"
              style={
                selected
                  ? { borderColor: 'var(--accent-primary)', background: 'var(--accent-primary-bg)' }
                  : { borderColor: 'var(--border)', background: 'var(--surface)' }
              }
            >
              <div className="flex items-center gap-2">
                <span
                  className="w-3 h-3 rounded-full shrink-0 flex items-center justify-center"
                  style={
                    selected
                      ? { border: '3px solid var(--accent-primary)', background: 'var(--background)' }
                      : { border: '1.5px solid var(--border-secondary, var(--border))' }
                  }
                />
                <span className="text-xs font-medium" style={{ color: 'var(--text-primary)' }}>{opt.label}</span>
              </div>
              <p className="text-[10px] mt-1 ml-5" style={{ color: 'var(--text-tertiary)' }}>{opt.hint}</p>
            </button>
          )
        })}
      </div>

      {/* Compound builder (single AND group). OR semantics live on /routing. */}
      {mode === 'filter' && (
        <div className="space-y-2">
          <p className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--text-tertiary)' }}>
            All of these must match (AND)
          </p>
          {clauses.map((c, i) => {
            const opt = RULE_TYPE_OPTIONS.find(o => o.value === c.ruleType)
            return (
              <div
                key={i}
                className="rounded-md border p-2 space-y-2"
                style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}
              >
                <div className="flex gap-2 items-center">
                  <select
                    value={c.ruleType}
                    onChange={e => updateClause(i, { ruleType: e.target.value as RuleType, values: [] })}
                    className="text-xs px-2 py-1 rounded border"
                    style={{ borderColor: 'var(--border)', background: 'var(--background)', color: 'var(--text-primary)' }}
                  >
                    {RULE_TYPE_OPTIONS.map(o => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                  {opt?.supportsNegate && (
                    <label className="flex items-center gap-1 text-[11px]" style={{ color: 'var(--text-secondary)' }}>
                      <input
                        type="checkbox"
                        checked={!!c.negate}
                        onChange={e => updateClause(i, { negate: e.target.checked })}
                      />
                      NOT
                    </label>
                  )}
                  {clauses.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeClause(i)}
                      className="ml-auto text-[11px]"
                      style={{ color: 'var(--text-tertiary)' }}
                      title="Remove condition"
                    >
                      ✕
                    </button>
                  )}
                </div>

                {opt?.takesValues && (
                  <div className="space-y-1.5">
                    {c.ruleType === 'TAG' ? (
                      <TagCombobox
                        workspaceId={workspaceId}
                        locationId={locationId}
                        value={searchText[i] ?? ''}
                        onChange={(v) => setSearchText(prev => ({ ...prev, [i]: v }))}
                        onSelect={(v) => addValue(i, v)}
                        clearOnSelect
                        placeholder={c.values.length === 0 ? 'Choose or type a tag…' : 'Add another tag…'}
                      />
                    ) : (
                      <input
                        type="text"
                        value={searchText[i] ?? ''}
                        onChange={e => setSearchText(prev => ({ ...prev, [i]: e.target.value }))}
                        onKeyDown={e => {
                          if (e.key === 'Enter') {
                            e.preventDefault()
                            addValue(i, searchText[i] ?? '')
                          }
                        }}
                        placeholder={
                          c.ruleType === 'KEYWORD'
                            ? 'Type a keyword, press Enter…'
                            : 'Type a stage name, press Enter…'
                        }
                        className="w-full text-xs px-2 py-1.5 rounded border"
                        style={{ borderColor: 'var(--border)', background: 'var(--background)', color: 'var(--text-primary)' }}
                      />
                    )}
                    {c.values.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {c.values.map(v => (
                          <span
                            key={v}
                            className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded"
                            style={{ background: 'var(--surface-secondary)', color: 'var(--text-primary)' }}
                          >
                            {v}
                            <button
                              type="button"
                              onClick={() => removeValue(i, v)}
                              style={{ color: 'var(--text-tertiary)' }}
                            >×</button>
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
          <button
            type="button"
            onClick={addClause}
            className="text-[11px] px-2 py-1 rounded border border-dashed w-full"
            style={{ borderColor: 'var(--border)', color: 'var(--text-tertiary)' }}
          >
            + Add condition
          </button>
        </div>
      )}

      {/* Save / delete / status */}
      <div className="flex items-center justify-between gap-2">
        <div className="text-[11px]" style={{ color: error ? 'var(--accent-red, #ef4444)' : 'var(--text-tertiary)' }}>
          {error
            ? error
            : existingRule
              ? mode === 'all'
                ? 'All inbound — agent responds to every message on this channel.'
                : 'Filter rule saved.'
              : 'No filter saved yet — agent will not respond on this channel.'}
        </div>
        <div className="flex gap-2 shrink-0">
          {existingRule && (
            <button
              type="button"
              onClick={handleDelete}
              disabled={saving}
              className="text-[11px] px-2 py-1 rounded border"
              style={{ borderColor: 'var(--border)', color: 'var(--text-tertiary)' }}
            >
              Remove
            </button>
          )}
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="text-[11px] px-3 py-1 rounded font-medium"
            style={{ background: 'var(--btn-primary-bg)', color: 'var(--btn-primary-text)' }}
          >
            {saving ? 'Saving…' : existingRule ? 'Update' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}
