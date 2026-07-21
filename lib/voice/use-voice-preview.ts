'use client'

/**
 * Shared ▶ behaviour for every voice picker.
 *
 * The wizard and the agent voice config page each grew their own copy of
 * this and drifted twice — once into a `disabled={!previewUrl}` that killed
 * every synthesized voice, once into a fallback that covered Cartesia but
 * not Gemini. One hook, both pickers.
 *
 * Same-origin samples (our /api/voices/preview synth) are fetched and played
 * through Web Audio rather than handed to an <audio> element. Two reasons,
 * both observed against production:
 *
 *   - Media elements pointed at the synth endpoint sit in `stalled` — first
 *     byte is a couple of seconds out — and their `error` event can't say
 *     why. Fetching gives us the status code, so a 502 (bad voice) or 503
 *     (no API key on this deployment) becomes text instead of a ▶ that
 *     spins forever. decodeAudioData also fails loudly on garbage bytes.
 *   - The same bytes that a media element refused to start decoded and
 *     played fine through an AudioContext.
 *
 * Catalogue samples (ElevenLabs CDN) stay on the media element — they're
 * cross-origin, so fetch would need CORS, and they already work.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { voicePreviewUrl } from './preview-url'

export function useVoicePreview() {
  const [playingId, setPlayingId] = useState<string | null>(null)
  const [loadingId, setLoadingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const audioRef = useRef<HTMLAudioElement | null>(null)
  const objectUrlRef = useRef<string | null>(null)
  const ctxRef = useRef<AudioContext | null>(null)
  const sourceRef = useRef<AudioBufferSourceNode | null>(null)
  // Bumped on every play/stop so a slow in-flight sample can tell it has
  // been superseded and drop its result instead of hijacking the UI.
  const runRef = useRef(0)

  const release = useCallback(() => {
    audioRef.current?.pause()
    audioRef.current = null
    if (sourceRef.current) {
      sourceRef.current.onended = null
      try { sourceRef.current.stop() } catch { /* already stopped */ }
      sourceRef.current = null
    }
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current)
      objectUrlRef.current = null
    }
  }, [])

  useEffect(() => () => release(), [release])

  const stop = useCallback(() => {
    runRef.current++
    release()
    setPlayingId(null)
    setLoadingId(null)
  }, [release])

  const play = useCallback(
    async (provider: string, voiceId: string, catalogueUrl?: string | null) => {
      const url = voicePreviewUrl(provider, voiceId, catalogueUrl)
      if (!url) return
      if (playingId === voiceId || loadingId === voiceId) {
        stop()
        return
      }

      const run = ++runRef.current
      release()
      setError(null)
      setPlayingId(null)
      setLoadingId(voiceId)

      try {
        if (url.startsWith('/')) {
          const res = await fetch(url)
          if (!res.ok) {
            throw new Error(
              res.status === 503
                ? 'Voice previews aren’t configured on this deployment.'
                : 'Could not generate a sample for that voice.',
            )
          }
          const bytes = await res.arrayBuffer()
          if (run !== runRef.current) return

          const ctx =
            ctxRef.current ??
            (ctxRef.current = new (window.AudioContext ||
              (window as any).webkitAudioContext)())
          if (ctx.state === 'suspended') await ctx.resume()
          const buffer = await ctx.decodeAudioData(bytes)
          if (run !== runRef.current) return

          const source = ctx.createBufferSource()
          source.buffer = buffer
          source.connect(ctx.destination)
          source.onended = () => {
            if (run !== runRef.current) return
            release()
            setPlayingId(null)
            setLoadingId(null)
          }
          sourceRef.current = source
          source.start()
          setLoadingId(null)
          setPlayingId(voiceId)
          return
        }

        const audio = new Audio(url)
        audioRef.current = audio
        const finish = () => {
          if (run !== runRef.current) return
          release()
          setPlayingId(null)
          setLoadingId(null)
        }
        audio.onended = finish
        audio.onerror = () => {
          if (run !== runRef.current) return
          finish()
          setError('Could not play that sample.')
        }
        await audio.play()
        if (run !== runRef.current) {
          release()
          return
        }
        setLoadingId(null)
        setPlayingId(voiceId)
      } catch (err: any) {
        if (run !== runRef.current) return
        release()
        setLoadingId(null)
        setPlayingId(null)
        setError(err?.message || 'Could not play that sample.')
      }
    },
    [playingId, loadingId, release, stop],
  )

  /** Can this voice be previewed at all? Drives the button's disabled state. */
  const canPreview = useCallback(
    (provider: string, voiceId: string, catalogueUrl?: string | null) =>
      !!voicePreviewUrl(provider, voiceId, catalogueUrl),
    [],
  )

  return { playingId, loadingId, error, play, stop, canPreview }
}
