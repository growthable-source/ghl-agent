'use client'

/**
 * Play editor — action-first form for creating / editing a Play (an
 * AgentRule under the hood). The user picks WHAT the agent should do,
 * then describes WHEN it should happen with example phrases.
 *
 * Shared by /playbook/new and /playbook/[playId].
 */

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  PLAY_ACTIONS,
  PLAY_ACTION_GROUP_LABEL,
  PLAY_ACTION_GROUP_ORDER,
  getPlayAction,
  type PlayActionType,
  type PlayActionDef,
} from '@/lib/agent-tools-catalog'

interface ContactField { id: string; name: string; fieldKey: string; dataType: string; group: string }
interface Workflow { id: string; name: string }

const OPPORTUNITY_STATUSES = [
  { value: 'won',       label: 'Won' },
  { value: 'lost',      label: 'Lost' },
  { value: 'abandoned', label: 'Abandoned' },
  { value: 'open',      label: 'Open' },
]

const DND_CHANNELS = [
  { value: '',          label: 'Current conversation channel' },
  { value: 'SMS',       label: 'SMS' },
  { value: 'Email',     label: 'Email' },
  { value: 'WhatsApp',  label: 'WhatsApp' },
  { value: 'FB',        label: 'Facebook Messenger' },
  { value: 'IG',        label: 'Instagram DMs' },
  { value: 'GMB',       label: 'Google Business' },
  { value: 'Live_Chat', label: 'Live Chat' },
]

export interface PlayDraft {
  id?: string
  name: string
  conditionDescription: string
  examples: string[]
  actionType: PlayActionType
  actionParams: Record<string, any>
  targetFieldKey: string
  targetValue: string
  overwrite: boolean
  isActive: boolean
}

export const EMPTY_DRAFT: PlayDraft = {
  name: '',
  conditionDescription: '',
  examples: [],
  actionType: 'opportunity_status',
  actionParams: {},
  targetFieldKey: '',
  targetValue: '',
  overwrite: false,
  isActive: true,
}

