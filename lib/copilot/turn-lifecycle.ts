/**
 * Content-free per-turn observability and participation state.
 *
 * This deliberately never accepts transcript or audio data. Callers emit
 * only state/stage timestamps, so production latency traces can be joined by
 * traceId without copying meeting content into logs.
 */

export type CopilotParticipationState = 'PASSIVE' | 'ADDRESSED' | 'RESPONDING' | 'INTERRUPTED'

export type CopilotLatencyStage =
  | 'input_transcript_first'
  | 'input_transcript_final'
  | 'response_audio_received'
  | 'playback_scheduled'
  | 'tool_call_started'
  | 'tool_call_completed'
  | 'screen_frame_received'
  | 'interrupted'
  | 'turn_complete'
  | 'self_echo_suppressed'

export interface CopilotLatencyEvent {
  traceId: string
  stage: CopilotLatencyStage
  atMs: number
  elapsedMs: number
  state: CopilotParticipationState
}

export interface TurnLifecycleOptions {
  now?: () => number
  createTraceId?: () => string
  followUpWindowMs?: number
  onEvent?: (event: CopilotLatencyEvent) => void
  onStateChange?: (state: CopilotParticipationState) => void
}

const defaultTraceId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `turn-${Date.now()}-${Math.random().toString(36).slice(2)}`

export class TurnLifecycle {
  private readonly now: () => number
  private readonly createTraceId: () => string
  private readonly followUpWindowMs: number
  private readonly onEvent?: (event: CopilotLatencyEvent) => void
  private readonly onStateChange?: (state: CopilotParticipationState) => void
  private traceId: string | null = null
  private traceStartedAt = 0
  private emitted = new Set<CopilotLatencyStage>()
  private followUpUntil = 0
  private currentState: CopilotParticipationState = 'PASSIVE'

  constructor(options: TurnLifecycleOptions = {}) {
    this.now = options.now ?? Date.now
    this.createTraceId = options.createTraceId ?? defaultTraceId
    this.followUpWindowMs = options.followUpWindowMs ?? 8_000
    this.onEvent = options.onEvent
    this.onStateChange = options.onStateChange
  }

  get state(): CopilotParticipationState {
    return this.currentState
  }

  get followUpActive(): boolean {
    return this.now() <= this.followUpUntil
  }

  userTranscript(final: boolean): void {
    this.ensureTrace()
    this.setState('ADDRESSED')
    this.emit('input_transcript_first')
    if (final) this.emit('input_transcript_final')
  }

  responseAudio(): void {
    this.ensureTrace()
    this.setState('RESPONDING')
    this.emit('response_audio_received')
  }

  playbackScheduled(): void {
    this.ensureTrace()
    this.emit('playback_scheduled')
  }

  toolCallStarted(): void {
    this.ensureTrace()
    this.emit('tool_call_started')
  }

  toolCallCompleted(): void {
    if (this.traceId) this.emit('tool_call_completed')
  }

  screenFrameReceived(): void {
    if (this.traceId) this.emit('screen_frame_received')
  }

  interrupted(): void {
    this.ensureTrace()
    this.setState('INTERRUPTED')
    this.emit('interrupted')
  }

  selfEchoSuppressed(): void {
    this.ensureTrace()
    this.emit('self_echo_suppressed')
  }

  turnComplete(): void {
    if (!this.traceId) return
    this.emit('turn_complete')
    this.followUpUntil = this.now() + this.followUpWindowMs
    this.traceId = null
    this.emitted.clear()
    this.setState('PASSIVE')
  }

  private ensureTrace(): void {
    if (this.traceId) return
    this.traceId = this.createTraceId()
    this.traceStartedAt = this.now()
    this.emitted.clear()
  }

  private emit(stage: CopilotLatencyStage): void {
    if (!this.traceId || this.emitted.has(stage)) return
    this.emitted.add(stage)
    const atMs = this.now()
    this.onEvent?.({
      traceId: this.traceId,
      stage,
      atMs,
      elapsedMs: Math.max(0, atMs - this.traceStartedAt),
      state: this.currentState,
    })
  }

  private setState(state: CopilotParticipationState): void {
    if (this.currentState === state) return
    this.currentState = state
    this.onStateChange?.(state)
  }
}

/** Best-effort echo classification for mixed meeting audio.
 *
 * Recall exposes one mixed browser microphone to the webpage, not
 * participant-isolated tracks. Browser AEC is the primary defence; this
 * textual check prevents recent assistant output echoed back through that
 * mixed route from activating the application state a second time.
 */
export function isLikelySelfEcho(input: string, recentOutput: string): boolean {
  const normalize = (value: string) =>
    value
      .toLocaleLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim()

  const heard = normalize(input)
  const spoken = normalize(recentOutput)
  if (heard.length < 8 || spoken.length < 8) return false
  if (spoken.includes(heard) || heard.includes(spoken)) return true

  const heardTokens = new Set(heard.split(' '))
  const spokenTokens = new Set(spoken.split(' '))
  let overlap = 0
  for (const token of heardTokens) if (spokenTokens.has(token)) overlap++
  return overlap / Math.max(heardTokens.size, spokenTokens.size) >= 0.8
}

/**
 * Bounded rolling PCM queue used while the Live connection is warming or
 * resuming. Keeping the newest audio preserves a direct address that begins
 * just before activation without allowing an unbounded meeting recording.
 */
export class RollingPreActivationAudio {
  private chunks: Array<{ data: string; bytes: number }> = []
  private totalBytes = 0

  constructor(private readonly maxBytes: number) {}

  push(data: string): void {
    const bytes = Math.floor((data.length * 3) / 4)
    this.chunks.push({ data, bytes })
    this.totalBytes += bytes
    while (this.totalBytes > this.maxBytes && this.chunks.length > 1) {
      const dropped = this.chunks.shift()
      if (dropped) this.totalBytes -= dropped.bytes
    }
  }

  drain(): string[] {
    const data = this.chunks.map(chunk => chunk.data)
    this.clear()
    return data
  }

  clear(): void {
    this.chunks = []
    this.totalBytes = 0
  }

  get byteLength(): number {
    return this.totalBytes
  }
}
