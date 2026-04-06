'use client'

import { useState } from 'react'
import { useRouter, useParams } from 'next/navigation'
import Link from 'next/link'

type Step = 'crm' | 'calendar' | 'voice' | 'build'

const STEPS: { key: Step; label: string }[] = [
  { key: 'crm', label: 'CRM' },
  { key: 'calendar', label: 'Calendar' },
  { key: 'voice', label: 'Voice' },
  { key: 'build', label: 'Build' },
]

const CRM_OPTIONS = [
  { id: 'ghl', name: 'GoHighLevel', desc: 'Already connected via OAuth', icon: '🔗', connected: true },
  { id: 'hubspot', name: 'HubSpot', desc: 'Connect via OAuth', icon: '🟠', connected: false },
  { id: 'none', name: 'No CRM', desc: 'Skip for now — you can connect later', icon: '⏭️', connected: false },
]

const CALENDAR_OPTIONS = [
  { id: 'ghl', name: 'GHL Calendar', desc: 'Use your GoHighLevel calendar', icon: '📅' },
  { id: 'calendly', name: 'Calendly', desc: 'Connect your Calendly account', icon: '📆' },
  { id: 'calcom', name: 'Cal.com', desc: 'Connect your Cal.com account', icon: '🗓️' },
  { id: 'none', name: 'No Calendar', desc: 'Skip — agent won\'t book appointments', icon: '⏭️' },
]

const VOICE_OPTIONS = [
  { id: 'enabled', name: 'Enable Voice', desc: 'Handle inbound phone calls with AI', icon: '🎙️' },
  { id: 'disabled', name: 'SMS Only', desc: 'Text-based agent, no phone calls', icon: '💬' },
]