export default function PlayEditor({
  workspaceId,
  agentId,
  initial,
  mode,
}: {
  workspaceId: string
  agentId: string
  initial: PlayDraft
  mode: 'new' | 'edit'
}) {
  const router = useRouter()
  const base = `/dashboard/${workspaceId}/agents/${agentId}`

  const [draft, setDraft] = useState<PlayDraft>(initial)
  const [contactFields, setContactFields] = useState<ContactField[]>([])
  const [workflows, setWorkflows] = useState<Workflow[]>([])
  const [workflowsError, setWorkflowsError] = useState<string | null>(null)
  const [newExample, setNewExample] = useState('')
  const [newTag, setNewTag] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const actionDef = getPlayAction(draft.actionType)

  useEffect(() => {
    fetch(`/api/workspaces/${workspaceId}/contact-fields`)
      .then(r => r.json())
      .then(d => setContactFields(d.fields ?? []))
      .catch(() => {})
    fetch(`/api/workspaces/${workspaceId}/workflows`)
      .then(async r => {
        if (!r.ok) {
          setWorkflowsError('Workflows unavailable')
          return null
        }
        return r.json()
      })
      .then(d => d && setWorkflows(d.workflows ?? []))
      .catch(() => setWorkflowsError('Workflows unavailable'))
  }, [workspaceId])

  function update<K extends keyof PlayDraft>(key: K, value: PlayDraft[K]) {
    setDraft(d => ({ ...d, [key]: value }))
  }

  function setActionParam(key: string, value: any) {
    setDraft(d => ({ ...d, actionParams: { ...d.actionParams, [key]: value } }))
  }

  function addExample() {
    const v = newExample.trim()
    if (!v) return
    setDraft(d => ({ ...d, examples: [...d.examples, v] }))
    setNewExample('')
  }

  function removeExample(i: number) {
    setDraft(d => ({ ...d, examples: d.examples.filter((_, idx) => idx !== i) }))
  }

  function pickActionType(type: PlayActionType) {
    // Reset params when the action changes — old params don't apply.
    const def = getPlayAction(type)
    setDraft(d => ({
      ...d,
      actionType: type,
      actionParams: {},
      targetFieldKey: type === 'update_contact_field' ? d.targetFieldKey : '',
      targetValue: type === 'update_contact_field' ? d.targetValue : '',
      // Helpful: pre-fill condition placeholder from the action's example
      // trigger when the field is empty.
      conditionDescription: d.conditionDescription || def?.exampleTrigger || '',
    }))
  }

  async function save() {
    setError(null)
    if (!draft.name.trim()) { setError('Give the Play a name so it shows up clearly in the list.'); return }
    if (!draft.conditionDescription.trim()) { setError('Describe when this Play should fire (the WHEN clause).'); return }
    if (draft.actionType === 'update_contact_field') {
      if (!draft.targetFieldKey.trim()) { setError('Pick a contact field to update.'); return }
      if (!draft.targetValue.trim()) { setError('Provide a value to write to the field.'); return }
    }

    setSaving(true)
    try {
      const body = JSON.stringify({
        name: draft.name.trim(),
        conditionDescription: draft.conditionDescription.trim(),
        examples: draft.examples,
        actionType: draft.actionType,
        actionParams: draft.actionParams,
        targetFieldKey: draft.targetFieldKey,
        targetValue: draft.targetValue,
        overwrite: draft.overwrite,
        isActive: draft.isActive,
      })
      const url = mode === 'edit'
        ? `/api/workspaces/${workspaceId}/agents/${agentId}/rules/${draft.id}`
        : `/api/workspaces/${workspaceId}/agents/${agentId}/rules`
      const res = await fetch(url, {
        method: mode === 'edit' ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error || 'Save failed')
      }
      router.push(`${base}/playbook`)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="p-8 max-w-2xl space-y-6 pb-32">
      {/* Breadcrumb back */}
      <Link
        href={`${base}/playbook`}
        className="text-xs transition-opacity hover:opacity-80 inline-block"
        style={{ color: 'var(--text-tertiary)' }}
      >
        ← Playbook
      </Link>

      {/* Section: Action — what should the agent do? */}
      <section
        className="rounded-xl border"
        style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}
      >
        <header
          className="px-5 py-3.5 border-b"
          style={{ borderColor: 'var(--border-secondary)' }}
        >
          <p
            className="text-[10px] uppercase tracking-wider font-semibold"
            style={{ color: 'var(--text-tertiary)' }}
          >
            Step 1 — Action
          </p>
          <h3 className="text-sm font-semibold mt-0.5" style={{ color: 'var(--text-primary)' }}>
            What should the agent do?
          </h3>
        </header>
        <div className="px-5 py-4 space-y-4">
          {PLAY_ACTION_GROUP_ORDER.map(group => {
            const actions = PLAY_ACTIONS.filter(a => a.group === group)
            return (
              <div key={group}>
                <p
                  className="text-[10px] uppercase tracking-wider font-semibold mb-1.5"
                  style={{ color: 'var(--text-tertiary)' }}
                >
                  {PLAY_ACTION_GROUP_LABEL[group]}
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {actions.map(a => {
                    const selected = draft.actionType === a.key
                    return (
                      <button
                        key={a.key}
                        type="button"
                        onClick={() => pickActionType(a.key)}
                        className="text-left rounded-lg border p-3 transition-colors"
                        style={
                          selected
                            ? { borderColor: 'var(--accent-primary)', background: 'var(--accent-primary-bg)' }
                            : { borderColor: 'var(--border)', background: 'var(--surface)' }
                        }
                      >
                        <p
                          className="text-xs font-medium"
                          style={{ color: selected ? 'var(--accent-primary)' : 'var(--text-primary)' }}
                        >
                          {a.label}
                        </p>
                        <p
                          className="text-[11px] leading-snug mt-0.5"
                          style={{ color: 'var(--text-tertiary)' }}
                        >
                          {a.description}
                        </p>
                      </button>
                    )
                  })}
                </div>
              </div>
            )
          })}

          {/* Per-action parameter panel */}
          {actionDef && (
            <div
              className="rounded-lg border-l-2 pl-4 py-2"
              style={{ borderColor: 'var(--accent-primary)' }}
            >
              <p className="text-[11px] mb-2" style={{ color: 'var(--text-tertiary)' }}>
                Configure: <span style={{ color: 'var(--text-secondary)' }}>{actionDef.label}</span>
              </p>
              <ActionParamsPanel
                actionType={draft.actionType}
                draft={draft}
                update={update}
                setActionParam={setActionParam}
                contactFields={contactFields}
                workflows={workflows}
                workflowsError={workflowsError}
              />
            </div>
          )}
        </div>
      </section>

      {/* Section: Trigger — when */}
      <section
        className="rounded-xl border"
        style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}
      >
        <header
          className="px-5 py-3.5 border-b"
          style={{ borderColor: 'var(--border-secondary)' }}
        >
          <p
            className="text-[10px] uppercase tracking-wider font-semibold"
            style={{ color: 'var(--text-tertiary)' }}
          >
            Step 2 — Trigger
          </p>
          <h3 className="text-sm font-semibold mt-0.5" style={{ color: 'var(--text-primary)' }}>
            When should this fire?
          </h3>
        </header>
        <div className="px-5 py-4 space-y-4">
          {/* Name */}
          <div>
            <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-secondary)' }}>
              Name <span style={{ color: 'var(--text-tertiary)' }}>(shows up in the list)</span>
            </label>
            <input
              type="text"
              value={draft.name}
              onChange={e => update('name', e.target.value)}
              placeholder="e.g. Customer commits to buying"
              className="w-full rounded-lg px-3 py-2 text-sm focus:outline-none"
              style={{ background: 'var(--input-bg)', borderColor: 'var(--input-border)', color: 'var(--input-text)', border: '1px solid' }}
            />
          </div>

          {/* Condition description */}
          <div>
            <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-secondary)' }}>
              When the customer says or does this…
            </label>
            <textarea
              value={draft.conditionDescription}
              onChange={e => update('conditionDescription', e.target.value)}
              rows={3}
              placeholder={actionDef?.exampleTrigger || 'Describe the trigger in plain English'}
              className="w-full rounded-lg px-3 py-2 text-sm focus:outline-none resize-y"
              style={{ background: 'var(--input-bg)', borderColor: 'var(--input-border)', color: 'var(--input-text)', border: '1px solid' }}
            />
            <p className="text-[11px] mt-1" style={{ color: 'var(--text-tertiary)' }}>
              The agent reads each turn against this description. Be specific about
              the situation, not just keywords.
            </p>
          </div>

          {/* Example phrases */}
          <div>
            <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-secondary)' }}>
              Example phrases <span style={{ color: 'var(--text-tertiary)' }}>(optional but recommended)</span>
            </label>
            <div className="flex flex-wrap gap-1.5 mb-2">
              {draft.examples.map((ex, i) => (
                <span
                  key={i}
                  className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-md"
                  style={{ background: 'var(--accent-primary-bg)', color: 'var(--accent-primary)' }}
                >
                  &ldquo;{ex}&rdquo;
                  <button
                    type="button"
                    onClick={() => removeExample(i)}
                    className="opacity-60 hover:opacity-100"
                    title="Remove"
                  >
                    ×
                  </button>
                </span>
              ))}
              {draft.examples.length === 0 && (
                <p className="text-[11px] italic" style={{ color: 'var(--text-tertiary)' }}>
                  No examples yet. Add a few real phrases the agent should match on.
                </p>
              )}
            </div>
            <div className="flex gap-2">
              <input
                type="text"
                value={newExample}
                onChange={e => setNewExample(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addExample() } }}
                placeholder={`e.g. "I'll take it"`}
                className="flex-1 rounded-lg px-3 py-2 text-sm focus:outline-none"
                style={{ background: 'var(--input-bg)', borderColor: 'var(--input-border)', color: 'var(--input-text)', border: '1px solid' }}
              />
              <button
                type="button"
                onClick={addExample}
                disabled={!newExample.trim()}
                className="rounded-lg px-3 py-2 text-xs font-medium transition-opacity disabled:opacity-40"
                style={{ background: 'var(--accent-primary-bg)', color: 'var(--accent-primary)' }}
              >
                Add
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* Active toggle + save */}
      <div
        className="rounded-xl border p-4 flex items-center justify-between gap-4"
        style={{ borderColor: 'var(--border)', background: 'var(--surface-secondary)' }}
      >
        <div>
          <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
            Status
          </p>
          <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
            {draft.isActive ? 'On — fires when the trigger matches' : 'Off — saved but inactive'}
          </p>
        </div>
        <button
          type="button"
          onClick={() => update('isActive', !draft.isActive)}
          className="relative inline-flex h-6 w-11 shrink-0 rounded-full border-2 border-transparent transition-colors"
          style={{ background: draft.isActive ? 'var(--accent-emerald)' : 'var(--toggle-off-bg)' }}
        >
          <span
            className="inline-block h-5 w-5 transform rounded-full shadow transition-transform"
            style={{
              background: 'var(--btn-primary-text)',
              transform: draft.isActive ? 'translateX(20px)' : 'translateX(0)',
            }}
          />
        </button>
      </div>

      {error && (
        <p
          className="text-xs px-4 py-2 rounded-lg"
          style={{ background: 'var(--accent-red-bg, rgba(239,68,68,0.12))', color: 'var(--accent-red, #ef4444)' }}
        >
          {error}
        </p>
      )}

      <div className="flex items-center justify-end gap-3">
        <Link
          href={`${base}/playbook`}
          className="text-sm transition-opacity hover:opacity-80"
          style={{ color: 'var(--text-secondary)' }}
        >
          Cancel
        </Link>
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="rounded-lg px-4 py-2 text-sm font-medium transition-opacity disabled:opacity-50"
          style={{ background: 'var(--accent-primary)', color: 'var(--btn-primary-text)' }}
        >
          {saving ? 'Saving…' : mode === 'edit' ? 'Save changes' : 'Create Play'}
        </button>
      </div>
    </div>
  )
}

