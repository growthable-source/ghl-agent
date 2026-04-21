'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { MergeFieldTextarea } from '@/components/MergeFieldHelper'
import TagCombobox from '@/components/TagCombobox'

/**
 * Decompose a raw second count into {days, hours, minutes, seconds} so the
 * human-friendly duration widget can round-trip. Minutes/seconds fall out
 * of the modulo chain — no precision loss.
 */
function secondsToParts(total: number) {
  const t = Math.max(0, Math.floor(total))
  return {
    days: Math.floor(t / 86400),
    hours: Math.floor((t % 86400) / 3600),
    minutes: Math.floor((t % 3600) / 60),
    seconds: t % 60,
  }
}

function partsToSeconds(p: { days: number; hours: number; minutes: number; seconds: number }) {
  return (
    Math.max(0, p.days) * 86400 +
    Math.max(0, p.hours) * 3600 +
    Math.max(0, p.minutes) * 60 +
    Math.max(0, p.seconds)
  )
}

function formatDuration(total: number): string {
  const { days, hours, minutes, seconds } = secondsToParts(total)
  const parts: string[] = []
  if (days) parts.push(`${days}d`)
  if (hours) parts.push(`${hours}h`)
  if (minutes) parts.push(`${minutes}m`)
  if (seconds || parts.length === 0) parts.push(`${seconds}s`)
  return parts.join(' ')
}

interface AgentTrigger {
  id: string
  eventType: string
  tagFilter: string | null
  channel: string
  messageMode: string
  fixedMessage: string | null
  aiInstructions: string | null
  delaySeconds: number
  isActive: boolean
}

type EventType = 'ContactCreate' | 'ContactTagUpdate'
type MessageMode = 'FIXED' | 'AI_GENERATE'

const EVENT_OPTIONS: { value: EventType; label: string; desc: string }[] = [
  { value: 'ContactCreate', label: 'New contact created', desc: 'Fires when a contact is created — e.g. form submission, import, API call' },
  { value: 'ContactTagUpdate', label: 'Tag added to contact', desc: 'Fires when a specific tag is added to an existing or new contact' },
]

const CHANNEL_OPTIONS = [
  { value: 'SMS', label: 'SMS' },
  { value: 'WhatsApp', label: 'WhatsApp' },
  { value: 'Email', label: 'Email' },
  { value: 'FB', label: 'Facebook' },
  { value: 'IG', label: 'Instagram' },
  { value: 'GMB', label: 'Google Business' },
  { value: 'Live_Chat', label: 'Live Chat' },
]

function triggerSummary(t: AgentTrigger): string {
  let s = t.eventType === 'ContactCreate' ? 'New contact' : `Tag: ${t.tagFilter || 'any'}`
  s += ` → ${t.channel}`
  s += t.messageMode === 'FIXED' ? ' (fixed msg)' : ' (AI generates)'
  return s
}