export default function NewAgentWizard() {
  const router = useRouter()
  const params = useParams()
  const locationId = params.locationId as string

  const [step, setStep] = useState<Step>('crm')
  const [selectedCrm, setSelectedCrm] = useState<string>('ghl')
  const [selectedCalendar, setSelectedCalendar] = useState<string>('ghl')
  const [selectedVoice, setSelectedVoice] = useState<string>('enabled')

  // Build step
  const [name, setName] = useState('')
  const [systemPrompt, setSystemPrompt] = useState('')
  const [instructions, setInstructions] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // Integration connection states
  const [connectingHubspot, setConnectingHubspot] = useState(false)
  const [connectingCalendly, setConnectingCalendly] = useState(false)
  const [connectingCalcom, setConnectingCalcom] = useState(false)

  const currentIdx = STEPS.findIndex(s => s.key === step)

  function next() {
    const nextIdx = currentIdx + 1
    if (nextIdx < STEPS.length) setStep(STEPS[nextIdx].key)
  }

  function back() {
    const prevIdx = currentIdx - 1
    if (prevIdx >= 0) setStep(STEPS[prevIdx].key)
  }

  function handleCrmSelect(id: string) {
    setSelectedCrm(id)
    if (id === 'hubspot') {
      // Redirect to HubSpot OAuth
      window.open(`/api/auth/hubspot?locationId=${locationId}`, '_blank')
    }
  }

  function handleCalendarSelect(id: string) {
    setSelectedCalendar(id)
  }

  async function handleCreate() {
    if (!name.trim() || !systemPrompt.trim()) return
    setSaving(true)
    setError('')

    try {
      const res = await fetch(`/api/locations/${locationId}/agents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          systemPrompt,
          instructions,
          crmProvider: selectedCrm,
          calendarProvider: selectedCalendar,
          voiceEnabled: selectedVoice === 'enabled',
        }),
      })
      if (!res.ok) throw new Error('Failed to create agent')
      const { agent } = await res.json()

      // If voice is enabled, redirect to voice config. Otherwise go to agent page.
      if (selectedVoice === 'enabled') {
        router.push(`/dashboard/${locationId}/agents/${agent.id}/voice`)
      } else {
        router.push(`/dashboard/${locationId}/agents/${agent.id}`)
      }
    } catch {
      setError('Something went wrong. Please try again.')
      setSaving(false)
    }
  }

  return (
    <div className="p-8">
      <div className="max-w-2xl mx-auto">
        {/* Progress bar */}
        <div className="flex items-center gap-1 mb-8">
          {STEPS.map((s, i) => (
            <div key={s.key} className="flex items-center flex-1">
              <div className="flex items-center gap-2 flex-1">
                <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-medium transition-colors ${
                  i < currentIdx ? 'bg-emerald-500 text-white' :
                  i === currentIdx ? 'bg-white text-black' :
                  'bg-zinc-800 text-zinc-500'
                }`}>
                  {i < currentIdx ? '✓' : i + 1}
                </div>
                <span className={`text-xs font-medium hidden sm:block ${
                  i <= currentIdx ? 'text-zinc-200' : 'text-zinc-600'
                }`}>{s.label}</span>
              </div>
              {i < STEPS.length - 1 && (
                <div className={`h-px flex-1 mx-2 ${i < currentIdx ? 'bg-emerald-500' : 'bg-zinc-800'}`} />
              )}
            </div>
          ))}
        </div>

        {/* Step: CRM */}
        {step === 'crm' && (
          <div>
            <h1 className="text-2xl font-semibold mb-2">Connect your CRM</h1>
            <p className="text-zinc-400 text-sm mb-6">Your agent will read contacts, update tags, and manage pipelines through your CRM.</p>
            <div className="space-y-3">
              {CRM_OPTIONS.map(opt => (
                <button key={opt.id} type="button"
                  onClick={() => handleCrmSelect(opt.id)}
                  className={`w-full flex items-center gap-4 rounded-xl border p-4 text-left transition-colors ${
                    selectedCrm === opt.id
                      ? 'border-white bg-zinc-900'
                      : 'border-zinc-800 bg-zinc-950 hover:border-zinc-600'
                  }`}>
                  <span className="text-2xl">{opt.icon}</span>
                  <div className="flex-1">
                    <p className="text-sm font-medium text-zinc-200">{opt.name}</p>
                    <p className="text-xs text-zinc-500">{opt.desc}</p>
                  </div>
                  {selectedCrm === opt.id && (
                    <span className="w-5 h-5 rounded-full bg-white flex items-center justify-center">
                      <span className="w-2 h-2 rounded-full bg-black" />
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Step: Calendar */}
        {step === 'calendar' && (
          <div>
            <h1 className="text-2xl font-semibold mb-2">Connect a calendar</h1>
            <p className="text-zinc-400 text-sm mb-6">Your agent will check availability and book appointments for leads.</p>
            <div className="space-y-3">
              {CALENDAR_OPTIONS.map(opt => (
                <button key={opt.id} type="button"
                  onClick={() => handleCalendarSelect(opt.id)}
                  className={`w-full flex items-center gap-4 rounded-xl border p-4 text-left transition-colors ${
                    selectedCalendar === opt.id
                      ? 'border-white bg-zinc-900'
                      : 'border-zinc-800 bg-zinc-950 hover:border-zinc-600'
                  }`}>
                  <span className="text-2xl">{opt.icon}</span>
                  <div className="flex-1">
                    <p className="text-sm font-medium text-zinc-200">{opt.name}</p>
                    <p className="text-xs text-zinc-500">{opt.desc}</p>
                  </div>
                  {selectedCalendar === opt.id && (
                    <span className="w-5 h-5 rounded-full bg-white flex items-center justify-center">
                      <span className="w-2 h-2 rounded-full bg-black" />
                    </span>
                  )}
                </button>
              ))}
              {selectedCalendar === 'calendly' && (
                <div className="rounded-lg border border-zinc-700 bg-zinc-900 p-3 space-y-2">
                  <p className="text-xs text-zinc-400">Enter your Calendly Personal Access Token to connect.</p>
                  <div className="flex gap-2">
                    <input type="password" placeholder="Calendly API token"
                      className="flex-1 bg-zinc-800 border border-zinc-600 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-zinc-400" />
                    <button type="button"
                      className="px-4 py-2 rounded-lg bg-white text-black text-sm font-medium hover:bg-zinc-200 transition-colors disabled:opacity-50">
                      Connect
                    </button>
                  </div>
                </div>
              )}
              {selectedCalendar === 'calcom' && (
                <div className="rounded-lg border border-zinc-700 bg-zinc-900 p-3 space-y-2">
                  <p className="text-xs text-zinc-400">Enter your Cal.com API key to connect.</p>
                  <div className="flex gap-2">
                    <input type="password" placeholder="Cal.com API key"
                      className="flex-1 bg-zinc-800 border border-zinc-600 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-zinc-400" />
                    <button type="button"
                      className="px-4 py-2 rounded-lg bg-white text-black text-sm font-medium hover:bg-zinc-200 transition-colors disabled:opacity-50">
                      Connect
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Step: Voice */}
        {step === 'voice' && (
          <div>
            <h1 className="text-2xl font-semibold mb-2">Voice calls</h1>
            <p className="text-zinc-400 text-sm mb-6">Do you want this agent to handle inbound phone calls? You can always enable this later.</p>
            <div className="space-y-3">
              {VOICE_OPTIONS.map(opt => (
                <button key={opt.id} type="button"
                  onClick={() => setSelectedVoice(opt.id)}
                  className={`w-full flex items-center gap-4 rounded-xl border p-4 text-left transition-colors ${
                    selectedVoice === opt.id
                      ? 'border-white bg-zinc-900'
                      : 'border-zinc-800 bg-zinc-950 hover:border-zinc-600'
                  }`}>
                  <span className="text-2xl">{opt.icon}</span>
                  <div className="flex-1">
                    <p className="text-sm font-medium text-zinc-200">{opt.name}</p>
                    <p className="text-xs text-zinc-500">{opt.desc}</p>
                  </div>
                  {selectedVoice === opt.id && (
                    <span className="w-5 h-5 rounded-full bg-white flex items-center justify-center">
                      <span className="w-2 h-2 rounded-full bg-black" />
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Step: Build */}
        {step === 'build' && (
          <div>
            <h1 className="text-2xl font-semibold mb-2">Build your agent</h1>
            <p className="text-zinc-400 text-sm mb-6">
              Give your agent a name and personality. You selected: {selectedCrm !== 'none' ? selectedCrm.toUpperCase() : 'No CRM'} + {selectedCalendar !== 'none' ? selectedCalendar : 'No Calendar'} + {selectedVoice === 'enabled' ? 'Voice' : 'SMS only'}
            </p>
            <div className="space-y-5">
              <div>
                <label className="block text-sm font-medium text-zinc-300 mb-2">Agent Name</label>
                <input type="text" value={name} onChange={e => setName(e.target.value)}
                  placeholder="e.g. Sales Assistant"
                  className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-4 py-2.5 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-zinc-500" />
              </div>
              <div>
                <label className="block text-sm font-medium text-zinc-300 mb-2">System Prompt</label>
                <p className="text-xs text-zinc-500 mb-2">The core identity and role of the agent.</p>
                <textarea value={systemPrompt} onChange={e => setSystemPrompt(e.target.value)}
                  placeholder="You are a helpful sales assistant for Acme Corp. You respond to inbound SMS leads..."
                  rows={6}
                  className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-4 py-2.5 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-zinc-500 resize-y" />
              </div>
              <div>
                <label className="block text-sm font-medium text-zinc-300 mb-2">
                  Additional Instructions <span className="text-zinc-600">(optional)</span>
                </label>
                <textarea value={instructions} onChange={e => setInstructions(e.target.value)}
                  placeholder="- Always greet the contact by first name&#10;- If they ask about pricing, send them to the booking link"
                  rows={4}
                  className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-4 py-2.5 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-zinc-500 resize-y" />
              </div>
              {error && <p className="text-red-400 text-sm">{error}</p>}
            </div>
          </div>
        )}

        {/* Navigation buttons */}
        <div className="flex items-center justify-between mt-8 pt-6 border-t border-zinc-800">
          <div>
            {currentIdx > 0 ? (
              <button type="button" onClick={back}
                className="text-sm text-zinc-400 hover:text-white transition-colors flex items-center gap-1">
                &larr; Back
              </button>
            ) : (
              <Link href={`/dashboard/${locationId}`} className="text-sm text-zinc-500 hover:text-white transition-colors">
                Cancel
              </Link>
            )}
          </div>
          <div>
            {step !== 'build' ? (
              <button type="button" onClick={next}
                className="bg-white text-black font-medium text-sm h-10 px-6 rounded-lg hover:bg-zinc-200 transition-colors inline-flex items-center justify-center">
                Continue &rarr;
              </button>
            ) : (
              <button type="button" onClick={handleCreate} disabled={saving || !name.trim() || !systemPrompt.trim()}
                className="bg-white text-black font-medium text-sm h-10 px-6 rounded-lg hover:bg-zinc-200 transition-colors disabled:opacity-50 inline-flex items-center justify-center">
                {saving ? 'Creating…' : 'Create Agent'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