// ─── Per-action params ──────────────────────────────────────────────────────
// Each action type has its own small param form. Kept inline rather than
// in separate files because each one is small and they share the same
// styling primitives.

function ActionParamsPanel({
  actionType,
  draft,
  update,
  setActionParam,
  contactFields,
  workflows,
  workflowsError,
}: {
  actionType: PlayActionType
  draft: PlayDraft
  update: <K extends keyof PlayDraft>(k: K, v: PlayDraft[K]) => void
  setActionParam: (k: string, v: any) => void
  contactFields: ContactField[]
  workflows: Workflow[]
  workflowsError: string | null
}) {
  const inputStyle = {
    background: 'var(--input-bg)',
    borderColor: 'var(--input-border)',
    color: 'var(--input-text)',
    border: '1px solid',
  } as const

  switch (actionType) {
    case 'opportunity_status':
      return (
        <div>
          <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-secondary)' }}>
            Set status to
          </label>
          <select
            value={draft.actionParams.status ?? ''}
            onChange={e => setActionParam('status', e.target.value)}
            className="w-full rounded-lg px-3 py-2 text-sm focus:outline-none"
            style={inputStyle}
          >
            <option value="">Pick a status…</option>
            {OPPORTUNITY_STATUSES.map(s => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>
          {actionType === 'opportunity_status' && draft.actionParams.status === 'lost' && (
            <div className="mt-3">
              <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-secondary)' }}>
                Loss reason <span style={{ color: 'var(--text-tertiary)' }}>(optional)</span>
              </label>
              <input
                type="text"
                value={draft.actionParams.lostReason ?? ''}
                onChange={e => setActionParam('lostReason', e.target.value)}
                placeholder="e.g. Price"
                className="w-full rounded-lg px-3 py-2 text-sm focus:outline-none"
                style={inputStyle}
              />
            </div>
          )}
        </div>
      )

    case 'opportunity_value':
      return (
        <div>
          <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-secondary)' }}>
            Deal value
          </label>
          <input
            type="number"
            value={draft.actionParams.value ?? ''}
            onChange={e => setActionParam('value', parseFloat(e.target.value) || 0)}
            placeholder="e.g. 5000"
            className="w-full rounded-lg px-3 py-2 text-sm focus:outline-none"
            style={inputStyle}
          />
          <p className="text-[11px] mt-1" style={{ color: 'var(--text-tertiary)' }}>
            Set a fixed amount. Detection of dynamic values from conversation
            isn't supported yet — for variable amounts, leave blank and the
            agent will set the value when it can extract one.
          </p>
        </div>
      )

    case 'update_contact_tags':
    case 'remove_contact_tags':
      return <TagPicker draft={draft} setActionParam={setActionParam} />

    case 'add_to_workflow':
    case 'remove_from_workflow':
      return (
        <WorkflowPicker
          workflows={workflows}
          workflowsError={workflowsError}
          selected={Array.isArray(draft.actionParams.workflowIds) ? draft.actionParams.workflowIds : []}
          onChange={ids => setActionParam('workflowIds', ids)}
        />
      )

    case 'update_contact_field':
      return (
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-secondary)' }}>
              Field
            </label>
            <select
              value={draft.targetFieldKey}
              onChange={e => update('targetFieldKey', e.target.value)}
              className="w-full rounded-lg px-3 py-2 text-sm focus:outline-none"
              style={inputStyle}
            >
              <option value="">Pick a field…</option>
              <optgroup label="Standard">
                {contactFields.filter(f => f.group === 'standard').map(f => (
                  <option key={f.id} value={f.fieldKey}>{f.name}</option>
                ))}
              </optgroup>
              <optgroup label="Custom">
                {contactFields.filter(f => f.group !== 'standard').map(f => (
                  <option key={f.id} value={f.fieldKey}>{f.name}</option>
                ))}
              </optgroup>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-secondary)' }}>
              Set to
            </label>
            <input
              type="text"
              value={draft.targetValue}
              onChange={e => update('targetValue', e.target.value)}
              placeholder="The value to write"
              className="w-full rounded-lg px-3 py-2 text-sm focus:outline-none"
              style={inputStyle}
            />
          </div>
          <label className="flex items-center gap-2 text-xs" style={{ color: 'var(--text-secondary)' }}>
            <input
              type="checkbox"
              checked={draft.overwrite}
              onChange={e => update('overwrite', e.target.checked)}
            />
            Overwrite the existing value if it's already set
          </label>
        </div>
      )

    case 'dnd_channel':
      return (
        <div>
          <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-secondary)' }}>
            Block messaging on
          </label>
          <select
            value={draft.actionParams.channel ?? ''}
            onChange={e => setActionParam('channel', e.target.value)}
            className="w-full rounded-lg px-3 py-2 text-sm focus:outline-none"
            style={inputStyle}
          >
            {DND_CHANNELS.map(c => (
              <option key={c.value} value={c.value}>{c.label}</option>
            ))}
          </select>
        </div>
      )

    default:
      return null
  }
}

