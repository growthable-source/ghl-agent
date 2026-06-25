'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { MergeFieldTextarea } from '@/components/MergeFieldHelper'
import { GeminiLiveProvider } from '@/lib/copilot/providers/gemini-live'
import { MicCapture, PcmPlayer } from '@/lib/copilot/audio-client'
import { GeminiPhoneNumberPanel } from '@/components/voice/GeminiPhoneNumberPanel'

interface GeminiConfig {
  isActive: boolean
  voiceName: string | null
  model: string
  firstMessage: string | null
  endCallMessage: string | null
  maxDurationSecs: number
  recordCalls: boolean
  language: string | null
  // Phone (Plan 2): the Twilio number wired to this agent. Provisioned by
  // the phone panel's POST (persisted immediately, not via the save button).
  twilioNumber: string | null
}

interface VoiceWire {
  voice_id: string
  name: string
  labels: Record<string, string>
  language: string | null
}

type CallState = 'idle' | 'connecting' | 'live' | 'error'
type Turn = { role: 'user' | 'agent'; text: string }

export default function GeminiVoicePanel({
  workspaceId,
  agentId,
}: {
  workspaceId: string
  agentId: string
}) {
  const [config, setConfig] = useState<GeminiConfig | null>(null)
  const [geminiReady, setGeminiReady] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [voices, setVoices] = useState<VoiceWire[]>([])

  // Voice preview (▶ on each voice card). Gemini ships no pre-recorded
  // sample, so we synth one on demand via /api/voices/preview.
  const [previewId, setPreviewId] = useState<string | null>(null)
  const previewAudioRef = useRef<HTMLAudioElement | null>(null)

  const [callState, setCallState] = useState<CallState>('idle')
  const [callError, setCallError] = useState<string | null>(null)
  const turnsRef = useRef<Turn[]>([])
  const providerRef = useRef<GeminiLiveProvider | null>(null)
  const micRef = useRef<MicCapture | null>(null)
  const playerRef = useRef<PcmPlayer | null>(null)
  const startedAtRef = useRef<number>(0)

  // Load config + voice catalogue.
  useEffect(() => {
    let alive = true
    ;(async () => {
      const [cfgRes, voicesRes] = await Promise.all([
        fetch(`/api/workspaces/${workspaceId}/agents/${agentId}/gemini-voice`),
        fetch(`/api/voices?provider=gemini`),
      ])
      const cfg = await cfgRes.json()
      const vs = await voicesRes.json()
      if (!alive) return
      setConfig(cfg.config)
      setGeminiReady(cfg.geminiReady)
      setVoices(vs.voices ?? [])
    })().catch(() => {})
    return () => {
      alive = false
    }
  }, [workspaceId, agentId])

  const patch = (p: Partial<GeminiConfig>) => setConfig(c => (c ? { ...c, ...p } : c))

  const playPreview = useCallback((voiceId: string) => {
    // Toggle off if this voice is already playing.
    if (previewId === voiceId) {
      previewAudioRef.current?.pause()
      previewAudioRef.current = null
      setPreviewId(null)
      return
    }
    previewAudioRef.current?.pause()
    const audio = new Audio(`/api/voices/preview?voice=${encodeURIComponent(voiceId)}`)
    audio.onended = () => setPreviewId(null)
    audio.onerror = () => setPreviewId(null)
    audio.play().catch(() => setPreviewId(null))
    previewAudioRef.current = audio
    setPreviewId(voiceId)
  }, [previewId])

  const save = useCallback(async () => {
    if (!config) return
    setSaving(true)
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/agents/${agentId}/gemini-voice`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(config),
      })
      const json = await res.json()
      if (json.config) setConfig(json.config)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } finally {
      setSaving(false)
    }
  }, [config, workspaceId, agentId])

  const endCall = useCallback(async () => {
    const durationSecs = startedAtRef.current ? (Date.now() - startedAtRef.current) / 1000 : 0
    try {
      await providerRef.current?.close()
    } catch {}
    micRef.current?.stop()
    playerRef.current?.stop()
    providerRef.current = null
    micRef.current = null
    playerRef.current = null
    setCallState('idle')
    // Persist transcript (best-effort).
    if (turnsRef.current.length) {
      void fetch(`/api/voice/gemini/transcript`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ agentId, durationSecs, turns: turnsRef.current }),
      }).catch(() => {})
    }
    turnsRef.current = []
  }, [agentId])

  const startCall = useCallback(async () => {
    setCallError(null)
    setCallState('connecting')
    turnsRef.current = []
    try {
      const res = await fetch(
        `/api/workspaces/${workspaceId}/agents/${agentId}/gemini-voice/token`,
        { method: 'POST' },
      )
      if (!res.ok) {
        const e = await res.json().catch(() => ({}))
        throw new Error(e.error || 'Could not start voice session')
      }
      const { connection, tools, vendorConfig } = await res.json()

      const provider = new GeminiLiveProvider()
      const player = new PcmPlayer()
      await player.start()
      const mic = new MicCapture(chunk => provider.sendAudioChunk(chunk))

      provider.onAudioOutput = pcm => player.enqueue(pcm)
      provider.onInterrupted = () => player.flush()
      provider.onTranscript = turn => {
        if (turn.final) turnsRef.current.push({ role: turn.role, text: turn.text })
      }
      provider.onToolCall = async call => {
        const r = await fetch(`/api/voice/gemini/tool`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ agentId, name: call.name, args: call.args }),
        })
        return await r.json().catch(() => ({ error: 'tool failed' }))
      }
      provider.onError = msg => {
        setCallError(msg)
        setCallState('error')
      }
      provider.onEnded = () => {
        void endCall()
      }

      await provider.connect({ connection, tools, vendorConfig })
      await mic.start()
      providerRef.current = provider
      micRef.current = mic
      playerRef.current = player
      startedAtRef.current = Date.now()
      setCallState('live')
    } catch (err) {
      setCallError(err instanceof Error ? err.message : 'Voice session failed')
      setCallState('error')
      micRef.current?.stop()
      playerRef.current?.stop()
    }
  }, [workspaceId, agentId, endCall])

  useEffect(() => () => void endCall(), [endCall])
  useEffect(() => () => { previewAudioRef.current?.pause() }, [])

  if (!config) {
    return <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>Loading Gemini voice…</p>
  }

  return (
    <div className="space-y-5">
      {!geminiReady && (
        <div className="rounded-lg border px-4 py-3" style={{ borderColor: 'var(--accent-red)', background: 'var(--surface-secondary)' }}>
          <p className="text-xs" style={{ color: 'var(--accent-red)' }}>
            Gemini voice isn&apos;t configured on the server yet (missing API key). You can edit settings, but test calls won&apos;t connect.
          </p>
        </div>
      )}

      {/* Enable */}
      <div className="flex items-center justify-between rounded-xl border px-5 py-4" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
        <div>
          <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>Enable Gemini voice</p>
          <p className="text-xs mt-0.5" style={{ color: 'var(--text-tertiary)' }}>Native speech-to-speech — the most human-sounding option.</p>
        </div>
        <button type="button" onClick={() => patch({ isActive: !config.isActive })}
          className="relative inline-flex h-6 w-11 rounded-full border-2 border-transparent transition-colors"
          style={{ background: config.isActive ? 'var(--accent-emerald)' : 'var(--toggle-off-bg)' }}>
          <span className={`inline-block h-5 w-5 transform rounded-full shadow transition-transform ${config.isActive ? 'translate-x-5' : 'translate-x-0'}`} style={{ background: '#fff' }} />
        </button>
      </div>

      {/* Voice picker */}
      <div className="rounded-xl border p-5 space-y-3" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
        <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>Voice</p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {voices.map(v => {
            const active = config.voiceName === v.voice_id
            const playing = previewId === v.voice_id
            return (
              <div key={v.voice_id}
                onClick={() => patch({ voiceName: v.voice_id })}
                className="flex items-center gap-2 text-left rounded-lg border px-3 py-2 transition-colors cursor-pointer"
                style={active
                  ? { borderColor: '#fa4d2e', background: 'var(--surface-secondary)' }
                  : { borderColor: 'var(--border)', background: 'transparent' }}>
                <button type="button"
                  onClick={e => { e.stopPropagation(); playPreview(v.voice_id) }}
                  aria-label={playing ? `Stop ${v.name} preview` : `Play ${v.name} preview`}
                  className="w-7 h-7 rounded-full flex items-center justify-center text-[11px] flex-shrink-0 transition-colors"
                  style={{ background: 'var(--surface-tertiary)', color: 'var(--text-primary)' }}>
                  {playing ? '⏸' : '▶'}
                </button>
                <span className="min-w-0">
                  <span className="text-xs font-semibold block" style={{ color: 'var(--text-primary)' }}>{v.name}</span>
                  <span className="text-[10px] block truncate" style={{ color: 'var(--text-tertiary)' }}>{v.labels.description ?? ''}</span>
                </span>
              </div>
            )
          })}
        </div>
        <p className="text-[10px]" style={{ color: 'var(--text-muted)' }}>Tap ▶ to hear a short sample.</p>
      </div>

      {/* First / end message */}
      <div className="rounded-xl border p-5 space-y-4" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
        <div>
          <p className="text-sm font-medium mb-1" style={{ color: 'var(--text-primary)' }}>First message</p>
          <MergeFieldTextarea value={config.firstMessage ?? ''}
            onChange={e => patch({ firstMessage: e.target.value })}
            onValueChange={val => patch({ firstMessage: val })}
            placeholder="Hi, thanks for calling — how can I help?" rows={2} />
        </div>
        <div>
          <p className="text-sm font-medium mb-1" style={{ color: 'var(--text-primary)' }}>End-call message</p>
          <MergeFieldTextarea value={config.endCallMessage ?? ''}
            onChange={e => patch({ endCallMessage: e.target.value })}
            onValueChange={val => patch({ endCallMessage: val })}
            placeholder="Thanks for calling — goodbye!" rows={2} />
        </div>
        <div>
          <p className="text-sm font-medium mb-1" style={{ color: 'var(--text-primary)' }}>Language (optional, BCP-47)</p>
          <input value={config.language ?? ''} onChange={e => patch({ language: e.target.value || null })}
            placeholder="en-US" className="w-full rounded-lg border px-3 py-2 text-sm"
            style={{ borderColor: 'var(--border)', background: 'var(--surface-secondary)', color: 'var(--text-primary)' }} />
        </div>
      </div>

      {/* Phone (Plan 2): provision a Twilio number so PSTN callers reach
          this Gemini agent. Persists immediately via its own POST. */}
      <GeminiPhoneNumberPanel
        workspaceId={workspaceId}
        agentId={agentId}
        currentNumber={config.twilioNumber}
        onProvisioned={(e164) => patch({ twilioNumber: e164 })}
      />

      {/* Save + Test voice */}
      <div className="flex items-center gap-3">
        <button type="button" onClick={save} disabled={saving}
          className="text-xs font-semibold px-4 py-2 rounded-lg transition-colors disabled:opacity-50"
          style={{ background: '#fa4d2e', color: '#ffffff' }}>
          {saving ? 'Saving…' : saved ? 'Saved ✓' : 'Save Gemini voice'}
        </button>

        {callState === 'idle' || callState === 'error' ? (
          <button type="button" onClick={startCall} disabled={!geminiReady}
            className="text-xs font-semibold px-4 py-2 rounded-lg border transition-colors disabled:opacity-40"
            style={{ borderColor: 'var(--border)', color: 'var(--text-primary)', background: 'var(--surface-secondary)' }}>
            🎙 Test voice
          </button>
        ) : (
          <button type="button" onClick={() => void endCall()}
            className="text-xs font-semibold px-4 py-2 rounded-lg transition-colors"
            style={{ background: 'var(--accent-red)', color: '#ffffff' }}>
            {callState === 'connecting' ? 'Connecting… (tap to cancel)' : 'End test call'}
          </button>
        )}
        {callState === 'live' && <span className="text-xs" style={{ color: 'var(--accent-emerald)' }}>● live</span>}
      </div>
      {callError && <p className="text-xs" style={{ color: 'var(--accent-red)' }}>{callError}</p>}
    </div>
  )
}
