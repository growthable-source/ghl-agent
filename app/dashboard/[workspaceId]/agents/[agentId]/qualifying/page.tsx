'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { MergeFieldTextarea } from '@/components/MergeFieldHelper'

interface QualifyingQuestion {
  id: string
  question: string
  fieldKey: string
  required: boolean
  order: number
  answerType: string
  choices: string[]
  conditionOp: string | null
  conditionVal: string | null
  conditionValues: string[]
  actionType: string | null
  actionValue: string | null
  actionParams: Record<string, any> | null
  crmFieldKey: string | null
  overwrite: boolean
}

interface WorkflowOption { id: string; name: string }

interface ContactField {
  id: string
  name: string
  fieldKey: string
  dataType: string
  group: string
}

const ANSWER_TYPES = [
  { value: 'text', label: 'Text', desc: 'Free-form answer' },
  { value: 'yes_no', label: 'Yes / No', desc: 'Boolean response' },
  { value: 'number', label: 'Number', desc: 'Numeric value' },
  { value: 'choice', label: 'Multiple Choice', desc: 'Pick from options' },
]

// Condition ops available to every question, plus the multi-select op
// `is_any_of` which is only offered when the question is a multiple-choice
// type (the answers come from the question's own `choices`).
const CONDITION_OPS: Record<string, { label: string; needsValue: boolean; multiChoiceOnly?: boolean }> = {
  any:        { label: 'is anything (always trigger)', needsValue: false },
  is_yes:     { label: 'is yes', needsValue: false },
  is_no:      { label: 'is no', needsValue: false },
  is_any_of:  { label: 'is any of…', needsValue: false, multiChoiceOnly: true },
  contains:   { label: 'contains', needsValue: true },
  equals:     { label: 'equals', needsValue: true },
  gt:         { label: 'is greater than', needsValue: true },
  lt:         { label: 'is less than', needsValue: true },
}

// `needsValue` drives the legacy single-string input. `paramKind` routes
// the newer actions to an action-specific UI below.
type ActionParamKind = 'none' | 'text' | 'workflows' | 'opportunity_status' | 'opportunity_value' | 'dnd_channel'
const ACTION_TYPES: Record<string, { label: string; needsValue: boolean; placeholder?: string; paramKind: ActionParamKind }> = {
  continue:             { label: 'Continue conversation',           needsValue: false, paramKind: 'none' },
  tag:                  { label: 'Tag contact with',                needsValue: true,  placeholder: 'e.g. hot-lead', paramKind: 'text' },
  stage:                { label: 'Move to pipeline stage',          needsValue: true,  placeholder: 'Stage name or ID', paramKind: 'text' },
  book:                 { label: 'Proceed to book appointment',     needsValue: false, paramKind: 'none' },
  stop:                 { label: 'Stop & hand off to human',        needsValue: false, paramKind: 'none' },
  add_to_workflow:      { label: 'Add contact to workflow(s)',      needsValue: false, paramKind: 'workflows' },
  remove_from_workflow: { label: 'Remove contact from workflow(s)', needsValue: false, paramKind: 'workflows' },
  opportunity_status:   { label: 'Change opportunity status',       needsValue: false, paramKind: 'opportunity_status' },
  opportunity_value:    { label: 'Set opportunity value',           needsValue: false, paramKind: 'opportunity_value' },
  dnd_channel:          { label: 'Mark contact DND on this channel', needsValue: false, paramKind: 'dnd_channel' },
}

const OPPORTUNITY_STATUSES = [
  { value: 'won',       label: 'Won' },
  { value: 'lost',      label: 'Lost' },
  { value: 'abandoned', label: 'Abandoned' },
  { value: 'open',      label: 'Open' },
]

