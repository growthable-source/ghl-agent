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

  // Calendly form
  const [showCalendlyForm, setShowCalendlyForm] = useState(false)
  const [calendlyToken, setCalendlyToken] = useState('')
  const [savingCalendly, setSavingCalendly] = useState(false)
  const [calendlyError, setCalendlyError] = useState('')

  // Cal.com form
  const [showCalcomForm, setShowCalcomForm] = useState(false)
  const [calcomKey, setCalcomKey] = useState('')
  const [savingCalcom, setSavingCalcom] = useState(false)
  const [calcomError, setCalcomError] = useState('')

  // Stripe form
  const [showStripeForm, setShowStripeForm] = useState(false)
  const [stripeKey, setStripeKey] = useState('')
  const [savingStripe, setSavingStripe] = useState(false)
  const [stripeError, setStripeError] = useState('')

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

  async function connectCalendly(e: React.FormEvent) {
    e.preventDefault()
    if (!calendlyToken.trim()) return
    setSavingCalendly(true)
    setCalendlyError('')
    try {
      // Verify the token works
      const verify = await fetch('/api/integrations/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'calendly', token: calendlyToken.trim() }),
      })
      const verifyData = await verify.json()
      if (!verify.ok || verifyData.error) throw new Error(verifyData.error || 'Invalid token')

      const res = await fetch(`/api/locations/${locationId}/integrations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'calendly',
          name: `Calendly (${verifyData.userName || 'connected'})`,
          credentials: { accessToken: calendlyToken.trim() },
          config: { userUri: verifyData.userUri },
        }),
      })
      const { integration } = await res.json()
      setIntegrations(prev => [...prev, integration])
      setShowCalendlyForm(false)
      setCalendlyToken('')
    } catch (err: any) { setCalendlyError(err.message) }
    finally { setSavingCalendly(false) }
  }

  async function connectCalcom(e: React.FormEvent) {
    e.preventDefault()
    if (!calcomKey.trim()) return
    setSavingCalcom(true)
    setCalcomError('')
    try {
      const verify = await fetch('/api/integrations/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'calcom', token: calcomKey.trim() }),
      })
      const verifyData = await verify.json()
      if (!verify.ok || verifyData.error) throw new Error(verifyData.error || 'Invalid API key')

      const res = await fetch(`/api/locations/${locationId}/integrations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'calcom',
          name: `Cal.com (${verifyData.userName || 'connected'})`,
          credentials: { apiKey: calcomKey.trim() },
          config: { userId: verifyData.userId },
        }),
      })
      const { integration } = await res.json()
      setIntegrations(prev => [...prev, integration])
      setShowCalcomForm(false)
      setCalcomKey('')
    } catch (err: any) { setCalcomError(err.message) }
    finally { setSavingCalcom(false) }
  }

  async function connectStripe(e: React.FormEvent) {
    e.preventDefault()
    if (!stripeKey.trim()) return
    setSavingStripe(true)
    setStripeError('')
    try {
      const verify = await fetch('/api/integrations/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'stripe', token: stripeKey.trim() }),
      })
      const verifyData = await verify.json()
      if (!verify.ok || verifyData.error) throw new Error(verifyData.error || 'Invalid key')

      const res = await fetch(`/api/locations/${locationId}/integrations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'stripe',
          name: `Stripe (${verifyData.accountName || 'connected'})`,
          credentials: { secretKey: stripeKey.trim() },
          config: { accountId: verifyData.accountId },
        }),
      })
      const { integration } = await res.json()
      setIntegrations(prev => [...prev, integration])
      setShowStripeForm(false)
      setStripeKey('')
    } catch (err: any) { setStripeError(err.message) }
    finally { setSavingStripe(false) }
  }

  if (loading) return <div className="flex items-center justify-center h-64"><p className="text-zinc-500 text-sm">Loading…</p></div>

  const twilioIntegrations = integrations.filter(i => i.type === 'twilio')
  const hubspotIntegrations = integrations.filter(i => i.type === 'hubspot')
  const calendlyIntegrations = integrations.filter(i => i.type === 'calendly')
  const calcomIntegrations = integrations.filter(i => i.type === 'calcom')
  const stripeIntegrations = integrations.filter(i => i.type === 'stripe')

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

        {/* ── Section: Calendars ── */}
        <div className="pt-4 pb-1">
          <p className="text-xs font-medium text-zinc-500 uppercase tracking-wider">Calendars</p>
        </div>

        {/* Calendly */}
        <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-5">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-3">
              <span className="text-2xl">📅</span>
              <div>
                <p className="text-sm font-medium text-zinc-200">Calendly</p>
                <p className="text-xs text-zinc-500">Scheduling links, availability, and bookings</p>
              </div>
            </div>
            {calendlyIntegrations.length > 0 ? (
              <span className="text-xs px-2.5 py-1 rounded-full font-medium bg-emerald-900/30 text-emerald-400">Connected</span>
            ) : (
              <button onClick={() => { setShowCalendlyForm(!showCalendlyForm); setCalendlyError('') }}
                className="text-xs px-3 py-1.5 rounded-lg border border-zinc-700 text-zinc-300 hover:border-zinc-500 transition-colors">
                Connect
              </button>
            )}
          </div>
          {calendlyIntegrations.length > 0 && (
            <div className="space-y-1 mb-3">
              {calendlyIntegrations.map(i => (
                <div key={i.id} className="flex items-center justify-between bg-zinc-900 rounded-lg px-3 py-2">
                  <span className="text-xs text-zinc-300">{i.name}</span>
                  <span className="text-xs text-emerald-400">Active</span>
                </div>
              ))}
            </div>
          )}
          {showCalendlyForm && (
            <form onSubmit={connectCalendly} className="space-y-3 mt-3 pt-3 border-t border-zinc-800">
              <p className="text-xs text-zinc-500">Create a Personal Access Token in <span className="text-blue-400">Calendly &gt; Integrations &gt; API</span>.</p>
              <input type="password" value={calendlyToken}
                onChange={e => setCalendlyToken(e.target.value)}
                placeholder="Personal Access Token"
                required
                className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-zinc-500" />
              {calendlyError && <p className="text-xs text-red-400">{calendlyError}</p>}
              <div className="flex gap-2">
                <button type="submit" disabled={savingCalendly} className="flex-1 rounded-lg bg-white text-black font-medium text-sm h-9 hover:bg-zinc-200 transition-colors disabled:opacity-50">
                  {savingCalendly ? 'Verifying…' : 'Connect Calendly'}
                </button>
                <button type="button" onClick={() => setShowCalendlyForm(false)} className="px-4 rounded-lg border border-zinc-700 text-zinc-400 text-sm hover:border-zinc-500 transition-colors">Cancel</button>
              </div>
            </form>
          )}
        </div>

        {/* Cal.com */}
        <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-5">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-3">
              <span className="text-2xl">🗓️</span>
              <div>
                <p className="text-sm font-medium text-zinc-200">Cal.com</p>
                <p className="text-xs text-zinc-500">Open-source scheduling — event types, availability, bookings</p>
              </div>
            </div>
            {calcomIntegrations.length > 0 ? (
              <span className="text-xs px-2.5 py-1 rounded-full font-medium bg-emerald-900/30 text-emerald-400">Connected</span>
            ) : (
              <button onClick={() => { setShowCalcomForm(!showCalcomForm); setCalcomError('') }}
                className="text-xs px-3 py-1.5 rounded-lg border border-zinc-700 text-zinc-300 hover:border-zinc-500 transition-colors">
                Connect
              </button>
            )}
          </div>
          {calcomIntegrations.length > 0 && (
            <div className="space-y-1 mb-3">
              {calcomIntegrations.map(i => (
                <div key={i.id} className="flex items-center justify-between bg-zinc-900 rounded-lg px-3 py-2">
                  <span className="text-xs text-zinc-300">{i.name}</span>
                  <span className="text-xs text-emerald-400">Active</span>
                </div>
              ))}
            </div>
          )}
          {showCalcomForm && (
            <form onSubmit={connectCalcom} className="space-y-3 mt-3 pt-3 border-t border-zinc-800">
              <p className="text-xs text-zinc-500">Generate an API key in <span className="text-blue-400">Cal.com &gt; Settings &gt; Developer &gt; API Keys</span>.</p>
              <input type="password" value={calcomKey}
                onChange={e => setCalcomKey(e.target.value)}
                placeholder="API Key (cal_live_...)"
                required
                className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-zinc-500" />
              {calcomError && <p className="text-xs text-red-400">{calcomError}</p>}
              <div className="flex gap-2">
                <button type="submit" disabled={savingCalcom} className="flex-1 rounded-lg bg-white text-black font-medium text-sm h-9 hover:bg-zinc-200 transition-colors disabled:opacity-50">
                  {savingCalcom ? 'Verifying…' : 'Connect Cal.com'}
                </button>
                <button type="button" onClick={() => setShowCalcomForm(false)} className="px-4 rounded-lg border border-zinc-700 text-zinc-400 text-sm hover:border-zinc-500 transition-colors">Cancel</button>
              </div>
            </form>
          )}
        </div>

        {/* ── Section: Payments ── */}
        <div className="pt-4 pb-1">
          <p className="text-xs font-medium text-zinc-500 uppercase tracking-wider">Payments</p>
        </div>

        {/* Stripe */}
        <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-5">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-3">
              <span className="text-2xl">💳</span>
              <div>
                <p className="text-sm font-medium text-zinc-200">Stripe</p>
                <p className="text-xs text-zinc-500">Collect payments and send invoices during conversations</p>
              </div>
            </div>
            {stripeIntegrations.length > 0 ? (
              <span className="text-xs px-2.5 py-1 rounded-full font-medium bg-emerald-900/30 text-emerald-400">Connected</span>
            ) : (
              <button onClick={() => { setShowStripeForm(!showStripeForm); setStripeError('') }}
                className="text-xs px-3 py-1.5 rounded-lg border border-zinc-700 text-zinc-300 hover:border-zinc-500 transition-colors">
                Connect
              </button>
            )}
          </div>
          {stripeIntegrations.length > 0 && (
            <div className="space-y-1 mb-3">
              {stripeIntegrations.map(i => (
                <div key={i.id} className="flex items-center justify-between bg-zinc-900 rounded-lg px-3 py-2">
                  <span className="text-xs text-zinc-300">{i.name}</span>
                  <span className="text-xs text-emerald-400">Active</span>
                </div>
              ))}
            </div>
          )}
          {showStripeForm && (
            <form onSubmit={connectStripe} className="space-y-3 mt-3 pt-3 border-t border-zinc-800">
              <p className="text-xs text-zinc-500">Find your secret key in <span className="text-blue-400">Stripe Dashboard &gt; Developers &gt; API keys</span>.</p>
              <input type="password" value={stripeKey}
                onChange={e => setStripeKey(e.target.value)}
                placeholder="Secret Key (sk_live_...)"
                required
                className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-zinc-500" />
              {stripeError && <p className="text-xs text-red-400">{stripeError}</p>}
              <div className="flex gap-2">
                <button type="submit" disabled={savingStripe} className="flex-1 rounded-lg bg-white text-black font-medium text-sm h-9 hover:bg-zinc-200 transition-colors disabled:opacity-50">
                  {savingStripe ? 'Verifying…' : 'Connect Stripe'}
                </button>
                <button type="button" onClick={() => setShowStripeForm(false)} className="px-4 rounded-lg border border-zinc-700 text-zinc-400 text-sm hover:border-zinc-500 transition-colors">Cancel</button>
              </div>
            </form>
          )}
        </div>

      </div>
    </div>
  )
}
