'use client'

/**
 * Phone-call simulator UI.
 *
 * Wraps the existing browser test-call paths (XaiTestCall for xAI
 * agents, Vapi Web SDK for Vapi agents) in a phone-call-shaped shell:
 * idle screen with two big buttons, ring animation, connected screen
 * with live transcript + call timer, hang-up button. Also exposes
 * "dial a real number" mode that fires POST /api/actions/outbound-call.
 *
 * Used both inside the voice wizard's final step AND on the voice
 * agent's Voice tab as the test affordance. One component, two surfaces.
 */

import { useEffect, useRef, useState } from 'react'
import dynamic from 'next/dynamic'

// XaiTestCall is heavy (audio context, web socket, mic capture). Lazy-
// load so the rest of the wizard/page doesn't pay for it until the
// user actually clicks "Test call (browser)".
const XaiTestCall = dynamic(() => import('./XaiTestCall'), { ssr: false })

export interface VoicePhoneCallUIProps {
  workspaceId: string
  agentId: string
  agentName: string
  /** Voice id to play — passed through to XAI or Vapi assistant config */
  voiceId: string
  /** Opening line the agent says when the call starts */
  firstMessage?: string | null
  /** 'vapi' | 'xai' — controls which browser-call path runs */
  ttsProvider: 'vapi' | 'xai'
  /** Workspace's primary location id, needed for outbound-call API */
  locationId: string
  /** When true, the dial-real-number button is hidden (e.g. xAI agents with no phone) */
  outboundEnabled?: boolean
}

type CallMode = 'idle' | 'browser' | 'outbound'

export default function VoicePhoneCallUI(props: VoicePhoneCallUIProps) {
  const [mode, setMode] = useState<CallMode>('idle')

  return (
    <div
      className="rounded-2xl overflow-hidden"
      style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
    >
      {mode === 'idle' && <IdleScreen {...props} onStartBrowser={() => setMode('browser')} onStartOutbound={() => setMode('outbound')} />}
      {mode === 'browser' && <BrowserCallScreen {...props} onHangUp={() => setMode('idle')} />}
      {mode === 'outbound' && <OutboundCallScreen {...props} onClose={() => setMode('idle')} />}
    </div>
  )
}

// ─── Idle ────────────────────────────────────────────────────────────

function IdleScreen({
  agentName, voiceId, outboundEnabled, onStartBrowser, onStartOutbound,
}: VoicePhoneCallUIProps & { onStartBrowser: () => void; onStartOutbound: () => void }) {
  return (
    <div className="p-8 text-center">
      <div
        className="w-24 h-24 mx-auto rounded-full flex items-center justify-center mb-4 text-4xl"
        style={{
          background: 'linear-gradient(135deg, #fa4d2e 0%, #fb8e6a 100%)',
          boxShadow: '0 10px 40px -10px rgba(250, 77, 46, 0.35)',
        }}
        aria-hidden
      >
        📞
      </div>
      <h2 className="text-lg font-semibold mb-1" style={{ color: 'var(--text-primary)' }}>{agentName}</h2>
      <p className="text-xs mb-6" style={{ color: 'var(--text-tertiary)' }}>
        Voice ready · {voiceId ? voiceId.slice(0, 18) : 'no voice selected'}
      </p>
      <div className="space-y-3 max-w-xs mx-auto">
        <button
          onClick={onStartBrowser}
          className="w-full inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl text-sm font-semibold transition-colors hover:opacity-90"
          style={{ background: '#fa4d2e', color: '#ffffff' }}
        >
          <span aria-hidden>📞</span> Test call in browser
        </button>
        {outboundEnabled !== false && (
          <button
            onClick={onStartOutbound}
            className="w-full inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl text-sm font-medium transition-colors"
            style={{ background: 'var(--surface-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border)' }}
          >
            <span aria-hidden>📱</span> Dial a real number
          </button>
        )}
      </div>
    </div>
  )
}

// ─── Browser call ────────────────────────────────────────────────────

