'use client'

/**
 * Browser-side Gemini Live test call, shared by every "test this voice
 * agent" surface (the config panel's Test-voice button AND the agent
 * Overview test panel). Previously this lived inline in GeminiVoicePanel,
 * which meant the prominent Overview test button had no Gemini path at all
 * and fell back to the Vapi tester — so a Gemini agent (no Vapi assistant)
 * always errored "isn't synced with the voice provider". One hook, one
 * code path, both surfaces.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { GeminiLiveProvider } from '@/lib/copilot/providers/gemini-live'
import { MicCapture, PcmPlayer } from '@/lib/copilot/audio-client'

export type GeminiCallState = 'idle' | 'connecting' | 'live' | 'error'
export type GeminiTurn = { role: 'user' | 'agent'; text: string }

export function useGeminiTestCall(workspaceId: string, agentId: string) {
  const [callState, setCallState] = useState<GeminiCallState>('idle')
  const [callError, setCallError] = useState<string | null>(null)
  const [transcript, setTranscript] = useState<GeminiTurn[]>([])

  const turnsRef = useRef<GeminiTurn[]>([])
  const providerRef = useRef<GeminiLiveProvider | null>(null)
  const micRef = useRef<MicCapture | null>(null)
  const playerRef = useRef<PcmPlayer | null>(null)
  const startedAtRef = useRef<number>(0)

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
    setTranscript([])
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
        if (!turn.final) return
        turnsRef.current.push({ role: turn.role, text: turn.text })
        setTranscript(prev => [...prev, { role: turn.role, text: turn.text }])
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

  // Safety net: tear the call down if the component unmounts mid-session.
  useEffect(() => () => void endCall(), [endCall])

  return { callState, callError, transcript, startCall, endCall }
}
