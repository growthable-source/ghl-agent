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
const lastPlayedAtByScope = new Map<string, number>()
let gestureRegistered = false

type AudioContextCtor = typeof AudioContext

function rawCreate(): AudioContext | null {
  if (typeof window === 'undefined') return null
  try {
    const Ctor = (window.AudioContext ||
      (window as Window & { webkitAudioContext?: AudioContextCtor }).webkitAudioContext) as AudioContextCtor | undefined
    if (!Ctor) return null
    return new Ctor()
  } catch {
    return null
  }
}

/**
 * Browser autoplay policy: an AudioContext created BEFORE the first
 * user gesture is born suspended and never resumes — even calling
 * resume() later from outside a gesture handler doesn't help. Symptom:
 * the very first agent reply / visitor message plays silently because
 * the context was created at module-load time, before the user has
 * clicked anything.
 *
 * The reliable fix: register one-shot gesture listeners at module
 * load. The FIRST click/keydown/touchstart anywhere on the page
 * creates the AudioContext inside that gesture's call stack, where
 * resume() is permitted. After that, subsequent play() calls work.
 *
 * Idempotent — installs listeners once per page load, then auto-cleans.
 */
function ensureGestureListeners(): void {
  if (gestureRegistered || typeof window === 'undefined') return
  gestureRegistered = true

  const unlock = () => {
    if (!ctx || ctx.state === 'closed') ctx = rawCreate()
    if (ctx && ctx.state === 'suspended') {
      // resume() needs to be called inside the gesture handler's
      // call stack — that's exactly where we are right now.
      ctx.resume().catch(() => { /* ignore */ })
    }
    window.removeEventListener('pointerdown', unlock)
    window.removeEventListener('keydown', unlock)
    window.removeEventListener('touchstart', unlock)
  }

  window.addEventListener('pointerdown', unlock, { once: true })
  window.addEventListener('keydown', unlock, { once: true })
  window.addEventListener('touchstart', unlock, { once: true, passive: true })
}

function getOrCreateAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null
  ensureGestureListeners()
  if (ctx && ctx.state !== 'closed') return ctx
  ctx = rawCreate()
  return ctx
}

// Register gesture listeners on module import so the AudioContext is
// ready to resume the moment the user clicks/types/taps anywhere —
// not lazily on the first playNotificationSound call (which might
// happen AFTER the gesture already fired and was missed).
if (typeof window !== 'undefined') {
  ensureGestureListeners()
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

/** Persisted volume on a 0–1 scale (default 0.8). Scales the tone peak. */
export function getNotificationVolume(scope: 'widget' | 'inbox'): number {
  if (typeof window === 'undefined') return 0.8
  try {
    const raw = localStorage.getItem(`${scope}-sound-volume`)
    if (raw === null) return 0.8
    const n = Number(raw)
    return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0.8
  } catch {
    return 0.8
  }
}

export function setNotificationVolume(scope: 'widget' | 'inbox', volume: number): void {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(`${scope}-sound-volume`, String(Math.min(1, Math.max(0, volume))))
  } catch {
    /* localStorage disabled — quietly accept */
  }
}

/**
 * 'message' — the soft two-tone ding for an arriving message.
 * 'assignment' — a louder, distinct rising three-note motif for "a chat
 * was just assigned to you", so it cuts through and means something
 * different from a normal message.
 */
export type SoundVariant = 'message' | 'assignment'
const BASE_PEAK: Record<SoundVariant, number> = { message: 0.26, assignment: 0.45 }

/**
 * Play the notification ping. Returns true if the sound played, false
 * if it was throttled, muted, or audio is unavailable.
 *
 * Two stacked tones: a brief 880Hz pulse followed by a 1320Hz pulse —
 * a perfect-fifth interval that reads as "complete / arrived" rather
 * than "warning / wrong."
 */
export function playNotificationSound(
  scope: 'widget' | 'inbox',
  opts: { variant?: SoundVariant } = {},
): boolean {
  if (isNotificationSoundMuted(scope)) return false

  const variant = opts.variant ?? 'message'
  // Throttle per variant so an assignment ping isn't swallowed by a
  // message ping that fired moments earlier (and vice versa).
  const throttleKey = `${scope}:${variant}`
  const now = Date.now()
  const last = lastPlayedAtByScope.get(throttleKey) ?? 0
  if (now - last < THROTTLE_MS) return false
  lastPlayedAtByScope.set(throttleKey, now)

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

  // Scale the peak by the user's volume (floored so a non-muted, very
  // low setting is still faintly audible rather than silent).
  const peak = BASE_PEAK[variant] * (0.25 + 0.75 * getNotificationVolume(scope))
  const t = audio.currentTime
  if (variant === 'assignment') {
    // Rising three-note motif — unmistakably "assigned to you".
    playTone(audio, 660, t, 0.13, peak)
    playTone(audio, 880, t + 0.11, 0.13, peak)
    playTone(audio, 1320, t + 0.23, 0.2, peak)
  } else {
    playTone(audio, 880, t, 0.12, peak)
    playTone(audio, 1320, t + 0.08, 0.1, peak)
  }
  return true
}

function playTone(audio: AudioContext, freq: number, startAt: number, duration: number, peak = 0.18) {
  const osc = audio.createOscillator()
  const gain = audio.createGain()
  osc.type = 'sine'
  osc.frequency.value = freq
  // Quick attack + exponential decay — sounds like a "ping" rather
  // than a sustained beep. `peak` is caller-controlled (variant +
  // volume) so it's noticeable without being startling.
  gain.gain.setValueAtTime(0, startAt)
  gain.gain.linearRampToValueAtTime(peak, startAt + 0.01)
  gain.gain.exponentialRampToValueAtTime(0.001, startAt + duration)
  osc.connect(gain).connect(audio.destination)
  osc.start(startAt)
  osc.stop(startAt + duration + 0.02)
}