function BrowserCallScreen({
  agentId, agentName, voiceId, firstMessage, ttsProvider, onHangUp,
}: VoicePhoneCallUIProps & { onHangUp: () => void }) {
  // Brief "ringing" theatre before connecting — sells the phone-call
  // metaphor. 900ms is long enough to register, short enough not to
  // annoy on repeat tests.
  const [phase, setPhase] = useState<'ringing' | 'connected'>('ringing')
  const [elapsed, setElapsed] = useState(0)

  useEffect(() => {
    const t = setTimeout(() => setPhase('connected'), 900)
    return () => clearTimeout(t)
  }, [])

  useEffect(() => {
    if (phase !== 'connected') return
    const i = setInterval(() => setElapsed(e => e + 1), 1000)
    return () => clearInterval(i)
  }, [phase])

  const mmss = `${String(Math.floor(elapsed / 60)).padStart(2, '0')}:${String(elapsed % 60).padStart(2, '0')}`

  return (
    <div className="p-6">
      <div className="flex flex-col items-center mb-5">
        <div className="relative mb-3">
          {phase === 'ringing' && (
            <>
              <div className="absolute inset-0 rounded-full animate-ping" style={{ background: 'rgba(250,77,46,0.35)' }} />
              <div className="absolute inset-0 rounded-full animate-pulse" style={{ background: 'rgba(250,77,46,0.55)' }} />
            </>
          )}
          <div
            className="relative w-20 h-20 rounded-full flex items-center justify-center text-3xl"
            style={{
              background: 'linear-gradient(135deg, #fa4d2e 0%, #fb8e6a 100%)',
              boxShadow: '0 8px 30px -8px rgba(250, 77, 46, 0.45)',
            }}
            aria-hidden
          >
            📞
          </div>
        </div>
        <h2 className="font-semibold text-base" style={{ color: 'var(--text-primary)' }}>{agentName}</h2>
        <p className="text-xs mt-0.5" style={{ color: 'var(--text-tertiary)' }}>
          {phase === 'ringing' ? 'Connecting…' : `Connected · ${mmss}`}
        </p>
      </div>

      {phase === 'connected' && (
        <div className="rounded-xl p-3" style={{ background: 'var(--surface-secondary)', border: '1px solid var(--border)' }}>
          {ttsProvider === 'xai' ? (
            // The XAI test component already renders its own transcript,
            // mic UI, and status. We just embed it inside our phone-call
            // shell so the user sees the phone metaphor.
            <XaiTestCall agentId={agentId} agentName={agentName} voiceId={voiceId} firstMessage={firstMessage ?? undefined} />
          ) : (
            <VapiBrowserCall agentId={agentId} firstMessage={firstMessage ?? undefined} />
          )}
        </div>
      )}

      <div className="text-center mt-5">
        <button
          onClick={onHangUp}
          className="w-14 h-14 rounded-full text-white inline-flex items-center justify-center transition-colors hover:opacity-90"
          style={{ background: '#ef4444', boxShadow: '0 4px 20px -4px rgba(239,68,68,0.4)' }}
          title="End call"
          aria-label="End call"
        >
          <svg className="w-6 h-6 rotate-[135deg]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
          </svg>
        </button>
      </div>
    </div>
  )
}

