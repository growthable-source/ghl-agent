'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { MergeFieldTextarea } from '@/components/MergeFieldHelper'

interface FollowUpStep {
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
  steps: Array<FollowUpStep & { id: string }>
}

type TriggerType = 'no_reply' | 'keyword' | 'agent' | 'always'

const TRIGGER_OPTIONS: { value: TriggerType; label: string; desc: string; needsValue: boolean; placeholder?: string }[] = [
  { value: 'no_reply', label: 'No reply', desc: 'Contact goes silent — follow up after their last message', needsValue: false },
  { value: 'keyword', label: 'Keyword detected', desc: 'Contact says something that triggers the sequence', needsValue: true, placeholder: 'follow up, call me back, later, not now' },
  { value: 'agent', label: 'Agent decides', desc: 'The AI triggers this sequence via tool call when appropriate', needsValue: false },
  { value: 'always', label: 'After every exchange', desc: 'Starts after each message (original behavior)', needsValue: false },
]

function triggerLabel(type: string, value: string | null): string {
  const opt = TRIGGER_OPTIONS.find(o => o.value === type)
  if (!opt) return type
  if (type === 'keyword' && value) return `Keyword: ${value}`
  return opt.label
}

export default function FollowUpsPage() {
  const params = useParams()
  const workspaceId = params.workspaceId as string
  const agentId = params.agentId as string

  const [sequences, setSequences] = useState<FollowUpSequence[]>([])
  const [loading, setLoading] = useState(true)

  // New sequence form
  const [newName, setNewName] = useState('')
  const [newTriggerType, setNewTriggerType] = useState<TriggerType>('no_reply')
  const [newTriggerValue, setNewTriggerValue] = useState('')
  const [newSteps, setNewSteps] = useState<FollowUpStep[]>([{ stepNumber: 1, delayHours: 24, message: '' }])
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    fetch(`/api/workspaces/${workspaceId}/agents/${agentId}/follow-up-sequences`)
      .then(r => r.json())
      .then(({ sequences }) => setSequences(sequences ?? []))
      .finally(() => setLoading(false))
  }, [workspaceId, agentId])

  async function toggleActive(seq: FollowUpSequence) {
    const res = await fetch(`/api/workspaces/${workspaceId}/agents/${agentId}/follow-up-sequences/${seq.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isActive: !seq.isActive }),
    })
    const { sequence } = await res.json()
    setSequences(prev => prev.map(s => s.id === seq.id ? sequence : s))
  }

  async function deleteSequence(id: string) {
    await fetch(`/api/workspaces/${workspaceId}/agents/${agentId}/follow-up-sequences/${id}`, { method: 'DELETE' })
    setSequences(prev => prev.filter(s => s.id !== id))
  }

  async function createSequence(e: React.FormEvent) {
    e.preventDefault()
    if (!newName.trim()) return
    setCreating(true)
    const triggerOpt = TRIGGER_OPTIONS.find(o => o.value === newTriggerType)
    const res = await fetch(`/api/workspaces/${workspaceId}/agents/${agentId}/follow-up-sequences`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: newName,
        triggerType: newTriggerType,
        triggerValue: triggerOpt?.needsValue ? newTriggerValue : null,
        steps: newSteps,
      }),
    })
    const { sequence } = await res.json()
    setSequences(prev => [...prev, sequence])
    setNewName('')
    setNewTriggerType('no_reply')
    setNewTriggerValue('')
    setNewSteps([{ stepNumber: 1, delayHours: 24, message: '' }])
    setCreating(false)
  }

  function addStep() {
    setNewSteps(prev => [...prev, { stepNumber: prev.length + 1, delayHours: 24, message: '' }])
  }

  function updateStep(idx: number, field: keyof FollowUpStep, value: string | number) {
    setNewSteps(prev => prev.map((s, i) => i === idx ? { ...s, [field]: value } : s))
  }

  function removeStep(idx: number) {
    setNewSteps(prev => prev.filter((_, i) => i !== idx).map((s, i) => ({ ...s, stepNumber: i + 1 })))
  }

  const selectedTrigger = TRIGGER_OPTIONS.find(o => o.value === newTriggerType)

  // Theme-aware shells used throughout the page so we don't depend on
  // legacy zinc/orange overrides.
  const fieldStyle: React.CSSProperties = {
    background: 'var(--input-bg)',
    color: 'var(--input-text)',
    border: '1px solid var(--input-border)',
  }
  const cardStyle: React.CSSProperties = {
    background: 'var(--surface)',
    border: '1px solid var(--border)',
  }
  const infoBoxStyle: React.CSSProperties = {
    background: 'var(--surface-secondary)',
    border: '1px solid var(--border)',
  }

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>Loading…</p>
    </div>
  )

  return (
    <div className="p-8">
      <div className="max-w-2xl">
        <p className="text-sm mb-6" style={{ color: 'var(--text-secondary)' }}>
          Automatic messages triggered by rules you define — when a contact goes quiet, says a keyword, or when the agent decides it&apos;s time.
        </p>

        {/* Existing sequences */}
        {sequences.length > 0 && (
          <div className="space-y-4 mb-8">
            {sequences.map(seq => (
              <div key={seq.id} className="rounded-xl p-4" style={cardStyle}>
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{seq.name}</p>
                    <span
                      className="text-xs px-1.5 py-0.5 rounded"
                      style={{ background: 'var(--surface-tertiary)', color: 'var(--text-tertiary)' }}
                    >
                      {triggerLabel(seq.triggerType, seq.triggerValue)}
                    </span>
                    <button
                      onClick={() => toggleActive(seq)}
                      className="relative inline-flex h-4 w-8 shrink-0 rounded-full transition-colors"
                      style={{ background: seq.isActive ? 'var(--accent-emerald)' : 'var(--surface-tertiary)' }}
                    >
                      <span className={`inline-block h-3 w-3 transform rounded-full shadow transition ${seq.isActive ? 'translate-x-4' : 'translate-x-0.5'}`} style={{ background: '#fff' }} />
                    </button>
                  </div>
                  <button
                    onClick={() => deleteSequence(seq.id)}
                    className="text-xs transition-colors"
                    style={{ color: 'var(--text-tertiary)' }}
                  >
                    Delete
                  </button>
                </div>
                <div className="space-y-2">
                  {seq.steps.map(step => (
                    <div
                      key={step.id}
                      className="flex items-start gap-3 text-xs pl-2 border-l"
                      style={{ color: 'var(--text-tertiary)', borderColor: 'var(--border)' }}
                    >
                      <span className="shrink-0 font-medium" style={{ color: 'var(--text-secondary)' }}>Step {step.stepNumber}</span>
                      <span className="shrink-0">after {step.delayHours}h</span>
                      <span className="line-clamp-1" style={{ color: 'var(--text-muted)' }}>{step.message}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Create new sequence */}
        <div className="rounded-xl p-4" style={cardStyle}>
          <p className="text-sm font-medium mb-4" style={{ color: 'var(--text-primary)' }}>New Sequence</p>
          <form onSubmit={createSequence} className="space-y-4">
            <input
              type="text"
              value={newName}
              onChange={e => setNewName(e.target.value)}
              placeholder="Sequence name"
              required
              className="w-full rounded-lg px-4 py-2.5 text-sm focus:outline-none"
              style={fieldStyle}
            />

            {/* Trigger selection */}
            <div>
              <label className="block text-xs font-medium mb-2" style={{ color: 'var(--text-secondary)' }}>When should this trigger?</label>
              <div className="grid grid-cols-2 gap-2">
                {TRIGGER_OPTIONS.map(opt => {
                  const selected = newTriggerType === opt.value
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => { setNewTriggerType(opt.value); setNewTriggerValue('') }}
                      className="flex flex-col gap-0.5 rounded-lg border p-3 text-left transition-colors"
                      style={
                        selected
                          ? { background: 'var(--accent-primary-bg)', borderColor: 'var(--accent-primary)' }
                          : { background: 'var(--surface)', borderColor: 'var(--border)' }
                      }
                    >
                      <span className="text-xs font-medium" style={{ color: 'var(--text-primary)' }}>{opt.label}</span>
                      <span className="text-[11px] leading-tight" style={{ color: 'var(--text-tertiary)' }}>{opt.desc}</span>
                    </button>
                  )
                })}
              </div>
            </div>

            {selectedTrigger?.needsValue && (
              <div>
                <label className="block text-xs mb-1.5" style={{ color: 'var(--text-tertiary)' }}>Keywords (comma separated)</label>
                <input
                  type="text"
                  value={newTriggerValue}
                  onChange={e => setNewTriggerValue(e.target.value)}
                  placeholder={selectedTrigger.placeholder}
                  className="w-full rounded-lg px-4 py-2.5 text-sm focus:outline-none"
                  style={fieldStyle}
                />
              </div>
            )}

            {newTriggerType === 'agent' && (
              <div className="rounded-lg p-3" style={infoBoxStyle}>
                <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                  The agent will use the <code className="px-1 py-0.5 rounded font-mono" style={{ background: 'var(--surface-tertiary)', color: 'var(--text-primary)' }}>schedule_followup</code> tool to trigger this sequence when it detects the right moment — e.g. when a contact says &ldquo;follow up with me next week.&rdquo;
                </p>
              </div>
            )}

            {newTriggerType === 'no_reply' && (
              <div className="rounded-lg p-3" style={infoBoxStyle}>
                <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                  The first step&apos;s delay is used as the silence window. If the contact replies before the timer expires, the follow-up is automatically cancelled.
                </p>
              </div>
            )}

            {/* Steps */}
            <div>
              <label className="block text-xs font-medium mb-2" style={{ color: 'var(--text-secondary)' }}>Steps</label>
              <div className="space-y-3">
                {newSteps.map((step, idx) => (
                  <div
                    key={idx}
                    className="rounded-lg border p-3 space-y-2"
                    style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>Step {step.stepNumber}</span>
                      {newSteps.length > 1 && (
                        <button
                          type="button"
                          onClick={() => removeStep(idx)}
                          className="text-xs transition-colors"
                          style={{ color: 'var(--text-tertiary)' }}
                        >
                          Remove
                        </button>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <label className="text-xs shrink-0" style={{ color: 'var(--text-tertiary)' }}>
                        {idx === 0 && newTriggerType === 'no_reply' ? 'Wait for silence' : 'Send after'}
                      </label>
                      <input
                        type="number"
                        min={1}
                        value={step.delayHours}
                        onChange={e => updateStep(idx, 'delayHours', Number(e.target.value))}
                        className="w-20 rounded px-2 py-1 text-sm focus:outline-none"
                        style={fieldStyle}
                      />
                      <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>hours</span>
                    </div>
                    <MergeFieldTextarea
                      value={step.message}
                      onChange={e => updateStep(idx, 'message', e.target.value)}
                      onValueChange={v => updateStep(idx, 'message', v)}
                      placeholder="Message to send… (try {{contact.first_name|there}})"
                      required
                      rows={2}
                      className="w-full rounded-lg pl-3 pr-3 pt-8 pb-2 text-sm focus:outline-none resize-none"
                      style={fieldStyle}
                    />
                  </div>
                ))}
              </div>
            </div>

            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={addStep}
                className="text-sm border rounded-lg px-3 py-1.5 transition-colors"
                style={{ color: 'var(--text-secondary)', borderColor: 'var(--border)' }}
              >
                + Add Step
              </button>
              <button
                type="submit"
                disabled={creating || !newName.trim() || newSteps.some(s => !s.message.trim())}
                className="inline-flex items-center justify-center rounded-lg font-medium text-sm h-9 px-4 transition-colors disabled:cursor-not-allowed"
                style={
                  creating || !newName.trim() || newSteps.some(s => !s.message.trim())
                    ? { background: 'var(--surface-tertiary)', color: 'var(--text-tertiary)' }
                    : { background: 'var(--accent-primary)', color: 'var(--btn-primary-text)' }
                }
              >
                {creating ? 'Creating…' : 'Create Sequence'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}