export default function TriggersPage() {
  const params = useParams()
  const workspaceId = params.workspaceId as string
  const agentId = params.agentId as string

  const [triggers, setTriggers] = useState<AgentTrigger[]>([])
  const [loading, setLoading] = useState(true)
  // locationId is needed for TagCombobox — fetched lazily off the agent
  // record so we don't have to thread it through the URL.
  const [locationId, setLocationId] = useState<string>('')

  // Test-fire state — keyed by triggerId so several panels can be open
  // at once. `contact` is a free-form input: contactId, phone, or email.
  const [testPanel, setTestPanel] = useState<string | null>(null)
  const [testContact, setTestContact] = useState<Record<string, string>>({})
  const [testBusy, setTestBusy] = useState<string | null>(null)
  const [testResult, setTestResult] = useState<Record<string, { ok: boolean; msg: string }>>({})

  // Trigger form — used for both create and edit. editingId holds the
  // trigger being edited (or null if we're creating a new one). showForm
  // reveals the form, editingId decides POST vs PATCH at submit time.
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [eventType, setEventType] = useState<EventType>('ContactCreate')
  const [tagFilter, setTagFilter] = useState('')
  const [channel, setChannel] = useState('SMS')
  const [messageMode, setMessageMode] = useState<MessageMode>('AI_GENERATE')
  const [fixedMessage, setFixedMessage] = useState('')
  const [aiInstructions, setAiInstructions] = useState('')
  const [delaySeconds, setDelaySeconds] = useState(0)
  const [creating, setCreating] = useState(false)

  function resetForm() {
    setShowForm(false)
    setEditingId(null)
    setEventType('ContactCreate')
    setTagFilter('')
    setChannel('SMS')
    setMessageMode('AI_GENERATE')
    setFixedMessage('')
    setAiInstructions('')
    setDelaySeconds(0)
  }

  function startEdit(t: AgentTrigger) {
    setEditingId(t.id)
    setShowForm(true)
    setEventType((t.eventType as EventType) ?? 'ContactCreate')
    setTagFilter(t.tagFilter ?? '')
    setChannel(t.channel ?? 'SMS')
    setMessageMode((t.messageMode as MessageMode) ?? 'AI_GENERATE')
    setFixedMessage(t.fixedMessage ?? '')
    setAiInstructions(t.aiInstructions ?? '')
    setDelaySeconds(t.delaySeconds ?? 0)
    // Scroll the form into view so the context switch is obvious.
    if (typeof window !== 'undefined') {
      requestAnimationFrame(() => window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' }))
    }
  }

  useEffect(() => {
    fetch(`/api/workspaces/${workspaceId}/agents/${agentId}/triggers`)
      .then(r => r.json())
      .then(({ triggers }) => setTriggers(triggers ?? []))
      .finally(() => setLoading(false))
    // Separate call so we can surface tag picker without blocking triggers.
    fetch(`/api/workspaces/${workspaceId}/agents/${agentId}`)
      .then(r => r.json())
      .then(({ agent }) => setLocationId(agent?.locationId || ''))
      .catch(() => {})
  }, [workspaceId, agentId])

  async function toggleActive(t: AgentTrigger) {
    const res = await fetch(`/api/workspaces/${workspaceId}/agents/${agentId}/triggers/${t.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isActive: !t.isActive }),
    })
    const { trigger } = await res.json()
    setTriggers(prev => prev.map(x => x.id === t.id ? trigger : x))
  }

  async function deleteTrigger(id: string) {
    await fetch(`/api/workspaces/${workspaceId}/agents/${agentId}/triggers/${id}`, { method: 'DELETE' })
    setTriggers(prev => prev.filter(x => x.id !== id))
  }

  async function testFire(triggerId: string) {
    const contact = (testContact[triggerId] ?? '').trim()
    if (!contact) return
    setTestBusy(triggerId)
    setTestResult(prev => ({ ...prev, [triggerId]: { ok: false, msg: '' } }))
    try {
      const res = await fetch(
        `/api/workspaces/${workspaceId}/agents/${agentId}/triggers/${triggerId}/test-fire`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ contact }),
        },
      )
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || `Test fire failed (${res.status})`)
      // Summarise: how many fired, how many skipped, and why. A single
      // trigger means fired is 0 or 1, but we still render the full
      // skip-reasons list so operators can see exactly why it didn't go.
      const parts: string[] = []
      if (data.fired > 0) parts.push(`Fired ✓ on contact ${data.contactId}`)
      if (data.skipped > 0) parts.push(`Skipped: ${data.skipReasons.join('; ')}`)
      if (!data.fired && !data.skipped) parts.push('Nothing happened. Check that this trigger is active and its agent is active.')
      setTestResult(prev => ({
        ...prev,
        [triggerId]: { ok: data.fired > 0, msg: parts.join(' · ') },
      }))
    } catch (err: any) {
      setTestResult(prev => ({ ...prev, [triggerId]: { ok: false, msg: err.message || 'Test fire failed' } }))
    } finally {
      setTestBusy(null)
    }
  }

  async function saveTrigger(e: React.FormEvent) {
    e.preventDefault()
    setCreating(true)
    const payload = {
      eventType,
      tagFilter: eventType === 'ContactTagUpdate' ? tagFilter.trim() : null,
      channel,
      messageMode,
      fixedMessage: messageMode === 'FIXED' ? fixedMessage : null,
      aiInstructions: messageMode === 'AI_GENERATE' ? aiInstructions : null,
      delaySeconds,
    }
    const url = editingId
      ? `/api/workspaces/${workspaceId}/agents/${agentId}/triggers/${editingId}`
      : `/api/workspaces/${workspaceId}/agents/${agentId}/triggers`
    const res = await fetch(url, {
      method: editingId ? 'PATCH' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    const { trigger } = await res.json()
    setTriggers(prev => editingId
      ? prev.map(x => x.id === editingId ? trigger : x)
      : [...prev, trigger])
    resetForm()
    setCreating(false)
  }

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <p className="text-zinc-500 text-sm">Loading…</p>
    </div>
  )

  return (
    <div className="p-8">
      <div className="max-w-2xl">
        <p className="text-sm text-zinc-400 mb-6">
          Automatically send the first message when a contact is created or tagged in GoHighLevel — perfect for form submissions, imports, and automations.
        </p>

        {/* Existing triggers */}
        {triggers.length > 0 && (
          <div className="space-y-3 mb-8">
            {triggers.map(t => (
              <div key={t.id} className="rounded-lg border border-zinc-800 p-4">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-3">
                    <p className="text-sm font-medium text-zinc-200">{triggerSummary(t)}</p>
                    <button
                      onClick={() => toggleActive(t)}
                      className={`relative inline-flex h-4 w-8 shrink-0 rounded-full border-2 border-transparent transition-colors ${t.isActive ? 'bg-emerald-500' : 'bg-zinc-700'}`}
                    >
                      <span className={`inline-block h-3 w-3 transform rounded-full bg-white shadow transition ${t.isActive ? 'translate-x-4' : 'translate-x-0'}`} />
                    </button>
                  </div>
                  <div className="flex items-center gap-3">
                    <button
                      onClick={() => startEdit(t)}
                      className="text-xs text-zinc-400 hover:text-white border border-zinc-700 hover:border-zinc-500 rounded px-2 py-1 transition-colors"
                      title="Change the event, tag, channel, message, or delay on this trigger"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => setTestPanel(testPanel === t.id ? null : t.id)}
                      className="text-xs text-zinc-400 hover:text-white border border-zinc-700 hover:border-zinc-500 rounded px-2 py-1 transition-colors"
                      title="Dry-run this trigger against a specific contact — skips the 60s dedupe so you can fire repeatedly while testing"
                    >
                      Test fire
                    </button>
                    <button
                      onClick={() => deleteTrigger(t.id)}
                      className="text-xs text-zinc-600 hover:text-red-400 transition-colors"
                    >
                      Delete
                    </button>
                  </div>
                </div>
                <div className="space-y-1 text-xs text-zinc-500">
                  <div className="flex gap-4">
                    <span>Event: <span className="text-zinc-400">{t.eventType === 'ContactCreate' ? 'New contact' : 'Tag update'}</span></span>
                    {t.tagFilter && <span>Tag: <span className="text-zinc-400">{t.tagFilter}</span></span>}
                    <span>Channel: <span className="text-zinc-400">{t.channel}</span></span>
                    {t.delaySeconds > 0 && <span>Delay: <span className="text-zinc-400">{formatDuration(t.delaySeconds)}</span></span>}
                  </div>
                  {t.messageMode === 'FIXED' && t.fixedMessage && (
                    <p className="text-zinc-600 mt-1 line-clamp-2 pl-2 border-l border-zinc-800">{t.fixedMessage}</p>
                  )}
                  {t.messageMode === 'AI_GENERATE' && (
                    <p className="text-zinc-600 mt-1 pl-2 border-l border-zinc-800">
                      {t.aiInstructions ? t.aiInstructions.slice(0, 120) + (t.aiInstructions.length > 120 ? '…' : '') : 'AI will generate the first message based on agent instructions'}
                    </p>
                  )}
                </div>

                {/* Test-fire panel (inline, collapsible). Runs the real
                    trigger against a real contact — skipping only the 60s
                    per-contact dedupe so repeated tests don't no-op. Real
                    SMS/email will send to that contact. */}
                {testPanel === t.id && (
                  <div className="mt-3 rounded-lg bg-zinc-900/50 border border-zinc-700 p-3 space-y-2">
                    <p className="text-xs text-zinc-400">
                      Fires this trigger against a real contact as a dry-run. The message will actually send — use a test contact you own.
                    </p>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={testContact[t.id] ?? ''}
                        onChange={e => setTestContact(prev => ({ ...prev, [t.id]: e.target.value }))}
                        onKeyDown={e => { if (e.key === 'Enter' && !testBusy) { e.preventDefault(); testFire(t.id) } }}
                        placeholder="Contact ID, phone (E.164), or email"
                        className="flex-1 bg-zinc-950 border border-zinc-700 rounded px-3 py-1.5 text-xs text-white placeholder-zinc-600 focus:outline-none focus:border-zinc-500"
                      />
                      <button
                        type="button"
                        onClick={() => testFire(t.id)}
                        disabled={!!testBusy || !(testContact[t.id] ?? '').trim()}
                        className="text-xs font-medium bg-white text-black rounded px-3 py-1.5 hover:bg-zinc-200 transition-colors disabled:opacity-50"
                      >
                        {testBusy === t.id ? 'Firing…' : 'Fire'}
                      </button>
                    </div>
                    {testResult[t.id]?.msg && (
                      <p className={`text-xs ${testResult[t.id].ok ? 'text-emerald-400' : 'text-amber-300'}`}>
                        {testResult[t.id].msg}
                      </p>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Add trigger button / form */}
        {!showForm ? (
          <button
            onClick={() => { setEditingId(null); setShowForm(true) }}
            className="text-sm text-zinc-400 hover:text-white border border-zinc-700 hover:border-zinc-500 rounded-lg px-4 py-2 transition-colors"
          >
            + New Trigger
          </button>
        ) : (
          <div className="rounded-lg border border-zinc-800 p-5">
            <div className="flex items-center justify-between mb-4">
              <p className="text-sm font-medium text-zinc-300">{editingId ? 'Edit Trigger' : 'New Trigger'}</p>
              <button onClick={resetForm} className="text-xs text-zinc-500 hover:text-zinc-300">Cancel</button>
            </div>
            <form onSubmit={saveTrigger} className="space-y-5">

              {/* Event type */}
              <div>
                <label className="block text-xs font-medium text-zinc-400 mb-2">When should this fire?</label>
                <div className="grid grid-cols-2 gap-2">
                  {EVENT_OPTIONS.map(opt => {
                    const isDanger = opt.value === 'ContactCreate'
                    const isSelected = eventType === opt.value
                    return (
                      <button key={opt.value} type="button" onClick={() => { setEventType(opt.value); setTagFilter('') }}
                        className={`relative flex flex-col gap-0.5 rounded-lg border p-3 text-left transition-colors ${
                          isSelected
                            ? isDanger
                              ? 'border-amber-500/60 bg-amber-500/5'
                              : 'border-white bg-zinc-900'
                            : isDanger
                              ? 'border-amber-500/25 hover:border-amber-500/50'
                              : 'border-zinc-800 hover:border-zinc-600'
                        }`}>
                        <span className="text-xs font-medium text-zinc-200 flex items-center gap-1.5">
                          {isDanger && <span aria-hidden>⚠️</span>}
                          {opt.label}
                        </span>
                        <span className="text-[11px] text-zinc-500 leading-tight">{opt.desc}</span>
                      </button>
                    )
                  })}
                </div>
              </div>

              {/* Danger banner: ContactCreate fires on EVERY new contact
                  created in GHL — no tag, no filter. Operators have lit
                  up their entire pipeline with this. Make it loud. */}
              {eventType === 'ContactCreate' && (
                <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3">
                  <p className="text-xs font-medium text-amber-300 mb-1">⚠️ This fires on every new contact</p>
                  <p className="text-[11px] text-amber-200/80 leading-relaxed">
                    There is no filter — <strong>any</strong> contact created in this GHL location (form submissions, imports, manual adds, API calls, other workflows) will trigger the agent. If you only want to fire for a specific source, use <strong>Tag added to contact</strong> instead and tag leads from your intended source.
                  </p>
                </div>
              )}

              {/* Tag filter (only for ContactTagUpdate) */}
              {eventType === 'ContactTagUpdate' && (
                <div>
                  <label className="block text-xs text-zinc-400 mb-1.5">Tag name to match</label>
                  {locationId ? (
                    <TagCombobox
                      workspaceId={workspaceId}
                      locationId={locationId}
                      value={tagFilter}
                      onChange={setTagFilter}
                      placeholder="e.g. new-lead, form-submitted, hot-prospect"
                    />
                  ) : (
                    // No GHL connection yet — fall back to plain input so the
                    // trigger can still be saved; tags API would 401 anyway.
                    <input
                      type="text"
                      value={tagFilter}
                      onChange={e => setTagFilter(e.target.value)}
                      placeholder="e.g. new-lead, form-submitted, hot-prospect"
                      className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-4 py-2.5 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-zinc-500"
                    />
                  )}
                  <p className="text-[11px] text-zinc-600 mt-1">Leave empty to trigger on any tag addition</p>
                </div>
              )}

              {/* Channel */}
              <div>
                <label className="block text-xs font-medium text-zinc-400 mb-2">Send via</label>
                <div className="flex flex-wrap gap-2">
                  {CHANNEL_OPTIONS.map(ch => (
                    <button key={ch.value} type="button" onClick={() => setChannel(ch.value)}
                      className={`px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors ${
                        channel === ch.value
                          ? 'border-white bg-zinc-900 text-white'
                          : 'border-zinc-800 text-zinc-500 hover:border-zinc-600 hover:text-zinc-300'
                      }`}>
                      {ch.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Message mode */}
              <div>
                <label className="block text-xs font-medium text-zinc-400 mb-2">First message</label>
                <div className="grid grid-cols-2 gap-2">
                  <button type="button" onClick={() => setMessageMode('AI_GENERATE')}
                    className={`flex flex-col gap-0.5 rounded-lg border p-3 text-left transition-colors ${
                      messageMode === 'AI_GENERATE'
                        ? 'border-white bg-zinc-900'
                        : 'border-zinc-800 hover:border-zinc-600'
                    }`}>
                    <span className="text-xs font-medium text-zinc-200">AI generates</span>
                    <span className="text-[11px] text-zinc-500 leading-tight">The agent crafts a personalized message based on context</span>
                  </button>
                  <button type="button" onClick={() => setMessageMode('FIXED')}
                    className={`flex flex-col gap-0.5 rounded-lg border p-3 text-left transition-colors ${
                      messageMode === 'FIXED'
                        ? 'border-white bg-zinc-900'
                        : 'border-zinc-800 hover:border-zinc-600'
                    }`}>
                    <span className="text-xs font-medium text-zinc-200">Fixed message</span>
                    <span className="text-[11px] text-zinc-500 leading-tight">Send the same static message every time</span>
                  </button>
                </div>
              </div>

              {/* Fixed message textarea */}
              {messageMode === 'FIXED' && (
                <div>
                  <label className="block text-xs text-zinc-400 mb-1.5">Message to send</label>
                  <MergeFieldTextarea
                    value={fixedMessage}
                    onChange={e => setFixedMessage(e.target.value)}
                    onValueChange={setFixedMessage}
                    placeholder="Hi {{contact.first_name|there}}! Thanks for reaching out."
                    required
                    rows={3}
                    className="w-full bg-zinc-900 border border-zinc-700 rounded-lg pl-3 pr-3 pt-8 pb-2 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-zinc-500 resize-none"
                  />
                </div>
              )}

              {/* AI instructions textarea */}
              {messageMode === 'AI_GENERATE' && (
                <div>
                  <label className="block text-xs text-zinc-400 mb-1.5">Instructions for the AI (optional)</label>
                  <textarea
                    value={aiInstructions}
                    onChange={e => setAiInstructions(e.target.value)}
                    placeholder="Greet the new lead warmly, mention that you saw they filled out the form, and ask what they're looking for."
                    rows={3}
                    className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-zinc-500 resize-none"
                  />
                  <p className="text-[11px] text-zinc-600 mt-1">If left empty, the agent uses its default system prompt and persona to generate the message.</p>
                </div>
              )}

              {/* Delay — serialized as seconds under the hood, but the form
                  exposes d / h / m / s inputs so humans don't have to do
                  mental math for "wait 2 days before pinging". */}
              <div>
                <label className="block text-xs text-zinc-400 mb-1.5">Delay before sending</label>
                {(() => {
                  const parts = secondsToParts(delaySeconds)
                  const setPart = (key: 'days' | 'hours' | 'minutes' | 'seconds', v: number) => {
                    setDelaySeconds(partsToSeconds({ ...parts, [key]: v }))
                  }
                  const field = (label: string, val: number, onChange: (n: number) => void, max?: number) => (
                    <div className="flex flex-col items-center">
                      <input
                        type="number"
                        min={0}
                        max={max}
                        value={val}
                        onChange={e => onChange(Math.max(0, Number(e.target.value) || 0))}
                        className="w-16 bg-zinc-900 border border-zinc-700 rounded-lg px-2 py-2 text-sm text-white text-center focus:outline-none focus:border-zinc-500 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                      />
                      <span className="text-[10px] text-zinc-500 mt-1 uppercase tracking-wide">{label}</span>
                    </div>
                  )
                  return (
                    <div className="flex items-start gap-2">
                      {field('Days', parts.days, v => setPart('days', v))}
                      {field('Hours', parts.hours, v => setPart('hours', v), 23)}
                      {field('Minutes', parts.minutes, v => setPart('minutes', v), 59)}
                      {field('Seconds', parts.seconds, v => setPart('seconds', v), 59)}
                    </div>
                  )
                })()}
                <p className="text-[11px] text-zinc-600 mt-2">
                  {delaySeconds === 0 ? 'Sends immediately.' : `Waits ${formatDuration(delaySeconds)} after the event before sending.`}
                </p>
              </div>

              {/* Submit */}
              <div className="flex items-center gap-3 pt-1">
                <button
                  type="submit"
                  disabled={creating || (messageMode === 'FIXED' && !fixedMessage.trim())}
                  className="inline-flex items-center justify-center rounded-lg bg-white text-black font-medium text-sm h-9 px-4 hover:bg-zinc-200 transition-colors disabled:opacity-50"
                >
                  {creating
                    ? (editingId ? 'Saving…' : 'Creating…')
                    : (editingId ? 'Save Changes' : 'Create Trigger')}
                </button>
              </div>
            </form>
          </div>
        )}

        {/* Info box */}
        <div className="mt-8 rounded-lg bg-zinc-900/50 border border-zinc-800 p-4">
          <p className="text-xs text-zinc-500 leading-relaxed">
            <strong className="text-zinc-400">How triggers work:</strong> When GoHighLevel fires a ContactCreate or ContactTagUpdate webhook event, the agent automatically sends the first message to the contact on the selected channel. The contact's reply (if any) continues through normal agent routing. Make sure the webhook events are enabled in your GHL Marketplace app settings.
          </p>
        </div>
      </div>
    </div>
  )
}