// Inline Vapi browser-call subcomponent. Vapi's Web SDK is fully
// inline-able; we don't have a Vapi-equivalent of XaiTestCall today
// so this is the canonical place for it now.
function VapiBrowserCall({ agentId, firstMessage }: { agentId: string; firstMessage?: string }) {
  const [status, setStatus] = useState<'starting' | 'live' | 'ended' | 'error'>('starting')
  const [errMsg, setErrMsg] = useState<string | null>(null)
  const [transcript, setTranscript] = useState<Array<{ role: string; text: string }>>([])
  const vapiRef = useRef<any>(null)

  useEffect(() => {
    let cancelled = false

    async function run() {
      try {
        const cfgRes = await fetch(`/api/workspaces/agents/${agentId}/vapi-browser-config`)
        // The browser-config endpoint may not exist yet on every env
        // (it's a thin wrapper around VapiConfig + the public key).
        // Fall back to the agent's vapi-config endpoint which IS
        // shipped.
        let cfg: any
        if (cfgRes.ok) {
          cfg = await cfgRes.json()
        } else {
          // Resolve workspaceId from the URL — the agent's vapi-config
          // endpoint is workspace-scoped.
          const m = window.location.pathname.match(/\/dashboard\/([^/]+)/)
          if (!m) throw new Error('Could not resolve workspace from URL')
          const fallback = await fetch(`/api/workspaces/${m[1]}/agents/${agentId}/vapi`)
          cfg = await fallback.json()
        }

        if (cancelled) return

        const publicKey = cfg.vapiPublicKey || cfg.publicKey
        if (!publicKey) throw new Error('Vapi public key is not configured on this deployment')

        const Vapi = (await import('@vapi-ai/web')).default
        const vapi = new Vapi(publicKey)
        vapiRef.current = vapi

        vapi.on('message', (msg: any) => {
          if (msg?.type === 'transcript' && msg.transcriptType === 'final') {
            setTranscript(prev => [...prev, { role: msg.role || 'assistant', text: msg.transcript }])
          }
        })
        vapi.on('call-start', () => { if (!cancelled) setStatus('live') })
        vapi.on('call-end', () => { if (!cancelled) setStatus('ended') })
        vapi.on('error', (e: any) => {
          if (!cancelled) { setStatus('error'); setErrMsg(e?.message ?? 'Vapi error') }
        })

        await vapi.start({
          model: { provider: 'anthropic', model: 'claude-sonnet-4-20250514' } as any,
          voice: { provider: '11labs', voiceId: cfg.voiceId ?? cfg.config?.voiceId },
          firstMessage: firstMessage ?? cfg.firstMessage ?? cfg.config?.firstMessage ?? 'Hello.',
        } as any)
      } catch (err: any) {
        if (!cancelled) {
          setStatus('error')
          setErrMsg(err.message ?? 'Failed to start call')
        }
      }
    }

    run()
    return () => {
      cancelled = true
      try { vapiRef.current?.stop?.() } catch {}
    }
  }, [agentId, firstMessage])

  return (
    <div>
      <p className="text-[11px] mb-2" style={{ color: 'var(--text-tertiary)' }}>
        Vapi · {status === 'live' ? 'Listening' : status === 'starting' ? 'Connecting…' : status === 'ended' ? 'Call ended' : 'Error'}
      </p>
      {errMsg && (
        <p className="text-[11px] mb-2" style={{ color: '#ef4444' }}>{errMsg}</p>
      )}
      <div className="space-y-1.5 max-h-48 overflow-y-auto text-sm">
        {transcript.length === 0 ? (
          <p className="text-xs italic" style={{ color: 'var(--text-tertiary)' }}>Transcript will appear here as the call progresses…</p>
        ) : transcript.map((line, i) => (
          <div key={i}>
            <span className="text-[10px] font-semibold uppercase tracking-wider mr-2" style={{ color: 'var(--text-tertiary)' }}>{line.role}</span>
            <span style={{ color: 'var(--text-primary)' }}>{line.text}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Outbound call (dial a real number) ──────────────────────────────

function OutboundCallScreen({
  workspaceId, agentId, agentName, locationId, onClose,
}: VoicePhoneCallUIProps & { onClose: () => void }) {
  const [phone, setPhone] = useState('')
  const [country, setCountry] = useState('+1')
  const [phase, setPhase] = useState<'input' | 'dialing' | 'in_progress' | 'ended' | 'error'>('input')
  const [errMsg, setErrMsg] = useState<string | null>(null)
  const [callLogId, setCallLogId] = useState<string | null>(null)

  async function dial() {
    setPhase('dialing')
    setErrMsg(null)
    const e164 = `${country}${phone.replace(/\D/g, '')}`
    try {
      const res = await fetch('/api/actions/outbound-call', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          locationId,
          agentId,
          phone: e164,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || `Dial failed (${res.status})`)
      setCallLogId(data.callLogId || null)
      setPhase('in_progress')
      // We don't have live call-status push today (Vapi webhook updates
      // the CallLog asynchronously). Show in_progress until the user
      // closes the screen.
    } catch (err: any) {
      setPhase('error')
      setErrMsg(err.message ?? 'Dial failed')
    }
  }

  return (
    <div className="p-6">
      <div className="flex flex-col items-center mb-5">
        <div
          className="w-20 h-20 rounded-full flex items-center justify-center mb-3 text-3xl"
          style={{
            background: 'linear-gradient(135deg, #fa4d2e 0%, #fb8e6a 100%)',
            boxShadow: '0 8px 30px -8px rgba(250, 77, 46, 0.45)',
          }}
          aria-hidden
        >
          📱
        </div>
        <h2 className="font-semibold text-base" style={{ color: 'var(--text-primary)' }}>Dial a real number</h2>
        <p className="text-xs mt-0.5 text-center max-w-xs" style={{ color: 'var(--text-tertiary)' }}>
          {agentName} will call this number and start the conversation when the line picks up.
        </p>
      </div>

      {phase === 'input' && (
        <div className="max-w-sm mx-auto space-y-3">
          <div className="flex items-center gap-2">
            <select
              value={country}
              onChange={e => setCountry(e.target.value)}
              className="rounded-lg px-3 py-2 text-sm focus:outline-none"
              style={{ background: 'var(--input-bg)', border: '1px solid var(--input-border)', color: 'var(--input-text)' }}
            >
              <option value="+1">🇺🇸 +1</option>
              <option value="+44">🇬🇧 +44</option>
              <option value="+61">🇦🇺 +61</option>
              <option value="+64">🇳🇿 +64</option>
              <option value="+33">🇫🇷 +33</option>
              <option value="+49">🇩🇪 +49</option>
            </select>
            <input
              type="tel"
              value={phone}
              onChange={e => setPhone(e.target.value)}
              placeholder="5551234567"
              className="flex-1 rounded-lg px-3 py-2 text-sm focus:outline-none"
              style={{ background: 'var(--input-bg)', border: '1px solid var(--input-border)', color: 'var(--input-text)' }}
            />
          </div>
          <p className="text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
            Standard call charges apply. You'll see the call in the agent's Activity tab once it completes.
          </p>
          <button
            onClick={dial}
            disabled={phone.replace(/\D/g, '').length < 7}
            className="w-full px-5 py-2.5 rounded-lg text-sm font-semibold disabled:opacity-40"
            style={{ background: '#fa4d2e', color: '#ffffff' }}
          >
            Dial
          </button>
          <button
            onClick={onClose}
            className="w-full px-5 py-2 text-sm"
            style={{ color: 'var(--text-tertiary)' }}
          >
            Cancel
          </button>
        </div>
      )}

      {phase === 'dialing' && (
        <p className="text-center text-sm" style={{ color: 'var(--text-tertiary)' }}>Placing call…</p>
      )}

      {phase === 'in_progress' && (
        <div className="text-center space-y-3">
          <p className="text-sm" style={{ color: 'var(--accent-emerald, #22c55e)' }}>
            ✓ Call placed. Your phone should ring momentarily.
          </p>
          <p className="text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
            Recording + transcript appears in the Activity tab after the call ends.
          </p>
          {callLogId && (
            <a
              href={`/dashboard/${workspaceId}/calls/${callLogId}`}
              className="inline-block text-xs font-medium"
              style={{ color: '#fa4d2e' }}
            >
              Open call log →
            </a>
          )}
          <div>
            <button
              onClick={onClose}
              className="text-sm px-4 py-2"
              style={{ color: 'var(--text-tertiary)' }}
            >
              Close
            </button>
          </div>
        </div>
      )}

      {phase === 'error' && (
        <div className="max-w-sm mx-auto text-center space-y-3">
          <p className="text-sm" style={{ color: '#ef4444' }}>{errMsg}</p>
          <button
            onClick={() => setPhase('input')}
            className="text-sm px-4 py-2 rounded-lg"
            style={{ background: 'var(--surface-secondary)', color: 'var(--text-primary)' }}
          >
            Try again
          </button>
        </div>
      )}
    </div>
  )
}