// Inline tag picker — no autocomplete dependency, deliberately minimal.
function TagPicker({
  draft,
  setActionParam,
}: {
  draft: PlayDraft
  setActionParam: (k: string, v: any) => void
}) {
  const [input, setInput] = useState('')
  const tags: string[] = Array.isArray(draft.actionParams.tags) ? draft.actionParams.tags : []
  function add() {
    const v = input.trim()
    if (!v || tags.includes(v)) return
    setActionParam('tags', [...tags, v])
    setInput('')
  }
  function remove(t: string) {
    setActionParam('tags', tags.filter(x => x !== t))
  }
  return (
    <div>
      <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-secondary)' }}>
        Tags
      </label>
      <div className="flex flex-wrap gap-1.5 mb-2">
        {tags.map(t => (
          <span
            key={t}
            className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-md"
            style={{ background: 'var(--accent-primary-bg)', color: 'var(--accent-primary)' }}
          >
            {t}
            <button type="button" onClick={() => remove(t)} className="opacity-60 hover:opacity-100">×</button>
          </span>
        ))}
      </div>
      <div className="flex gap-2">
        <input
          type="text"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); add() } }}
          placeholder="Tag name + Enter"
          className="flex-1 rounded-lg px-3 py-2 text-sm focus:outline-none"
          style={{
            background: 'var(--input-bg)',
            borderColor: 'var(--input-border)',
            color: 'var(--input-text)',
            border: '1px solid',
          }}
        />
        <button
          type="button"
          onClick={add}
          disabled={!input.trim()}
          className="rounded-lg px-3 py-2 text-xs font-medium disabled:opacity-40"
          style={{ background: 'var(--accent-primary-bg)', color: 'var(--accent-primary)' }}
        >
          Add
        </button>
      </div>
      <p className="text-[11px] mt-1" style={{ color: 'var(--text-tertiary)' }}>
        Only tags that exist in your CRM will actually apply — unrecognised
        tags are silently dropped at fire time.
      </p>
    </div>
  )
}

