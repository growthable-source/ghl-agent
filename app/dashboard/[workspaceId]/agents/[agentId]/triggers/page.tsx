'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'

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

  // New trigger form
  const [showForm, setShowForm] = useState(false)
  const [eventType, setEventType] = useState<EventType>('ContactCreate')
  const [tagFilter, setTagFilter] = useState('')
  const [channel, setChannel] = useState('SMS')
  const [messageMode, setMessageMode] = useState<MessageMode>('AI_GENERATE')
  const [fixedMessage, setFixedMessage] = useState('')
  const [aiInstructions, setAiInstructions] = useState('')
  const [delaySeconds, setDelaySeconds] = useState(0)
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    fetch(`/api/workspaces/${workspaceId}/agents/${agentId}/triggers`)
      .then(r => r.json())
      .then(({ triggers }) => setTriggers(triggers ?? []))
      .finally(() => setLoading(false))
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

  async function createTrigger(e: React.FormEvent) {
    e.preventDefault()
    setCreating(true)
    const res = await fetch(`/api/workspaces/${workspaceId}/agents/${agentId}/triggers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        eventType,
        tagFilter: eventType === 'ContactTagUpdate' ? tagFilter.trim() : null,
        channel,
        messageMode,
        fixedMessage: messageMode === 'FIXED' ? fixedMessage : null,
        aiInstructions: messageMode === 'AI_GENERATE' ? aiInstructions : null,
        delaySeconds,
      }),
    })
    const { trigger } = await res.json()
    setTriggers(prev => [...prev, trigger])
    // Reset form
    setShowForm(false)
    setEventType('ContactCreate')
    setTagFilter('')
    setChannel('SMS')
    setMessageMode('AI_GENERATE')
    setFixedMessage('')
    setAiInstructions('')
    setDelaySeconds(0)
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
                  <button
                    onClick={() => deleteTrigger(t.id)}
                    className="text-xs text-zinc-600 hover:text-red-400 transition-colors"
                  >
                    Delete
                  </button>
                </div>
                <div className="space-y-1 text-xs text-zinc-500">
                  <div className="flex gap-4">
                    <span>Event: <span className="text-zinc-400">{t.eventType === 'ContactCreate' ? 'New contact' : 'Tag update'}</span></span>
                    {t.tagFilter && <span>Tag: <span className="text-zinc-400">{t.tagFilter}</span></span>}
                    <span>Channel: <span className="text-zinc-400">{t.channel}</span></span>
                    {t.delaySeconds > 0 && <span>Delay: <span className="text-zinc-400">{t.delaySeconds}s</span></span>}
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
              </div>
            ))}
          </div>
        )}

        {/* Add trigger button / form */}
        {!showForm ? (
          <button
            onClick={() => setShowForm(true)}
            className="text-sm text-zinc-400 hover:text-white border border-zinc-700 hover:border-zinc-500 rounded-lg px-4 py-2 transition-colors"
          >
            + New Trigger
          </button>
        ) : (
          <div className="rounded-lg border border-zinc-800 p-5">
            <div className="flex items-center justify-between mb-4">
              <p className="text-sm font-medium text-zinc-300">New Trigger</p>
              <button onClick={() => setShowForm(false)} className="text-xs text-zinc-500 hover:text-zinc-300">Cancel</button>
            </div>
            <form onSubmit={createTrigger} className="space-y-5">

              {/* Event type */}
              <div>
                <label className="block text-xs font-medium text-zinc-400 mb-2">When should this fire?</label>
                <div className="grid grid-cols-2 gap-2">
                  {EVENT_OPTIONS.map(opt => (
                    <button key={opt.value} type="button" onClick={() => { setEventType(opt.value); setTagFilter('') }}
                      className={`flex flex-col gap-0.5 rounded-lg border p-3 text-left transition-colors ${
                        eventType === opt.value
                          ? 'border-white bg-zinc-900'
                          : 'border-zinc-800 hover:border-zinc-600'
                      }`}>
                      <span className="text-xs font-medium text-zinc-200">{opt.label}</span>
                      <span className="text-[11px] text-zinc-500 leading-tight">{opt.desc}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Tag filter (only for ContactTagUpdate) */}
              {eventType === 'ContactTagUpdate' && (
                <div>
                  <label className="block text-xs text-zinc-400 mb-1.5">Tag name to match</label>
                  <input
                    type="text"
                    value={tagFilter}
                    onChange={e => setTagFilter(e.target.value)}
                    placeholder="e.g. new-lead, form-submitted, hot-prospect"
                    className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-4 py-2.5 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-zinc-500"
                  />
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
                  <textarea
                    value={fixedMessage}
                    onChange={e => setFixedMessage(e.target.value)}
                    placeholder="Hi! Thanks for reaching out. How can I help you today?"
                    required
                    rows={3}
                    className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-zinc-500 resize-none"
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

              {/* Delay */}
              <div>
                <label className="block text-xs text-zinc-400 mb-1.5">Delay before sending</label>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min={0}
                    value={delaySeconds}
                    onChange={e => setDelaySeconds(Number(e.target.value))}
                    className="w-24 bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-zinc-500"
                  />
                  <span className="text-xs text-zinc-500">seconds (0 = immediate)</span>
                </div>
              </div>

              {/* Submit */}
              <div className="flex items-center gap-3 pt-1">
                <button
                  type="submit"
                  disabled={creating || (messageMode === 'FIXED' && !fixedMessage.trim())}
                  className="inline-flex items-center justify-center rounded-lg bg-white text-black font-medium text-sm h-9 px-4 hover:bg-zinc-200 transition-colors disabled:opacity-50"
                >
                  {creating ? 'Creating…' : 'Create Trigger'}
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
