'use client'

import { useEffect, useRef, useState } from 'react'

interface Props {
  widgetId: string
  publicKey: string
  name: string
  type: 'chat' | 'click_to_call'
  primaryColor: string
  logoUrl: string | null
  buttonLabel: string
  buttonTextColor: string
  headline: string | null
  subtext: string | null
}

const VISITOR_KEY = 'voxility_visitor_id'
type CallState = 'idle' | 'connecting' | 'live' | 'ended' | 'error'

export default function HostedCallClient(p: Props) {
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

  useEffect(() => {
    let cancelled = false
    const cookieId = getCookieId()
    ;(async () => {
      try {
        const v = await fetch(`/api/widget/${p.widgetId}/visitor?pk=${p.publicKey}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ cookieId }),
        }).then(r => r.json())
        if (cancelled) return
        if (!v.visitorId) throw new Error(v.error || 'Failed to identify visitor')
        const c = await fetch(`/api/widget/${p.widgetId}/conversations?pk=${p.publicKey}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ visitorId: v.visitorId }),
        }).then(r => r.json())
        if (cancelled) return
        if (!c.conversationId) throw new Error(c.error || 'Failed to start conversation')
        setConversationId(c.conversationId)
      } catch (e: any) {
        if (!cancelled) { setError(e.message); setState('error') }
      }
    })()
    return () => { cancelled = true }
  }, [p.widgetId, p.publicKey])

  useEffect(() => {
    if (state !== 'live') return
    const t = setInterval(() => setSeconds(s => s + 1), 1000)
    return () => clearInterval(t)
  }, [state])

  async function startCall() {
    if (!conversationId) return
    setState('connecting'); setError(null); setSeconds(0)
    try {
      const res = await fetch(`/api/widget/${p.widgetId}/voice/start?pk=${p.publicKey}`, {
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
          fetch(`/api/widget/${p.widgetId}/voice/end?pk=${p.publicKey}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ callId: data.callId }),
          }).catch(() => {})
        }
        vapiRef.current = null
      })
      vapi.on('error', (e: any) => { setState('error'); setError(e?.message || 'Voice error') })
      await vapi.start(data.assistant)
    } catch (e: any) {
      setState('error'); setError(e.message || 'Failed to start voice call')
    }
  }

  function hangup() {
    if (vapiRef.current) { try { vapiRef.current.stop() } catch {} }
    setState('ended')
  }

  const headline =
    state === 'idle' ? (p.headline || `Talk to ${p.name}`) :
    state === 'connecting' ? 'Connecting…' :
    state === 'live' ? 'On the call' :
    state === 'ended' ? 'Call ended' :
    'Call error'

  const subtext =
    state === 'idle' ? (p.subtext || 'Tap below to start a voice call. We\'ll pick up right away.') :
    state === 'connecting' ? 'Starting a secure connection…' :
    state === 'live' ? formatDuration(seconds) :
    state === 'ended' ? 'Thanks for calling.' :
    state === 'error' ? (error || 'Something went wrong.') :
    ''

  return (
    <div
      className="min-h-screen flex flex-col"
      style={{
        background: `radial-gradient(circle at top, ${p.primaryColor}22, #0a0a0a 60%)`,
        color: '#f4f4f5',
      }}
    >
      <header className="px-6 py-5 flex items-center gap-3">
        {p.logoUrl ? (
          <img src={p.logoUrl} alt="" className="w-8 h-8 rounded-full object-cover" />
        ) : (
          <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold"
            style={{ background: p.primaryColor, color: '#fff' }}>
            {p.name.charAt(0).toUpperCase()}
          </div>
        )}
        <p className="text-sm font-semibold text-zinc-200">{p.name}</p>
      </header>

      <main className="flex-1 flex flex-col items-center justify-center p-8 text-center">
        <div
          className={`w-32 h-32 rounded-full flex items-center justify-center mb-7 transition-all ${state === 'live' ? 'animate-pulse' : ''}`}
          style={{
            background: state === 'live' ? p.primaryColor : `${p.primaryColor}22`,
            boxShadow: state === 'live' ? `0 0 0 18px ${p.primaryColor}1a` : 'none',
          }}
        >
          <svg className="w-14 h-14" fill="none" viewBox="0 0 24 24"
            stroke={state === 'live' ? '#fff' : p.primaryColor} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
          </svg>
        </div>

        <h1 className="text-2xl font-bold mb-2">{headline}</h1>
        <p className="text-sm text-zinc-400 mb-8 max-w-md">{subtext}</p>

        {(state === 'idle' || state === 'ended' || state === 'error') && (
          <button
            onClick={startCall}
            disabled={!conversationId}
            className="text-base font-semibold px-8 py-3.5 rounded-full hover:opacity-90 transition-opacity disabled:opacity-50 shadow-lg"
            style={{ background: p.primaryColor, color: p.buttonTextColor || '#fff' }}
          >
            {state === 'ended' ? 'Call again' : state === 'error' ? 'Retry' : p.buttonLabel || 'Start call'}
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
            className="text-base font-semibold px-8 py-3.5 rounded-full bg-red-500 text-white hover:bg-red-600 transition-colors shadow-lg"
          >
            Hang up
          </button>
        )}
      </main>

      <footer className="px-6 py-4 text-center">
        <p className="text-[11px] text-zinc-600">Powered by Voxility</p>
      </footer>
    </div>
  )
}

function formatDuration(s: number): string {
  const m = Math.floor(s / 60)
  const r = s % 60
  return `${m}:${r.toString().padStart(2, '0')}`
}
