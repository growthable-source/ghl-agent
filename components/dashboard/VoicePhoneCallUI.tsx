'use client'

/**
 * Phone-call simulator UI.
 *
 * Wraps the Vapi Web SDK browser test-call path in a phone-shaped
 * shell: idle screen with two big buttons, ring animation, connected
 * screen with live transcript + call timer, hang-up button. Also
 * exposes "dial a real number" mode that fires
 * POST /api/actions/outbound-call.
 *
 * Used both inside the voice wizard's final step AND on the voice
 * agent's Voice tab as the test affordance. One component, two
 * surfaces. Vapi handles every TTS engine (Vapi-native, ElevenLabs)
 * at runtime — the engine choice on the agent config dictates which
 * voice is used; this UI doesn't branch.
 */

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useGeminiTestCall } from '@/lib/voice/use-gemini-test-call'

export interface VoicePhoneCallUIProps {
  workspaceId: string
  agentId: string
  agentName: string
  /** Voice id to play — passed through to the Vapi assistant config */
  voiceId: string
  /** Opening line the agent says when the call starts */
  firstMessage?: string | null
  /**
   * Engine identifier on the agent's VapiConfig. Kept as a prop for
   * back-compat with old call sites — the UI no longer branches on
   * it. Vapi routes the right TTS engine based on the registered
   * assistant's voice block. Accepts 'vapi' | 'elevenlabs' (post-Phase-D
   * values) and tolerates legacy strings.
   */
  ttsProvider: 'vapi' | 'elevenlabs' | string
  /** Workspace's primary location id, needed for outbound-call API */
  locationId: string
  /** When true, the dial-real-number button is hidden */
  outboundEnabled?: boolean
  /**
   * Which voice runtime the agent actually uses. 'gemini' agents have no
   * Vapi assistant, so the browser test must run the Gemini Live path —
   * routing them through the Vapi tester just errors "isn't synced".
   * Defaults to 'vapi' for back-compat with existing call sites.
   */
  voiceRuntime?: 'vapi' | 'gemini'
}

type CallMode = 'idle' | 'browser' | 'outbound'

export default function VoicePhoneCallUI(props: VoicePhoneCallUIProps) {
  const [mode, setMode] = useState<CallMode>('idle')

  return (
    <PhoneFrame>
      {mode === 'idle' && <IdleScreen {...props} onStartBrowser={() => setMode('browser')} onStartOutbound={() => setMode('outbound')} />}
      {/* Runtime-aware: Gemini agents have no Vapi assistant, so they run
          the native Gemini Live test (no Vapi preflight gates apply —
          they're live the moment they're created). Vapi agents get the
          full preflight + registered-assistant path. */}
      {mode === 'browser' && (props.voiceRuntime === 'gemini'
        ? <GeminiBrowserScreen {...props} onHangUp={() => setMode('idle')} />
        : <BrowserCallScreen {...props} onHangUp={() => setMode('idle')} />)}
      {mode === 'outbound' && <OutboundCallScreen {...props} onClose={() => setMode('idle')} />}
    </PhoneFrame>
  )
}

/**
 * iPhone-style chrome around the test-call surface. The inner screens
 * render unchanged — this is purely visual scaffolding so the test
 * affordance reads as "a phone you're holding" rather than a generic
 * card. Width capped at 360 so it doesn't blow out a parent column.
 */
function PhoneFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex justify-center">
      <div
        className="relative w-full max-w-[360px]"
        style={{
          padding: '14px',
          borderRadius: '52px',
          background: 'linear-gradient(160deg, #2a2a2e 0%, #1a1a1d 100%)',
          boxShadow:
            '0 30px 80px -20px rgba(0,0,0,0.45), 0 0 0 2px #0a0a0c, inset 0 0 0 1px rgba(255,255,255,0.04)',
        }}
        aria-hidden={false}
      >
        {/* Side buttons — visual only, purely decorative */}
        <div
          className="absolute left-[-3px] top-[110px] w-[3px] h-[36px] rounded-l-sm"
          style={{ background: '#0a0a0c' }}
          aria-hidden
        />
        <div
          className="absolute left-[-3px] top-[170px] w-[3px] h-[60px] rounded-l-sm"
          style={{ background: '#0a0a0c' }}
          aria-hidden
        />
        <div
          className="absolute left-[-3px] top-[244px] w-[3px] h-[60px] rounded-l-sm"
          style={{ background: '#0a0a0c' }}
          aria-hidden
        />
        <div
          className="absolute right-[-3px] top-[180px] w-[3px] h-[90px] rounded-r-sm"
          style={{ background: '#0a0a0c' }}
          aria-hidden
        />

        {/* Screen */}
        <div
          className="relative overflow-hidden"
          style={{
            borderRadius: '40px',
            background: 'var(--surface)',
            boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.06)',
          }}
        >
          {/* Dynamic-island-style notch */}
          <div
            className="absolute left-1/2 -translate-x-1/2 z-10 flex items-center justify-center"
            style={{
              top: '12px',
              width: '110px',
              height: '28px',
              borderRadius: '16px',
              background: '#0a0a0c',
            }}
            aria-hidden
          >
            <div
              className="absolute right-3 w-[8px] h-[8px] rounded-full"
              style={{ background: '#1c1c20', boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.06)' }}
            />
          </div>

          {/* Screen content — padded to leave room for the notch */}
          <div style={{ paddingTop: '52px' }}>
            {children}
          </div>
        </div>
      </div>
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

/**
 * Preflight gate states. The old flow played a fake 900ms "ringing"
 * animation BEFORE checking whether a call could even start — so every
 * failure mode (missing public key, unsynced assistant, quota, mic
 * denied) presented as "it rang, then something weird happened". Now
 * the gates run first, visibly, and the ring you see is the real
 * vapi.start() handshake.
 */
type GateState = 'checking' | 'ok' | 'fixing' | 'failed'
interface Gates {
  engine: GateState      // VAPI_PUBLIC_KEY present on the deployment
  assistant: GateState   // registered Vapi assistant exists (self-heals via PATCH)
  quota: GateState       // workspace has voice minutes left
  mic: GateState         // browser granted microphone access
}

function BrowserCallScreen({
  workspaceId, agentId, agentName, firstMessage, onHangUp,
}: VoicePhoneCallUIProps & { onHangUp: () => void }) {
  const [phase, setPhase] = useState<'preflight' | 'ringing' | 'live' | 'ended' | 'error' | 'quota_blocked'>('preflight')
  const [gates, setGates] = useState<Gates>({ engine: 'checking', assistant: 'checking', quota: 'checking', mic: 'checking' })
  const [gateError, setGateError] = useState<string | null>(null)
  const [errMsg, setErrMsg] = useState<string | null>(null)
  const [quotaInfo, setQuotaInfo] = useState<{ used: number; limit: number; planLabel: string; code: string; message: string } | null>(null)
  const [transcript, setTranscript] = useState<Array<{ role: string; text: string }>>([])
  const [elapsed, setElapsed] = useState(0)
  const [attempt, setAttempt] = useState(0)
  const vapiRef = useRef<any>(null)

  // Live call timer — starts at call-start, not at animation-start.
  useEffect(() => {
    if (phase !== 'live') return
    const i = setInterval(() => setElapsed(e => e + 1), 1000)
    return () => clearInterval(i)
  }, [phase])

  useEffect(() => {
    let cancelled = false

    // JSON.stringify can't handle DOM/circular references inside the
    // daily-error object; this strips them so the diagnostic POST
    // doesn't throw.
    function stripCircular(value: unknown, seen = new WeakSet()): unknown {
      if (!value || typeof value !== 'object') return value
      if (seen.has(value as object)) return '[Circular]'
      seen.add(value as object)
      if (Array.isArray(value)) return value.map(v => stripCircular(v, seen))
      const out: Record<string, unknown> = {}
      for (const k of Object.keys(value)) {
        try { out[k] = stripCircular((value as any)[k], seen) }
        catch { out[k] = '[Unserialisable]' }
      }
      return out
    }

    async function run() {
      try {
        // ── Gate 1-3: server-side state, one fetch ──────────────────
        const res = await fetch(`/api/workspaces/${workspaceId}/agents/${agentId}/vapi`)
        if (!res.ok) {
          const body = await res.text().catch(() => '')
          throw new Error(`Could not load voice config (${res.status}): ${body.slice(0, 200)}`)
        }
        const cfg = await res.json()
        if (cancelled) return

        // Engine configured?
        const publicKey = cfg.vapiPublicKey || cfg.publicKey
        if (!publicKey) {
          setGates(g => ({ ...g, engine: 'failed', assistant: 'failed', quota: 'failed', mic: 'failed' }))
          setGateError('Voice isn\'t configured on this deployment (missing VAPI_PUBLIC_KEY). Contact support — this is a platform-side setting, not something in your agent.')
          return
        }
        setGates(g => ({ ...g, engine: 'ok' }))

        // Quota?
        if (cfg.voiceQuota?.blocked) {
          setGates(g => ({ ...g, quota: 'failed' }))
          setQuotaInfo({
            used: cfg.voiceQuota.used ?? 0,
            limit: cfg.voiceQuota.limit ?? 0,
            planLabel: cfg.voiceQuota.planLabel ?? 'your current plan',
            code: cfg.voiceQuota.code ?? 'VOICE_QUOTA_EXCEEDED',
            message: cfg.voiceQuota.message ?? '',
          })
          setPhase('quota_blocked')
          return
        }
        setGates(g => ({ ...g, quota: 'ok' }))

        // Assistant registered? Self-heal instead of telling the user
        // to go find the Configuration tab and press Save.
        let assistantId = cfg.vapiAssistantId as string | null
        if (!assistantId) {
          setGates(g => ({ ...g, assistant: 'fixing' }))
          const syncRes = await fetch(`/api/workspaces/${workspaceId}/agents/${agentId}/vapi`, { method: 'PATCH' })
          const syncBody = await syncRes.json().catch(() => ({}))
          if (cancelled) return
          if (!syncRes.ok || !syncBody.vapiAssistantId) {
            setGates(g => ({ ...g, assistant: 'failed' }))
            setGateError(syncBody.error
              ? `The voice provider rejected this agent's configuration: ${syncBody.error}`
              : 'Could not register this agent with the voice provider. Try again in a moment.')
            return
          }
          assistantId = syncBody.vapiAssistantId
        }
        setGates(g => ({ ...g, assistant: 'ok' }))

        // ── Gate 4: microphone ───────────────────────────────────────
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
          stream.getTracks().forEach(t => t.stop())
        } catch {
          if (cancelled) return
          setGates(g => ({ ...g, mic: 'failed' }))
          setGateError('Microphone access was blocked. Click the lock icon in your browser\'s address bar, allow the microphone, then retry.')
          return
        }
        if (cancelled) return
        setGates(g => ({ ...g, mic: 'ok' }))

        // ── All gates green — now the ring is real ───────────────────
        setPhase('ringing')
        const vapi = await getVapi(publicKey)
        vapiRef.current = vapi

        vapi.on('message', (msg: any) => {
          if (msg?.type === 'transcript' && msg.transcriptType === 'final') {
            setTranscript(prev => [...prev, { role: msg.role || 'assistant', text: msg.transcript }])
          }
        })
        vapi.on('call-start', () => { if (!cancelled) setPhase('live') })
        vapi.on('call-end', () => { if (!cancelled) setPhase(p => (p === 'error' ? p : 'ended')) })
        vapi.on('error', (e: any) => {
          if (cancelled) return
          setPhase('error')
          const msg = e?.errorMsg || e?.error?.message || e?.message
          const friendly = /ejection|Meeting has ended/i.test(String(msg))
            ? "The call ended unexpectedly. We've captured the full error payload server-side for our team to investigate — try again in a moment."
            : (msg ?? 'Voice call error')
          setErrMsg(friendly)
          // Post the full error payload so the next "still failing"
          // report has actionable detail captured server-side.
          try {
            fetch('/api/voice/diagnostic', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                workspaceId,
                agentId,
                vapiAssistantId: assistantId,
                errorType: e?.type || 'unknown',
                errorPayload: { errorMsg: msg, action: e?.action, raw: stripCircular(e) },
                userAgent: navigator.userAgent,
              }),
            }).catch(() => {})
          } catch {}
        })

        // Per-session overrides: opening line + the {{callContext}}
        // slot in the registered prompt + ids the webhook needs for
        // tool dispatch and minute accounting.
        const overrides: Record<string, unknown> = {
          variableValues: {
            workspaceId,
            agentId,
            direction: 'browser-test',
            callContext: 'This is a browser-based TEST call: the person speaking is the business owner trying out your behaviour, not a real customer. Behave exactly as you would on a real call.',
          },
        }
        if (firstMessage) overrides.firstMessage = firstMessage

        await vapi.start(assistantId, overrides)
      } catch (err: any) {
        if (!cancelled) {
          setPhase('error')
          setErrMsg(err.message ?? 'Failed to start call')
        }
      }
    }

    run()
    return () => {
      cancelled = true
      try { vapiRef.current?.stop?.() } catch {}
    }
  }, [workspaceId, agentId, firstMessage, attempt])

  const mmss = `${String(Math.floor(elapsed / 60)).padStart(2, '0')}:${String(elapsed % 60).padStart(2, '0')}`
  const gateFailed = gateError !== null

  function hangUp() {
    try { vapiRef.current?.stop?.() } catch {}
    onHangUp()
  }

  function retry() {
    setGates({ engine: 'checking', assistant: 'checking', quota: 'checking', mic: 'checking' })
    setGateError(null)
    setErrMsg(null)
    setTranscript([])
    setElapsed(0)
    setPhase('preflight')
    setAttempt(a => a + 1)
  }

  if (phase === 'quota_blocked' && quotaInfo) {
    return (
      <div className="p-6">
        <VoiceQuotaBlockedScreen
          workspaceId={workspaceId}
          code={quotaInfo.code}
          used={quotaInfo.used}
          limit={quotaInfo.limit}
          planLabel={quotaInfo.planLabel}
          message={quotaInfo.message || null}
        />
        <div className="text-center mt-4">
          <button onClick={onHangUp} className="text-xs px-4 py-2" style={{ color: 'var(--text-tertiary)' }}>Close</button>
        </div>
      </div>
    )
  }

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
          {phase === 'preflight' && !gateFailed && 'Checking everything\'s ready…'}
          {phase === 'preflight' && gateFailed && 'Can\'t start the call yet'}
          {phase === 'ringing' && 'Calling…'}
          {phase === 'live' && `Connected · ${mmss}`}
          {phase === 'ended' && `Call ended · ${mmss}`}
          {phase === 'error' && 'Call failed'}
        </p>
      </div>

      {phase === 'preflight' && (
        <div className="rounded-xl p-3 space-y-2" style={{ background: 'var(--surface-secondary)', border: '1px solid var(--border)' }}>
          <PreflightRow state={gates.engine} label="Voice engine configured" />
          <PreflightRow state={gates.quota} label="Voice minutes available" />
          <PreflightRow state={gates.assistant} label="Agent synced with voice provider" fixingLabel="Syncing agent…" />
          <PreflightRow state={gates.mic} label="Microphone access" />
          {gateError && (
            <div className="pt-2 mt-1" style={{ borderTop: '1px solid var(--border)' }}>
              <p className="text-[11px] leading-relaxed mb-2" style={{ color: '#ef4444' }}>{gateError}</p>
              <button
                onClick={retry}
                className="w-full px-3 py-2 rounded-lg text-xs font-semibold"
                style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}
              >
                Retry checks
              </button>
            </div>
          )}
        </div>
      )}

      {(phase === 'live' || phase === 'ringing' || phase === 'ended') && (
        <div className="rounded-xl p-3" style={{ background: 'var(--surface-secondary)', border: '1px solid var(--border)' }}>
          <div className="space-y-1.5 max-h-48 overflow-y-auto text-sm">
            {transcript.length === 0 ? (
              <p className="text-xs italic" style={{ color: 'var(--text-tertiary)' }}>
                {phase === 'ringing' ? 'Say hello once it picks up — transcript appears here.' : 'Transcript will appear here as the call progresses…'}
              </p>
            ) : transcript.map((line, i) => (
              <div key={i}>
                <span className="text-[10px] font-semibold uppercase tracking-wider mr-2" style={{ color: 'var(--text-tertiary)' }}>{line.role}</span>
                <span style={{ color: 'var(--text-primary)' }}>{line.text}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {phase === 'error' && (
        <div className="rounded-xl p-3 space-y-2" style={{ background: 'var(--surface-secondary)', border: '1px solid var(--border)' }}>
          <p className="text-[11px] leading-relaxed" style={{ color: '#ef4444' }}>{errMsg}</p>
          <button
            onClick={retry}
            className="w-full px-3 py-2 rounded-lg text-xs font-semibold"
            style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}
          >
            Try again
          </button>
        </div>
      )}

      <div className="text-center mt-5">
        {phase === 'ended' ? (
          <div className="space-y-2">
            <button
              onClick={retry}
              className="px-5 py-2.5 rounded-xl text-sm font-semibold"
              style={{ background: '#fa4d2e', color: '#ffffff' }}
            >
              Call again
            </button>
            <div>
              <button onClick={onHangUp} className="text-xs px-4 py-2" style={{ color: 'var(--text-tertiary)' }}>Close</button>
            </div>
          </div>
        ) : (
          <button
            onClick={hangUp}
            className="w-14 h-14 rounded-full text-white inline-flex items-center justify-center transition-colors hover:opacity-90"
            style={{ background: '#ef4444', boxShadow: '0 4px 20px -4px rgba(239,68,68,0.4)' }}
            title={phase === 'live' || phase === 'ringing' ? 'End call' : 'Close'}
            aria-label={phase === 'live' || phase === 'ringing' ? 'End call' : 'Close'}
          >
            <svg className="w-6 h-6 rotate-[135deg]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
            </svg>
          </button>
        )}
      </div>
    </div>
  )
}

function PreflightRow({ state, label, fixingLabel }: { state: GateState; label: string; fixingLabel?: string }) {
  return (
    <div className="flex items-center gap-2 text-xs" style={{ color: 'var(--text-secondary)' }}>
      <span className="w-4 text-center shrink-0" aria-hidden>
        {state === 'ok' && <span style={{ color: '#22c55e' }}>✓</span>}
        {state === 'failed' && <span style={{ color: '#ef4444' }}>✕</span>}
        {(state === 'checking' || state === 'fixing') && (
          <span className="inline-block w-3 h-3 rounded-full border-2 border-t-transparent animate-spin align-middle" style={{ borderColor: 'var(--text-tertiary)', borderTopColor: 'transparent' }} />
        )}
      </span>
      <span>{state === 'fixing' && fixingLabel ? fixingLabel : label}</span>
    </div>
  )
}

// Module-level Vapi SDK singleton. Loading @vapi-ai/web more than
// once in a session triggers a "KrispSDK is duplicated" warning
// (Krisp is bundled inside Vapi's Daily.co transport layer and only
// tolerates one global instance). Caching the dynamic import + the
// Vapi instance per public key keeps the SDK loaded exactly once
// across re-renders, React strict-mode double-mounts, etc.
let _vapiSdkPromise: Promise<any> | null = null
let _vapiInstance: { key: string; instance: any } | null = null
async function getVapi(publicKey: string): Promise<any> {
  if (_vapiInstance?.key === publicKey) return _vapiInstance.instance
  if (!_vapiSdkPromise) _vapiSdkPromise = import('@vapi-ai/web').then(m => m.default)
  const Vapi = await _vapiSdkPromise
  const instance = new Vapi(publicKey)
  _vapiInstance = { key: publicKey, instance }
  return instance
}

// ─── Gemini browser call ─────────────────────────────────────────────

/**
 * Gemini-runtime browser test screen. Uses the shared useGeminiTestCall
 * hook (same code path as the config panel's Test-voice button) and
 * auto-starts on mount. No "isn't synced" precondition — Gemini agents
 * are live the moment they're created; this just opens a mic +
 * WebSocket session inside the same phone shell the Vapi path uses.
 */
function GeminiBrowserScreen({
  workspaceId, agentId, agentName, onHangUp,
}: VoicePhoneCallUIProps & { onHangUp: () => void }) {
  const { callState, callError, transcript, startCall, endCall } = useGeminiTestCall(workspaceId, agentId)

  useEffect(() => {
    void startCall()
    return () => { void endCall() }
    // Start exactly once when this screen mounts; the hook is stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const statusLabel =
    callState === 'live' ? 'Listening'
    : callState === 'connecting' ? 'Connecting…'
    : callState === 'error' ? 'Error'
    : 'Call ended'

  function hangUp() {
    void endCall()
    onHangUp()
  }

  return (
    <div className="p-6">
      <div className="flex flex-col items-center mb-5">
        <div className="relative mb-3">
          {callState === 'connecting' && (
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
        <p className="text-xs mt-0.5" style={{ color: 'var(--text-tertiary)' }}>{statusLabel}</p>
      </div>

      <div className="rounded-xl p-3" style={{ background: 'var(--surface-secondary)', border: '1px solid var(--border)' }}>
        {callError && (
          <p className="text-[11px] mb-2" style={{ color: '#ef4444' }}>{callError}</p>
        )}
        <div className="space-y-1.5 max-h-48 overflow-y-auto text-sm">
          {transcript.length === 0 ? (
            <p className="text-xs italic" style={{ color: 'var(--text-tertiary)' }}>
              {callState === 'live' ? 'Say hello — the agent is listening…' : 'Transcript will appear here as the call progresses…'}
            </p>
          ) : transcript.map((line, i) => (
            <div key={i}>
              <span className="text-[10px] font-semibold uppercase tracking-wider mr-2" style={{ color: 'var(--text-tertiary)' }}>{line.role}</span>
              <span style={{ color: 'var(--text-primary)' }}>{line.text}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="text-center mt-5">
        <button
          onClick={hangUp}
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

// ─── Outbound call (dial a real number) ──────────────────────────────

function OutboundCallScreen({
  workspaceId, agentId, agentName, locationId, onClose,
}: VoicePhoneCallUIProps & { onClose: () => void }) {
  const [phone, setPhone] = useState('')
  const [country, setCountry] = useState('+1')
  const [phase, setPhase] = useState<'input' | 'dialing' | 'in_progress' | 'ended' | 'error' | 'activating' | 'intl_blocked' | 'quota_blocked'>('input')
  const [errMsg, setErrMsg] = useState<string | null>(null)
  const [quotaInfo, setQuotaInfo] = useState<{ used: number; limit: number; planLabel: string; code: string } | null>(null)
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
      if (!res.ok) {
        // PHONE_NUMBER_ACTIVATING is the common case right after a
        // fresh number purchase. The route already retries server-side
        // once with an 8s backoff; if it still fails we surface a
        // friendly "your number is activating" screen with a retry
        // button instead of dumping the raw Vapi error.
        if (data.code === 'PHONE_NUMBER_ACTIVATING' || res.status === 503) {
          setPhase('activating')
          setErrMsg(data.error || 'Your phone number is still activating with the carrier.')
          return
        }
        // Vapi free-tier numbers can only dial US. International dest
        // numbers (+44, +61, etc.) hit this. Route to its own screen
        // with actionable next steps — add billing on Vapi, or buy a
        // number local to the destination country.
        if (data.code === 'FREE_TIER_INTL_BLOCKED') {
          setPhase('intl_blocked')
          setErrMsg(data.error || null)
          return
        }
        // Workspace over its included voice minutes (or voice not on
        // plan). Show the upgrade card instead of a raw error.
        if (data.code === 'VOICE_QUOTA_EXCEEDED' || data.code === 'VOICE_NOT_ON_PLAN') {
          setPhase('quota_blocked')
          setErrMsg(data.error || null)
          setQuotaInfo({
            used: data.quota?.used ?? 0,
            limit: data.quota?.limit ?? 0,
            planLabel: data.quota?.planLabel ?? 'your current plan',
            code: data.code,
          })
          return
        }
        throw new Error(data.error || `Dial failed (${res.status})`)
      }
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

      {phase === 'activating' && (
        <div className="max-w-sm mx-auto text-center space-y-3">
          <div
            className="rounded-xl p-4 text-sm"
            style={{ background: 'var(--accent-amber-bg)', color: 'var(--accent-amber)' }}
          >
            <p className="font-semibold mb-1">Your number is still activating</p>
            <p className="text-xs leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
              {errMsg ?? 'Carrier wire-up usually takes 30 seconds to 2 minutes. Give it another moment and retry.'}
            </p>
          </div>
          <button
            onClick={dial}
            className="text-sm font-semibold px-5 py-2.5 rounded-lg"
            style={{ background: '#fa4d2e', color: '#ffffff' }}
          >
            Retry dial
          </button>
          <div>
            <button
              onClick={onClose}
              className="text-xs px-4 py-2"
              style={{ color: 'var(--text-tertiary)' }}
            >
              Close
            </button>
          </div>
        </div>
      )}

      {phase === 'intl_blocked' && (
        <div className="max-w-lg mx-auto space-y-4">
          <div
            className="rounded-xl p-4 text-sm"
            style={{ background: 'var(--accent-amber-bg)', color: 'var(--accent-amber)' }}
          >
            <p className="font-semibold mb-1">International calls aren&apos;t enabled on your workspace yet</p>
            <p className="text-xs leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
              The number you tried to dial is outside the country your current voice plan covers. Two ways to unblock:
            </p>
          </div>
          <div className="space-y-2">
            <a
              href="mailto:support@xovera.io?subject=Enable%20international%20voice%20calls"
              className="block rounded-xl p-4 transition-colors hover:opacity-95"
              style={{ background: 'var(--surface-secondary)', border: '1px solid var(--border)' }}
            >
              <div className="flex items-start gap-3">
                <span className="text-lg shrink-0" aria-hidden>💬</span>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-sm" style={{ color: 'var(--text-primary)' }}>
                    Contact support to enable international outbound
                  </p>
                  <p className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>
                    We&apos;ll switch your workspace onto our international voice plan. Per-minute rates apply (a few cents/min, depending on the destination). Your existing number keeps working — no config changes on your side.
                  </p>
                </div>
                <span className="text-xs" style={{ color: 'var(--text-tertiary)' }} aria-hidden>↗</span>
              </div>
            </a>
            <Link
              href={`/dashboard/${workspaceId}/voice/${agentId}/configuration`}
              className="block rounded-xl p-4 transition-colors hover:opacity-95"
              style={{ background: 'var(--surface-secondary)', border: '1px solid var(--border)' }}
            >
              <div className="flex items-start gap-3">
                <span className="text-lg shrink-0" aria-hidden>📞</span>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-sm" style={{ color: 'var(--text-primary)' }}>
                    Provision a number in the destination country
                  </p>
                  <p className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>
                    Customers see a local caller ID and there are no international fees on the call leg itself. Open the agent&apos;s Configuration tab to add an AU / GB / CA / NZ number.
                  </p>
                </div>
              </div>
            </Link>
          </div>
          <div className="flex items-center justify-between pt-1">
            <button
              onClick={() => setPhase('input')}
              className="text-xs px-3 py-2"
              style={{ color: 'var(--text-tertiary)' }}
            >
              ← Change number
            </button>
            <button
              onClick={dial}
              className="text-xs font-semibold px-4 py-2 rounded-lg"
              style={{ background: '#fa4d2e', color: '#ffffff' }}
            >
              Retry dial
            </button>
          </div>
        </div>
      )}

      {phase === 'quota_blocked' && (
        <VoiceQuotaBlockedScreen
          workspaceId={workspaceId}
          code={quotaInfo?.code || 'VOICE_QUOTA_EXCEEDED'}
          used={quotaInfo?.used ?? 0}
          limit={quotaInfo?.limit ?? 0}
          planLabel={quotaInfo?.planLabel || 'your current plan'}
          message={errMsg}
          onChangeNumber={() => setPhase('input')}
        />
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

// ─── Voice-quota blocked (shared by outbound + browser screens) ──────

/**
 * Rendered when the workspace has hit its voice-minute quota or voice
 * isn't on the current plan. Brand-neutral copy + a single "Upgrade
 * plan" CTA that lands on the workspace's billing settings.
 *
 * Two messages depending on the code:
 *   VOICE_NOT_ON_PLAN      → "Voice isn't included on this plan"
 *   VOICE_QUOTA_EXCEEDED   → "You've used your monthly minutes"
 *
 * The "Change number" button only shows for the outbound version
 * (when onChangeNumber is provided); the browser-test version
 * doesn't need it.
 */
function VoiceQuotaBlockedScreen({
  workspaceId, code, used, limit, planLabel, message, onChangeNumber,
}: {
  workspaceId: string
  code: string
  used: number
  limit: number
  planLabel: string
  message: string | null
  onChangeNumber?: () => void
}) {
  const isUpgradeNeeded = code === 'VOICE_NOT_ON_PLAN'
  const title = isUpgradeNeeded
    ? 'Voice isn\'t included on your current plan'
    : 'You\'ve used your monthly voice minutes'
  const billingUrl = `/dashboard/${workspaceId}/settings/billing`
  return (
    <div className="max-w-lg mx-auto space-y-4">
      <div
        className="rounded-xl p-4 text-sm"
        style={{ background: 'var(--accent-amber-bg)', color: 'var(--accent-amber)' }}
      >
        <p className="font-semibold mb-1">{title}</p>
        <p className="text-xs leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
          {message ?? (isUpgradeNeeded
            ? `Your current plan (${planLabel}) doesn't include voice calls. Upgrade to make inbound and outbound calls on this workspace.`
            : `You've used ${used} of ${limit} minutes for this billing period. Upgrade your plan to keep making calls — your agents and configuration stay intact.`
          )}
        </p>
      </div>
      <Link
        href={billingUrl}
        className="block rounded-xl p-4 transition-colors hover:opacity-95"
        style={{ background: 'var(--surface-secondary)', border: '1px solid var(--border)' }}
      >
        <div className="flex items-start gap-3">
          <span className="text-lg shrink-0" aria-hidden>⚡</span>
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-sm" style={{ color: 'var(--text-primary)' }}>
              Upgrade your plan
            </p>
            <p className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>
              {isUpgradeNeeded
                ? 'See plans with voice included. Upgrades take effect immediately — no re-setup needed.'
                : 'See plans with more voice minutes. Upgrades take effect immediately and you can keep dialing right away.'}
            </p>
          </div>
          <span className="text-xs" style={{ color: 'var(--text-tertiary)' }} aria-hidden>→</span>
        </div>
      </Link>
      {onChangeNumber && (
        <div className="flex items-center justify-start pt-1">
          <button
            onClick={onChangeNumber}
            className="text-xs px-3 py-2"
            style={{ color: 'var(--text-tertiary)' }}
          >
            ← Change number
          </button>
        </div>
      )}
    </div>
  )
}