function WorkflowPicker({
  workflows,
  workflowsError,
  selected,
  onChange,
}: {
  workflows: Workflow[]
  workflowsError: string | null
  selected: string[]
  onChange: (ids: string[]) => void
}) {
  if (workflowsError) {
    return (
      <p className="text-xs" style={{ color: 'var(--accent-amber)' }}>
        {workflowsError} — connect LeadConnector with the workflows.readonly scope to use this action.
      </p>
    )
  }
  if (workflows.length === 0) {
    return (
      <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
        No published workflows in this location yet. Publish one in LeadConnector and refresh.
      </p>
    )
  }
  return (
    <div className="flex flex-wrap gap-1.5">
      {workflows.map(wf => {
        const isSelected = selected.includes(wf.id)
        return (
          <button
            key={wf.id}
            type="button"
            onClick={() =>
              onChange(isSelected ? selected.filter(id => id !== wf.id) : [...selected, wf.id])
            }
            className="text-xs px-2 py-1 rounded-md border transition-colors"
            style={
              isSelected
                ? { background: 'var(--accent-primary-bg)', color: 'var(--accent-primary)', borderColor: 'var(--accent-primary)' }
                : { background: 'var(--surface)', color: 'var(--text-secondary)', borderColor: 'var(--border)' }
            }
          >
            {wf.name}
          </button>
        )
      })}
    </div>
  )
}