const DND_CHANNELS = [
  { value: '',          label: 'Current channel (whichever they messaged on)' },
  { value: 'SMS',       label: 'SMS' },
  { value: 'Email',     label: 'Email' },
  { value: 'WhatsApp',  label: 'WhatsApp' },
  { value: 'FB',        label: 'Facebook Messenger' },
  { value: 'IG',        label: 'Instagram DMs' },
  { value: 'GMB',       label: 'Google Business' },
  { value: 'Live_Chat', label: 'Live Chat' },
]

function conditionLabel(q: QualifyingQuestion): string | null {
  if (!q.conditionOp || !q.actionType) return null
  const cond = CONDITION_OPS[q.conditionOp]
  const act = ACTION_TYPES[q.actionType]
  if (!cond || !act) return null
  let str = `If answer ${cond.label}`
  if (cond.needsValue && q.conditionVal) str += ` "${q.conditionVal}"`
  if (q.conditionOp === 'is_any_of' && q.conditionValues?.length) {
    str += ` ${q.conditionValues.map(v => `"${v}"`).join(' / ')}`
  }
  str += ` → ${act.label}`
  if (act.needsValue && q.actionValue) str += ` "${q.actionValue}"`
  const p = q.actionParams ?? {}
  if (act.paramKind === 'workflows' && Array.isArray(p.workflowNames) && p.workflowNames.length > 0) {
    str += ` (${p.workflowNames.join(', ')})`
  } else if (act.paramKind === 'opportunity_status' && p.status) {
    str += ` → ${p.status}`
  } else if (act.paramKind === 'opportunity_value' && p.monetaryValue !== undefined) {
    str += ` → ${p.monetaryValue}`
  } else if (act.paramKind === 'dnd_channel') {
    str += p.channel ? ` (${p.channel})` : ' (current channel)'
  }
  return str
}

const emptyForm = {
  question: '',
  fieldKey: '',
  required: true,
  answerType: 'text',
  choices: [] as string[],
  conditionOp: '',
  conditionVal: '',
  conditionValues: [] as string[],
  actionType: '',
  actionValue: '',
  actionParams: {} as Record<string, any>,
  showConditional: false,
  newChoice: '',
  crmFieldKey: '',
  overwrite: false,
}

