/**
 * Tiny notification ping for "new message arrived" cues.
 *
 * Generated via Web Audio API rather than a bundled MP3 — no asset to
 * ship, no MIME-type quirks, no autoplay-policy fights with cached
 * audio. Two short tones with quick decay so it reads as a "ding"
 * (high pitch, perceived as good news) rather than an alarm.
 *
 * Browser audio gotchas this handles:
 *   - AudioContext can only start after a user gesture. We construct it
 *     lazily on first play() call. If the user has never interacted with
 *     the page, the call no-ops silently rather than crashing.
 *   - Concurrent sounds (two messages arriving within 200ms) are
 *     debounced via THROTTLE_MS so the page doesn't sound like a
 *     pinball machine.
 *   - Mute preference is persisted in localStorage keyed by the
 *     caller-supplied scope ("widget" / "inbox") so each surface
 *     has its own toggle independent of the other.
 */

const THROTTLE_MS = 600

let ctx: AudioContext | null = null
let lastPlayedAtByScope = new Map<string, number>()

function getOrCreateAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null
  if (ctx && ctx.state !== 'closed') return ctx
  try {
    // Safari uses webkitAudioContext on older versions.
    type AudioContextCtor = typeof AudioContext
    const Ctor = (window.AudioContext ||
      (window as Window & { webkitAudioContext?: AudioContextCtor }).webkitAudioContext) as AudioContextCtor | undefined
    if (!Ctor) return null
    ctx = new Ctor()
    return ctx
  } catch {
    return null
  }
}

export function isNotificationSoundMuted(scope: 'widget' | 'inbox'): boolean {
  if (typeof window === 'undefined') return false
  try {
    return localStorage.getItem(`${scope}-sound-muted`) === '1'
  } catch {
    return false
  }
}

export function setNotificationSoundMuted(scope: 'widget' | 'inbox', muted: boolean): void {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(`${scope}-sound-muted`, muted ? '1' : '0')
  } catch {
    /* localStorage disabled — quietly accept */
  }
}

/**
 * Play the notification ping. Returns true if the sound played, false
 * if it was throttled, muted, or audio is unavailable.
 *
 * Two stacked tones: a brief 880Hz pulse followed by a 1320Hz pulse —
 * a perfect-fifth interval that reads as "complete / arrived" rather
 * than "warning / wrong."
 */
export function playNotificationSound(scope: 'widget' | 'inbox'): boolean {
  if (isNotificationSoundMuted(scope)) return false

  const now = Date.now()
  const last = lastPlayedAtByScope.get(scope) ?? 0
  if (now - last < THROTTLE_MS) return false
  lastPlayedAtByScope.set(scope, now)

  const audio = getOrCreateAudioContext()
  if (!audio) return false

  // AudioContext can be 'suspended' if user hasn't interacted yet —
  // resume() returns a promise that resolves once unlocked. We don't
  // await it because we want to fire-and-forget; if it's still
  // suspended at start time the tones won't be audible, but that
  // mirrors browser policy. After the first user gesture on the page
  // it'll play normally.
  if (audio.state === 'suspended') {
    audio.resume().catch(() => { /* ignore */ })
  }

  const now0 = audio.currentTime
  playTone(audio, 880, now0, 0.12)
  playTone(audio, 1320, now0 + 0.08, 0.10)
  return true
}

function playTone(audio: AudioContext, freq: number, startAt: number, duration: number) {
  const osc = audio.createOscillator()
  const gain = audio.createGain()
  osc.type = 'sine'
  osc.frequency.value = freq
  // Quick attack + exponential decay — sounds like a "ping" rather
  // than a sustained beep. Cap peak at 0.18 so it's noticeable
  // without being startling.
  gain.gain.setValueAtTime(0, startAt)
  gain.gain.linearRampToValueAtTime(0.18, startAt + 0.01)
  gain.gain.exponentialRampToValueAtTime(0.001, startAt + duration)
  osc.connect(gain).connect(audio.destination)
  osc.start(startAt)
  osc.stop(startAt + duration + 0.02)
}
