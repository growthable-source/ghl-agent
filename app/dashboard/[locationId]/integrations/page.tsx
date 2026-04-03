'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'

interface Integration {
  id: string
  type: string
  name: string
  isActive: boolean
  createdAt: string
}

export default function IntegrationsPage() {
  const params = useParams()
  const locationId = params.locationId as string

  const [integrations, setIntegrations] = useState<Integration[]>([])
  const [ghlConnected, setGhlConnected] = useState(false)
  const [vapiActive, setVapiActive] = useState(false)
  const [loading, setLoading] = useState(true)

  // Twilio form
  const [showTwilioForm, setShowTwilioForm] = useState(false)
  const [twilioForm, setTwilioForm] = useState({ accountSid: '', authToken: '', phoneNumber: '' })
  const [savingTwilio, setSavingTwilio] = useState(false)

  useEffect(() => {
    fetch(`/api/locations/${locationId}/integrations`)
      .then(r => r.json())
      .then(({ integrations: ints, ghlConnected: ghl, vapiActive: vapi }: {
        integrations: Integration[]
        ghlConnected: boolean
        vapiActive: boolean
      }) => {
        setIntegrations(ints || [])
        setGhlConnected(ghl)
        setVapiActive(vapi)
      })
      .finally(() => setLoading(false))
  }, [locationId])

  async function connectTwilio(e: React.FormEvent) {
    e.preventDefault()
    setSavingTwilio(true)
    const res = await fetch(`/api/locations/${locationId}/integrations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'twilio',
        name: `Twilio ${twilioForm.phoneNumber}`,
        credentials: { accountSid: twilioForm.accountSid, authToken: twilioForm.authToken },
        config: { phoneNumber: twilioForm.phoneNumber },
      }),
    })
    const { integration } = await res.json()
    setIntegrations(prev => [...prev, integration])
    setShowTwilioForm(false)
    setTwilioForm({ accountSid: '', authToken: '', phoneNumber: '' })
    setSavingTwilio(false)
  }

  if (loading) return <div className="flex items-center justify-center h-64"><p className="text-zinc-500 text-sm">Loading…</p></div>

  const twilioIntegrations = integrations.filter(i => i.type === 'twilio')
  const hubspotIntegrations = integrations.filter(i => i.type === 'hubspot')

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <div className="mb-6">
        <h1 className="text-xl font-semibold mb-1">Integrations</h1>
        <p className="text-zinc-400 text-sm">Connect your CRM, telephony, and communication platforms. Agents work across all connected channels.</p>
      </div>

      <div className="space-y-3">

        {/* GHL */}
        <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="text-2xl">⚡</span>
              <div>
                <p className="text-sm font-medium text-zinc-200">GoHighLevel</p>
                <p className="text-xs text-zinc-500">CRM, pipelines, SMS, email, calendars</p>
              </div>
            </div>
            <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${ghlConnected ? 'bg-emerald-900/30 text-emerald-400' : 'bg-zinc-800 text-zinc-500'}`}>
              {ghlConnected ? 'Connected' : 'Not connected'}
            </span>
          </div>
        </div>

        {/* Vapi Voice */}
        <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="text-2xl">🎙️</span>
              <div>
                <p className="text-sm font-medium text-zinc-200">Voice AI</p>
                <p className="text-xs text-zinc-500">Inbound call handling — configure per agent in Voice settings</p>
              </div>
            </div>
            <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${vapiActive ? 'bg-emerald-900/30 text-emerald-400' : 'bg-zinc-800 text-zinc-500'}`}>
              {vapiActive ? 'Active' : 'Unavailable'}
            </span>
          </div>
        </div>

        {/* Twilio */}
        <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-5">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-3">
              <span className="text-2xl">📱</span>
              <div>
                <p className="text-sm font-medium text-zinc-200">Twilio</p>
                <p className="text-xs text-zinc-500">Direct SMS — no CRM required</p>
              </div>
            </div>
            <button
              onClick={() => setShowTwilioForm(!showTwilioForm)}
              className="text-xs px-3 py-1.5 rounded-lg border border-zinc-700 text-zinc-300 hover:border-zinc-500 transition-colors"
            >
              + Add number
            </button>
          </div>

          {twilioIntegrations.length > 0 && (
            <div className="space-y-1 mb-3">
              {twilioIntegrations.map(i => (
                <div key={i.id} className="flex items-center justify-between bg-zinc-900 rounded-lg px-3 py-2">
                  <span className="text-xs text-zinc-300">{i.name}</span>
                  <span className="text-xs text-emerald-400">Active</span>
                </div>
              ))}
            </div>
          )}

          {showTwilioForm && (
            <form onSubmit={connectTwilio} className="space-y-3 mt-3 pt-3 border-t border-zinc-800">
              <p className="text-xs text-zinc-500">Find these in your <a href="https://console.twilio.com" target="_blank" className="text-blue-400 hover:underline">Twilio Console</a>.</p>
              <input
                type="text"
                value={twilioForm.accountSid}
                onChange={e => setTwilioForm(p => ({ ...p, accountSid: e.target.value }))}
                placeholder="Account SID (ACxxxxxxxx)"
                required
                className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-zinc-500"
              />
              <input
                type="password"
                value={twilioForm.authToken}
                onChange={e => setTwilioForm(p => ({ ...p, authToken: e.target.value }))}
                placeholder="Auth Token"
                required
                className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-zinc-500"
              />
              <input
                type="text"
                value={twilioForm.phoneNumber}
                onChange={e => setTwilioForm(p => ({ ...p, phoneNumber: e.target.value }))}
                placeholder="Phone number (e.g. +15551234567)"
                required
                className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-zinc-500"
              />
              <div className="flex gap-2">
                <button type="submit" disabled={savingTwilio} className="flex-1 rounded-lg bg-white text-black font-medium text-sm h-9 hover:bg-zinc-200 transition-colors disabled:opacity-50">
                  {savingTwilio ? 'Connecting…' : 'Connect Twilio'}
                </button>
                <button type="button" onClick={() => setShowTwilioForm(false)} className="px-4 rounded-lg border border-zinc-700 text-zinc-400 text-sm hover:border-zinc-500 transition-colors">
                  Cancel
                </button>
              </div>
            </form>
          )}
        </div>

        {/* HubSpot */}
        <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="text-2xl">🟠</span>
              <div>
                <p className="text-sm font-medium text-zinc-200">HubSpot</p>
                <p className="text-xs text-zinc-500">CRM contacts, deals, timeline events</p>
              </div>
            </div>
            {hubspotIntegrations.length > 0 ? (
              <span className="text-xs px-2.5 py-1 rounded-full font-medium bg-emerald-900/30 text-emerald-400">Connected</span>
            ) : (
              <a
                href={`/api/auth/hubspot?locationId=${locationId}`}
                className="text-xs px-3 py-1.5 rounded-lg border border-zinc-700 text-zinc-300 hover:border-zinc-500 transition-colors"
              >
                Connect
              </a>
            )}
          </div>
        </div>

      </div>
    </div>
  )
}