export default function QualifyingPage() {
  const params = useParams()
  const workspaceId = params.workspaceId as string
  const agentId = params.agentId as string

  const [questions, setQuestions] = useState<QualifyingQuestion[]>([])
  const [loading, setLoading] = useState(true)
  const [adding, setAdding] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState(emptyForm)
  const [contactFields, setContactFields] = useState<ContactField[]>([])
  const [qualifyingStyle, setQualifyingStyle] = useState<'strict' | 'natural'>('strict')
  const [styleSaving, setStyleSaving] = useState(false)
  const [workflows, setWorkflows] = useState<WorkflowOption[]>([])
  const [workflowsError, setWorkflowsError] = useState<string | null>(null)

  useEffect(() => {
    Promise.all([
      fetch(`/api/workspaces/${workspaceId}/agents/${agentId}/qualifying-questions`)
        .then(r => r.json())
        .then(({ questions }) => setQuestions(questions ?? [])),
      fetch(`/api/workspaces/${workspaceId}/contact-fields`)
        .then(r => r.json())
        .then(({ fields }) => setContactFields(fields ?? []))
        .catch(() => {}),
      fetch(`/api/workspaces/${workspaceId}/agents/${agentId}`)
        .then(r => r.json())
        .then(({ agent }) => setQualifyingStyle(agent.qualifyingStyle ?? 'strict'))
        .catch(() => {}),
      fetch(`/api/workspaces/${workspaceId}/workflows`)
        .then(async r => {
          if (!r.ok) {
            const body = await r.json().catch(() => ({}))
            setWorkflowsError(body.error || `Failed to load workflows (${r.status})`)
            return { workflows: [] }
          }
          return r.json()
        })
        .then(({ workflows }) => setWorkflows(workflows ?? []))
        .catch(err => setWorkflowsError(err?.message ?? 'Failed to load workflows')),
    ]).finally(() => setLoading(false))
  }, [workspaceId, agentId])

  function autoFieldKey(question: string) {
    return question
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .trim()
      .split(/\s+/)
      .slice(0, 3)
      .join('_')
  }

  function updateForm(key: string, value: any) {
    setForm(prev => {
      const next = { ...prev, [key]: value }
      if (key === 'question' && !editingId) {
        next.fieldKey = autoFieldKey(value)
      }
      return next
    })
  }

  function startEdit(q: QualifyingQuestion) {
    setEditingId(q.id)
    setForm({
      question: q.question,
      fieldKey: q.fieldKey,
      required: q.required,
      answerType: q.answerType,
      choices: q.choices ?? [],
      conditionOp: q.conditionOp ?? '',
      conditionVal: q.conditionVal ?? '',
      conditionValues: q.conditionValues ?? [],
      actionType: q.actionType ?? '',
      actionValue: q.actionValue ?? '',
      actionParams: q.actionParams ?? {},
      showConditional: !!(q.conditionOp && q.actionType),
      newChoice: '',
      crmFieldKey: q.crmFieldKey ?? '',
      overwrite: q.overwrite,
    })
    // Scroll form into view
    setTimeout(() => document.getElementById('q-form')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50)
  }

  function cancelEdit() {
    setEditingId(null)
    setForm(emptyForm)
  }

  function addChoice() {
    if (!form.newChoice.trim()) return
    setForm(prev => ({ ...prev, choices: [...prev.choices, prev.newChoice.trim()], newChoice: '' }))
  }

  function removeChoice(i: number) {
    setForm(prev => ({ ...prev, choices: prev.choices.filter((_, idx) => idx !== i) }))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.question.trim()) return
    const fieldKey = form.fieldKey.trim() || autoFieldKey(form.question)
    setAdding(true)

    const actInfo = form.actionType ? ACTION_TYPES[form.actionType] : null
    const payload = {
      question: form.question,
      fieldKey,
      required: form.required,
      answerType: form.answerType,
      choices: form.choices,
      conditionOp: form.showConditional && form.conditionOp ? form.conditionOp : null,
      conditionVal: form.showConditional && form.conditionOp ? form.conditionVal : null,
      conditionValues: form.showConditional && form.conditionOp === 'is_any_of' ? form.conditionValues : [],
      actionType: form.showConditional && form.actionType ? form.actionType : null,
      actionValue: form.showConditional && form.actionType ? form.actionValue : null,
      // Only send actionParams for actions that use them. Clears the column
      // cleanly when the user switches from (say) add_to_workflow → tag.
      actionParams: form.showConditional && form.actionType && actInfo && actInfo.paramKind !== 'none' && actInfo.paramKind !== 'text'
        ? form.actionParams
        : null,
      crmFieldKey: form.crmFieldKey || null,
      overwrite: form.overwrite,
    }

    if (editingId) {
      const res = await fetch(`/api/workspaces/${workspaceId}/agents/${agentId}/qualifying-questions/${editingId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const { question: updated } = await res.json()
      setQuestions(prev => prev.map(q => q.id === editingId ? updated : q))
      setEditingId(null)
    } else {
      const res = await fetch(`/api/workspaces/${workspaceId}/agents/${agentId}/qualifying-questions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...payload, order: questions.length }),
      })
      const { question } = await res.json()
      setQuestions(prev => [...prev, question])
    }

    setForm(emptyForm)
    setAdding(false)
  }

  async function deleteQuestion(id: string) {
    await fetch(`/api/workspaces/${workspaceId}/agents/${agentId}/qualifying-questions/${id}`, { method: 'DELETE' })
    setQuestions(prev => prev.filter(q => q.id !== id))
  }

  const condInfo = form.conditionOp ? CONDITION_OPS[form.conditionOp] : null
  const actInfo = form.actionType ? ACTION_TYPES[form.actionType] : null

  const standardFields = contactFields.filter(f => f.group === 'Standard')
  const customFields = contactFields.filter(f => f.group === 'Custom')

  function fieldName(fieldKey: string) {
    return contactFields.find(f => f.fieldKey === fieldKey)?.name ?? fieldKey
  }

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <p className="text-zinc-500 text-sm">Loading…</p>
    </div>
  )

  return (
    <div className="p-8 max-w-2xl">
      <p className="text-sm text-zinc-400 mb-4">
        Questions the agent asks during the conversation. Map answers to contact fields and trigger actions based on responses.
      </p>

      {/* Qualifying Style Toggle */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-4 mb-6">
        <label className="block text-sm font-medium text-zinc-300 mb-2">Questioning style</label>
        <div className="grid grid-cols-2 gap-2">
          {([
            { value: 'strict' as const, label: 'Strict', desc: 'Must ask all questions in order before anything else' },
            { value: 'natural' as const, label: 'Natural', desc: 'Weave questions into conversation as opportunities arise' },
          ]).map(opt => (
            <button key={opt.value} type="button"
              disabled={styleSaving}
              onClick={async () => {
                setQualifyingStyle(opt.value)
                setStyleSaving(true)
                await fetch(`/api/workspaces/${workspaceId}/agents/${agentId}`, {
                  method: 'PATCH',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ qualifyingStyle: opt.value }),
                })
                setStyleSaving(false)
              }}
              className={`flex flex-col gap-1 rounded-lg border p-3 text-left transition-colors ${
                qualifyingStyle === opt.value
                  ? 'border-white bg-zinc-900'
                  : 'border-zinc-800 hover:border-zinc-600'
              }`}>
              <span className="text-sm font-medium text-zinc-200">{opt.label}</span>
              <span className="text-xs text-zinc-500">{opt.desc}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Existing questions */}
      {questions.length > 0 && (
        <div className="space-y-2 mb-6">
          {questions.sort((a, b) => a.order - b.order).map((q, idx) => (
            <div key={q.id} className="rounded-xl border border-zinc-800 bg-zinc-950 p-4">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-2 flex-wrap">
                    <span className="text-xs text-zinc-600 font-mono">{idx + 1}</span>
                    <span className="text-xs font-mono text-zinc-400 bg-zinc-800 rounded px-1.5 py-0.5">{q.fieldKey}</span>
                    <span className="text-xs px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400 capitalize">{q.answerType.replace('_', '/')}</span>
                    {q.required && <span className="text-xs px-1.5 py-0.5 rounded bg-amber-900/30 text-amber-400">required</span>}
                    {q.crmFieldKey && (
                      <span className="text-xs px-1.5 py-0.5 rounded bg-blue-900/30 text-blue-400">
                        → {fieldName(q.crmFieldKey)} {q.overwrite ? '(overwrite)' : '(keep first)'}
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-zinc-200 mb-2">{q.question}</p>
                  {q.choices?.length > 0 && (
                    <div className="flex flex-wrap gap-1 mb-2">
                      {q.choices.map(c => (
                        <span key={c} className="text-xs bg-zinc-800 text-zinc-400 rounded-full px-2 py-0.5">{c}</span>
                      ))}
                    </div>
                  )}
                  {conditionLabel(q) && (
                    <div className="flex items-center gap-1.5 mt-2 p-2 rounded-lg bg-zinc-900 border border-zinc-800">
                      <span className="text-xs text-zinc-500">⚡</span>
                      <span className="text-xs text-zinc-400">{conditionLabel(q)}</span>
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-3 shrink-0 mt-1">
                  <button
                    onClick={() => startEdit(q)}
                    className="text-xs text-zinc-500 hover:text-white transition-colors"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => deleteQuestion(q.id)}
                    className="text-xs text-zinc-600 hover:text-red-400 transition-colors"
                  >
                    Remove
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add / Edit form */}
      <div id="q-form" className={`rounded-xl border bg-zinc-950 overflow-hidden ${editingId ? 'border-zinc-600' : 'border-zinc-700'}`}>
        <div className="px-5 py-3 border-b border-zinc-800 flex items-center justify-between">
          <p className="text-sm font-medium text-zinc-200">{editingId ? 'Edit Question' : 'Add Question'}</p>
          {editingId && (
            <button type="button" onClick={cancelEdit} className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors">
              Cancel
            </button>
          )}
        </div>
        <form onSubmit={handleSubmit} className="p-5 space-y-5">
          {/* Question — merge-field aware. Tokens like
              {{contact.first_name|there}} render to the live contact's
              data before the agent asks the question. Custom GHL fields
              available via the {{…}} Insert value popover. */}
          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-1.5">Question</label>
            <MergeFieldTextarea
              value={form.question}
              onChange={e => updateForm('question', e.target.value)}
              onValueChange={v => updateForm('question', v)}
              customFields={contactFields.map(f => ({ name: f.name, fieldKey: f.fieldKey }))}
              placeholder="Hi {{contact.first_name|there}}, are you looking to buy or rent?"
              required
              rows={2}
              className="w-full bg-zinc-900 border border-zinc-700 rounded-lg pl-3 pr-3 pt-8 pb-2 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-zinc-500 resize-none"
            />
            <p className="text-[11px] text-zinc-600 mt-1">
              Use <span className="font-mono">{'{{'}contact.first_name|there{'}}'}</span> or any custom field to personalise — resolved at send time.
            </p>
          </div>

          {/* Answer Type */}
          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-1.5">Answer Type</label>
            <div className="grid grid-cols-2 gap-2">
              {ANSWER_TYPES.map(t => (
                <button
                  key={t.value}
                  type="button"
                  onClick={() => updateForm('answerType', t.value)}
                  className={`text-left px-3 py-2.5 rounded-lg border text-sm transition-colors ${
                    form.answerType === t.value
                      ? 'border-zinc-500 bg-zinc-800 text-white'
                      : 'border-zinc-800 text-zinc-500 hover:border-zinc-700 hover:text-zinc-400'
                  }`}
                >
                  <div className="font-medium">{t.label}</div>
                  <div className="text-xs text-zinc-600 mt-0.5">{t.desc}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Choices (only for choice type) */}
          {form.answerType === 'choice' && (
            <div>
              <label className="block text-xs font-medium text-zinc-400 mb-1.5">Options</label>
              <div className="flex flex-wrap gap-1.5 mb-2 min-h-[24px]">
                {form.choices.map((c, i) => (
                  <span key={i} className="flex items-center gap-1 bg-zinc-800 text-zinc-300 text-xs rounded-full px-2.5 py-1">
                    {c}
                    <button type="button" onClick={() => removeChoice(i)} className="text-zinc-500 hover:text-red-400 ml-0.5 leading-none">×</button>
                  </span>
                ))}
              </div>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={form.newChoice}
                  onChange={e => setForm(p => ({ ...p, newChoice: e.target.value }))}
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addChoice() }}}
                  placeholder="Type an option and press Enter…"
                  className="flex-1 bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-zinc-500"
                />
                <button type="button" onClick={addChoice} className="px-3 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-sm rounded-lg transition-colors">
                  Add
                </button>
              </div>
            </div>
          )}

          {/* Save to contact field */}
          <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4 space-y-3">
            <div>
              <label className="block text-xs font-medium text-zinc-300 mb-1">Save answer to contact field</label>
              <p className="text-xs text-zinc-600 mb-2">When the agent gets an answer, write it directly to the contact record.</p>
              <select
                value={form.crmFieldKey}
                onChange={e => {
                  const val = e.target.value
                  updateForm('crmFieldKey', val)
                  // Auto-populate internal key from field selection if not set
                  if (val && !form.fieldKey) {
                    const slug = val.replace('contact.', '').replace(/[^a-z0-9]/gi, '_').toLowerCase()
                    updateForm('fieldKey', slug)
                  }
                }}
                className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-zinc-500"
              >
                <option value="">Don&apos;t save to contact</option>
                {standardFields.length > 0 && (
                  <optgroup label="Standard Fields">
                    {standardFields.map(f => (
                      <option key={f.id} value={f.fieldKey}>{f.name}</option>
                    ))}
                  </optgroup>
                )}
                {customFields.length > 0 && (
                  <optgroup label="Custom Fields">
                    {customFields.map(f => (
                      <option key={f.id} value={f.fieldKey}>{f.name}</option>
                    ))}
                  </optgroup>
                )}
              </select>
            </div>

            {form.crmFieldKey && (
              <button
                type="button"
                onClick={() => updateForm('overwrite', !form.overwrite)}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg border text-sm transition-colors text-left ${
                  form.overwrite
                    ? 'border-blue-700 bg-blue-900/20 text-blue-300'
                    : 'border-zinc-700 text-zinc-400'
                }`}
              >
                <span className={`w-4 h-4 rounded border-2 flex-shrink-0 flex items-center justify-center ${
                  form.overwrite ? 'border-blue-500 bg-blue-500' : 'border-zinc-600'
                }`}>
                  {form.overwrite && <span className="text-white text-[10px] leading-none">✓</span>}
                </span>
                <span>
                  {form.overwrite
                    ? 'Overwrite — always update the field with the latest answer'
                    : 'Keep first answer — don\'t overwrite if field already has a value'}
                </span>
              </button>
            )}
          </div>

          {/* Required toggle — internal key is auto-generated, not shown */}
          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-1.5">Required</label>
            <button
              type="button"
              onClick={() => updateForm('required', !form.required)}
              className={`w-40 h-10 rounded-lg border text-sm font-medium transition-colors ${
                form.required
                  ? 'border-amber-600 bg-amber-900/20 text-amber-400'
                  : 'border-zinc-700 bg-zinc-900 text-zinc-500'
              }`}
            >
              {form.required ? 'Required' : 'Optional'}
            </button>
          </div>

          {/* Conditional action — collapsible */}
          <div className="rounded-lg border border-zinc-800 overflow-hidden">
            <button
              type="button"
              onClick={() => updateForm('showConditional', !form.showConditional)}
              className="w-full flex items-center justify-between px-4 py-3 text-sm text-zinc-400 hover:text-zinc-300 transition-colors"
            >
              <span className="flex items-center gap-2">
                <span className="text-zinc-600">⚡</span>
                <span>Conditional Action <span className="text-zinc-600">(optional)</span></span>
              </span>
              <span className="text-zinc-600 text-xs">{form.showConditional ? '▲' : '▼'}</span>
            </button>

            {form.showConditional && (
              <div className="px-4 pb-4 space-y-3 border-t border-zinc-800 pt-3">
                <p className="text-xs text-zinc-500">Take an automatic action based on how the contact responds to this question.</p>

                {/* Condition — filter `is_any_of` to multi-choice questions only */}
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-xs text-zinc-500 mb-1">If answer…</label>
                    <select
                      value={form.conditionOp}
                      onChange={e => updateForm('conditionOp', e.target.value)}
                      className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-zinc-500"
                    >
                      <option value="">Select condition</option>
                      {Object.entries(CONDITION_OPS)
                        .filter(([, v]) => !v.multiChoiceOnly || form.answerType === 'choice')
                        .map(([k, v]) => (
                          <option key={k} value={k}>{v.label}</option>
                        ))}
                    </select>
                  </div>
                  {condInfo?.needsValue && (
                    <div>
                      <label className="block text-xs text-zinc-500 mb-1">Value</label>
                      <input
                        type="text"
                        value={form.conditionVal}
                        onChange={e => updateForm('conditionVal', e.target.value)}
                        placeholder="e.g. yes, buy, 500000"
                        className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-zinc-500"
                      />
                    </div>
                  )}
                </div>

                {/* is_any_of — multi-select of the question's configured options */}
                {form.conditionOp === 'is_any_of' && (
                  <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3 space-y-2">
                    <p className="text-xs text-zinc-400">Trigger when the answer is any of these options:</p>
                    {form.choices.length === 0 ? (
                      <p className="text-xs text-zinc-500">Add at least one option above first.</p>
                    ) : (
                      <div className="flex flex-wrap gap-1.5">
                        {form.choices.map(choice => {
                          const on = form.conditionValues.includes(choice)
                          return (
                            <button
                              key={choice}
                              type="button"
                              onClick={() => updateForm(
                                'conditionValues',
                                on
                                  ? form.conditionValues.filter(v => v !== choice)
                                  : [...form.conditionValues, choice],
                              )}
                              className={`text-xs rounded-full px-2.5 py-1 border transition-colors ${
                                on
                                  ? 'border-blue-600 bg-blue-900/30 text-blue-200'
                                  : 'border-zinc-700 bg-zinc-900 text-zinc-400 hover:border-zinc-500'
                              }`}
                            >
                              {choice}
                            </button>
                          )
                        })}
                      </div>
                    )}
                  </div>
                )}

                {/* Action */}
                {form.conditionOp && (
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-xs text-zinc-500 mb-1">Then…</label>
                      <select
                        value={form.actionType}
                        onChange={e => {
                          // Reset action params on action change so stale
                          // config from a different action type doesn't
                          // get saved alongside the new one.
                          updateForm('actionType', e.target.value)
                          updateForm('actionValue', '')
                          updateForm('actionParams', {})
                        }}
                        className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-zinc-500"
                      >
                        <option value="">Select action</option>
                        {Object.entries(ACTION_TYPES).map(([k, v]) => (
                          <option key={k} value={k}>{v.label}</option>
                        ))}
                      </select>
                    </div>
                    {actInfo?.needsValue && (
                      <div>
                        <label className="block text-xs text-zinc-500 mb-1">Value</label>
                        <input
                          type="text"
                          value={form.actionValue}
                          onChange={e => updateForm('actionValue', e.target.value)}
                          placeholder={actInfo.placeholder ?? ''}
                          className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-zinc-500"
                        />
                      </div>
                    )}
                  </div>
                )}

                {/* Action-specific parameter UIs — one per paramKind */}

                {/* Workflows picker */}
                {(actInfo?.paramKind === 'workflows') && (
                  <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3 space-y-2">
                    <p className="text-xs text-zinc-400">Select one or more published workflows:</p>
                    {workflowsError ? (
                      <p className="text-xs text-red-400">{workflowsError}</p>
                    ) : workflows.length === 0 ? (
                      <p className="text-xs text-zinc-500">No published workflows in this location. Publish one in GoHighLevel, then refresh.</p>
                    ) : (
                      <div className="flex flex-wrap gap-1.5">
                        {workflows.map(wf => {
                          const selectedIds: string[] = form.actionParams.workflowIds ?? []
                          const on = selectedIds.includes(wf.id)
                          return (
                            <button
                              key={wf.id}
                              type="button"
                              onClick={() => {
                                const nextIds = on ? selectedIds.filter(x => x !== wf.id) : [...selectedIds, wf.id]
                                const nextNames = workflows.filter(w => nextIds.includes(w.id)).map(w => w.name)
                                updateForm('actionParams', { ...form.actionParams, workflowIds: nextIds, workflowNames: nextNames })
                              }}
                              className={`text-xs rounded-full px-2.5 py-1 border transition-colors ${
                                on
                                  ? 'border-blue-600 bg-blue-900/30 text-blue-200'
                                  : 'border-zinc-700 bg-zinc-900 text-zinc-400 hover:border-zinc-500'
                              }`}
                            >
                              {wf.name}
                            </button>
                          )
                        })}
                      </div>
                    )}
                  </div>
                )}

                {/* Opportunity status */}
                {actInfo?.paramKind === 'opportunity_status' && (
                  <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3 space-y-2">
                    <label className="block text-xs text-zinc-400 mb-1">Mark opportunity as:</label>
                    <select
                      value={form.actionParams.status ?? ''}
                      onChange={e => updateForm('actionParams', { ...form.actionParams, status: e.target.value })}
                      className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-zinc-500"
                    >
                      <option value="">Select status</option>
                      {OPPORTUNITY_STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                    </select>
                    <p className="text-[11px] text-zinc-600">Applies to the contact&apos;s open opportunity. If the contact has multiple, all will be updated.</p>
                  </div>
                )}

                {/* Opportunity value */}
                {actInfo?.paramKind === 'opportunity_value' && (
                  <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3 space-y-2">
                    <label className="block text-xs text-zinc-400 mb-1">Opportunity value:</label>
                    <input
                      type="number"
                      inputMode="decimal"
                      value={form.actionParams.monetaryValue ?? ''}
                      onChange={e => updateForm('actionParams', { ...form.actionParams, monetaryValue: e.target.value === '' ? null : parseFloat(e.target.value) })}
                      placeholder="e.g. 5000"
                      className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-zinc-500"
                    />
                  </div>
                )}

                {/* DND channel */}
                {actInfo?.paramKind === 'dnd_channel' && (
                  <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3 space-y-2">
                    <label className="block text-xs text-zinc-400 mb-1">Block on channel:</label>
                    <select
                      value={form.actionParams.channel ?? ''}
                      onChange={e => updateForm('actionParams', { ...form.actionParams, channel: e.target.value || null })}
                      className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-zinc-500"
                    >
                      {DND_CHANNELS.map(c => <option key={c.value || 'current'} value={c.value}>{c.label}</option>)}
                    </select>
                    <p className="text-[11px] text-zinc-600">&ldquo;Current channel&rdquo; reads the channel the contact messaged on when the rule fires.</p>
                  </div>
                )}

                {/* Preview */}
                {form.conditionOp && form.actionType && (
                  <div className="bg-zinc-900 rounded-lg p-2.5 text-xs text-zinc-400">
                    <span className="text-zinc-500">Preview: </span>
                    If answer {CONDITION_OPS[form.conditionOp]?.label}
                    {condInfo?.needsValue && form.conditionVal ? ` "${form.conditionVal}"` : ''}
                    {form.conditionOp === 'is_any_of' && form.conditionValues.length > 0 ? ` ${form.conditionValues.map(v => `"${v}"`).join(' / ')}` : ''}
                    {' → '}
                    {ACTION_TYPES[form.actionType]?.label}
                    {actInfo?.needsValue && form.actionValue ? ` "${form.actionValue}"` : ''}
                    {actInfo?.paramKind === 'workflows' && form.actionParams.workflowNames?.length ? ` (${(form.actionParams.workflowNames as string[]).join(', ')})` : ''}
                    {actInfo?.paramKind === 'opportunity_status' && form.actionParams.status ? ` → ${form.actionParams.status}` : ''}
                    {actInfo?.paramKind === 'opportunity_value' && form.actionParams.monetaryValue !== undefined && form.actionParams.monetaryValue !== null ? ` → ${form.actionParams.monetaryValue}` : ''}
                    {actInfo?.paramKind === 'dnd_channel' ? ` (${form.actionParams.channel || 'current channel'})` : ''}
                  </div>
                )}
              </div>
            )}
          </div>

          <button
            type="submit"
            disabled={adding}
            className="w-full inline-flex items-center justify-center rounded-lg bg-white text-black font-medium text-sm h-10 hover:bg-zinc-200 transition-colors disabled:opacity-50"
          >
            {adding ? (editingId ? 'Saving…' : 'Adding…') : (editingId ? 'Save Changes' : 'Add Question')}
          </button>
        </form>
      </div>
    </div>
  )
}
