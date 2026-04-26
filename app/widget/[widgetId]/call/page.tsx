'use client'

import { useEffect, useRef, useState } from 'react'
import { useParams, useSearchParams } from 'next/navigation'

interface CallConfig {
  id: string
  type: 'chat' | 'click_to_call'
  primaryColor: string
  buttonTextColor: string
  logoUrl: string | null
  buttonLabel: string
  hostedPageHeadline?: string | null
  hostedPageSubtext?: string | null
}

const VISITOR_KEY = 'voxility_visitor_id'
type CallState = 'idle' | 'preparing' | 'connecting' | 'live' | 'ended' | 'error'

export default function CallEmbedPage() {
  const params = useParams()
  const searchParams = useSearchParams()
  const widgetId = params.widgetId as string
  const publicKey = searchParams.get('pk') || ''

  const [config, setConfig] = useState<CallConfig | null>(null)
  const [conversationId, setConversationId] = useState<string | null>(null)
  const [state, setState] = useState<CallState>('idle')
  const [error, setError] = useState<string | null>(null)
  const [seconds, setSeconds] = useState(0)
  const vapiRef = useRef<any>(null)

  function getCookieId(): string {
    if (typeof window === 'undefined') return ''
    let id = localStorage.getItem(VISITOR_KEY)
    if (!id) {
      id = 'c_' + Math.random().toString(36).slice(2) + Date.now().toString(36)
      try { localStorage.setItem(VISITOR_KEY, id) } catch {}
    }
    return id
  }

  // Load config
  useEffect(() => {
    if (!widgetId || !publicKey) return
    fetch(`/api/widget/${widgetId}/config?pk=${publicKey}`)
      .then(r => r.json())
      .then(data => {
        if (data.error) { setError(data.error); setState('error'); return }
        setConfig(data)
      })
      .catch(e => { setError(e.message); setState('error') })
  }, [widgetId, publicKey])

  // Provision visitor + conversation up front so the call button is ready
  useEffect(() => {
    if (!config) return
    let cancelled = false
    const cookieId = getCookieId()
    ;(async () => {
      try {
        const vRes = await fetch(`/api/widget/${widgetId}/visitor?pk=${publicKey}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ cookieId }),
        }).then(r => r.json())
        if (cancelled) return
        if (!vRes.visitorId) throw new Error(vRes.error || 'Failed to identify visitor')
        const cRes = await fetch(`/api/widget/${widgetId}/conversations?pk=${publicKey}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ visitorId: vRes.visitorId }),
        }).then(r => r.json())
        if (cancelled) return
        if (!cRes.conversationId) throw new Error(cRes.error || 'Failed to start conversation')
        setConversationId(cRes.conversationId)
      } catch (e: any) {
        if (!cancelled) { setError(e.message); setState('error') }
      }
    })()
    return () => { cancelled = true }
  }, [config, widgetId, publicKey])

  // Live timer
  useEffect(() => {
    if (state !== 'live') return
    const t = setInterval(() => setSeconds(s => s + 1), 1000)
    return () => clearInterval(t)
  }, [state])

  async function startCall() {
    if (!conversationId) return
    setState('connecting')
    setError(null)
    setSeconds(0)
    try {
      const res = await fetch(`/api/widget/${widgetId}/voice/start?pk=${publicKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversationId }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to start call')

      const Vapi = (await import('@vapi-ai/web')).default
      const vapi = new Vapi(data.vapiPublicKey)
      vapiRef.current = vapi
      vapi.on('call-start', () => setState('live'))
      vapi.on('call-end', () => {
        setState('ended')
        if (data.callId) {
          fetch(`/api/widget/${widgetId}/voice/end?pk=${publicKey}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ callId: data.callId }),
          }).catch(() => {})
        }
        vapiRef.current = null
      })
      vapi.on('error', (e: any) => {
        setState('error')
        setError(e?.message || 'Voice error')
      })
      await vapi.start(data.assistant)
    } catch (e: any) {
      setState('error')
      setError(e.message || 'Failed to start voice call')
    }
  }

  function hangup() {
    if (vapiRef.current) {
      try { vapiRef.current.stop() } catch {}
    }
    setState('ended')
  }

  if (state === 'error' && !config) {
    return (
      <div className="min-h-screen flex items-center justify-center p-8 bg-zinc-950 text-zinc-300 text-sm">
        <div className="max-w-sm text-center">
          <p className="text-red-400 font-semibold mb-2">Call unavailable</p>
          <p className="text-zinc-500">{error}</p>
        </div>
      </div>
    )
  }
  if (!config) return <div className="min-h-screen bg-zinc-950" />

  const accent = config.primaryColor
  const headline =
    state === 'idle' ? (config.hostedPageHeadline || 'Ready to call') :
    state === 'preparing' ? 'Getting ready…' :
    state === 'connecting' ? 'Connecting…' :
    state === 'live' ? 'On the call' :
    state === 'ended' ? 'Call ended' :
    'Call error'

  const subtext =
    state === 'idle' ? (config.hostedPageSubtext || 'Tap below to talk with our AI assistant.') :
    state === 'connecting' ? 'Starting a secure connection…' :
    state === 'live' ? formatDuration(seconds) :
    state === 'ended' ? 'Thanks for calling.' :
    state === 'error' ? (error || 'Something went wrong.') :
    ''

  return (
    <div className="min-h-screen flex flex-col bg-zinc-950 text-zinc-100">
      <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
        {config.logoUrl ? (
          <img src={config.logoUrl} alt="" className="w-12 h-12 rounded-full object-cover mb-6" />
        ) : null}

        <div
          className={`w-28 h-28 rounded-full flex items-center justify-center mb-6 transition-all ${state === 'live' ? 'animate-pulse' : ''}`}
          style={{
            background: state === 'live' ? accent : `${accent}22`,
            boxShadow: state === 'live' ? `0 0 0 14px ${accent}1a` : 'none',
          }}
        >
          <svg className="w-12 h-12" fill="none" viewBox="0 0 24 24"
            stroke={state === 'live' ? '#fff' : accent} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
          </svg>
        </div>

        <p className="text-base font-semibold mb-1">{headline}</p>
        <p className="text-xs text-zinc-400 mb-7 max-w-xs">{subtext}</p>

        {(state === 'idle' || state === 'ended' || state === 'error') && (
          <button
            onClick={startCall}
            disabled={!conversationId}
            className="text-sm font-semibold px-6 py-3 rounded-full hover:opacity-90 transition-opacity disabled:opacity-50"
            style={{ background: accent, color: config.buttonTextColor || '#fff' }}
          >
            {state === 'ended' ? 'Call again' : state === 'error' ? 'Retry' : config.buttonLabel || 'Start call'}
          </button>
        )}
        {state === 'connecting' && (
          <button onClick={hangup} className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors">
            Cancel
          </button>
        )}
        {state === 'live' && (
          <button
            onClick={hangup}
            className="text-sm font-semibold px-6 py-3 rounded-full bg-red-500 text-white hover:bg-red-600 transition-colors"
          >
            Hang up
          </button>
        )}
      </div>
      <p className="text-[10px] text-zinc-600 text-center pb-4">Powered by Voxility</p>
    </div>
  )
}

function formatDuration(s: number): string {
  const m = Math.floor(s / 60)
  const r = s % 60
  return `${m}:${r.toString().padStart(2, '0')}`
}
