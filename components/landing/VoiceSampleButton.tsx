'use client'

import { useEffect, useRef, useState } from 'react'

/**
 * Plays a short pre-rendered voice sample (public/voice-ai-sample.mp3) so a
 * visitor can hear what the AI sounds like. Styled for a dark band.
 */
export default function VoiceSampleButton({ src = '/voice-ai-sample.mp3' }: { src?: string }) {
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const [playing, setPlaying] = useState(false)

  useEffect(() => {
    const a = new Audio(src)
    a.preload = 'none'
    a.addEventListener('ended', () => setPlaying(false))
    a.addEventListener('pause', () => setPlaying(false))
    a.addEventListener('play', () => setPlaying(true))
    audioRef.current = a
    return () => { a.pause(); audioRef.current = null }
  }, [src])

  function toggle() {
    const a = audioRef.current
    if (!a) return
    if (a.paused) { a.currentTime = a.ended ? 0 : a.currentTime; a.play().catch(() => {}) }
    else a.pause()
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={playing}
      className="inline-flex items-center gap-3 rounded-full pl-2 pr-5 py-2 font-semibold text-[0.9375rem] transition-colors"
      style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.18)', color: '#fff' }}
    >
      <span
        className="flex items-center justify-center rounded-full"
        style={{ width: '2.25rem', height: '2.25rem', background: 'linear-gradient(135deg, #fa4d2e, #fb8e4a)' }}
      >
        {playing ? (
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="#fff"><rect x="6" y="5" width="4" height="14" rx="1" /><rect x="14" y="5" width="4" height="14" rx="1" /></svg>
        ) : (
          <svg className="w-4 h-4 ml-0.5" viewBox="0 0 24 24" fill="#fff"><path d="M8 5v14l11-7z" /></svg>
        )}
      </span>
      {playing ? (
        <span className="flex items-end gap-[3px] h-4" aria-hidden>
          {[0, 1, 2, 3].map((i) => (
            <span key={i} className="w-[3px] rounded-full eq-bar" style={{ background: '#fb8e4a', animationDelay: `${i * 0.15}s` }} />
          ))}
        </span>
      ) : (
        'Hear a sample'
      )}
    </button>
  )
}
