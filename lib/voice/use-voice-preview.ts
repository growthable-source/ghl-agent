'use client'

/**
 * Shared ▶ behaviour for every voice picker.
 *
 * The wizard and the agent voice config page each grew their own copy of
 * this and drifted twice — once into a `disabled={!previewUrl}` that killed
 * every synthesized voice, once into a fallback that covered Cartesia but
 * not Gemini. One hook, both pickers.
 *
 * Same-origin URLs (our /api/voices/preview synth) are fetched rather than
 * handed to the media element: synth takes a couple of seconds to first
 * byte, and an <audio> element pointed at a slow endpoint reports `stalled`
 * with no way to tell "still working" from "failed". Fetching first gives
 * us the status code, so a 502/503 becomes a message instead of a ▶ that
 * spins forever. Catalogue samples (ElevenLabs CDN) stay on the direct path
 * — they're cross-origin and already instant.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { voicePreviewUrl } from './preview-url'

export function useVoicePreview() {
  const [playingId, setPlayingId] = useState<string | null>(null)
  const [loadingId, setLoadingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const audioRef = useRef<HTMLAudioElement | null>(null)
  const objectUrlRef = useRef<string | null>(null)
  // Bumped on every play/stop so a slow in-flight sample can tell it has
  // been superseded and drop its result instead of hijacking the UI.
  const runRef = useRef(0)

  const release = useCallback(() => {
    audioRef.current?.pause()
    audioRef.current = null
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
        let src = url
        if (url.startsWith('/')) {
          const res = await fetch(url)
          if (!res.ok) {
            throw new Error(
              res.status === 503
                ? 'Voice previews aren’t configured on this deployment.'
                : 'Could not generate a sample for that voice.',
            )
          }
          const objectUrl = URL.createObjectURL(await res.blob())
          if (run !== runRef.current) {
            URL.revokeObjectURL(objectUrl)
            return
          }
          objectUrlRef.current = objectUrl
          src = objectUrl
        }

        const audio = new Audio(src)
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
