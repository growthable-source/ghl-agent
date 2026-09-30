/**
 * Content-free per-turn observability and participation state.
 *
 * This deliberately never accepts transcript or audio data. Callers emit
 * only state/stage timestamps, so production latency traces can be joined by
 * traceId without copying meeting content into logs.
 */

export type CopilotParticipationState = 'PASSIVE' | 'ADDRESSED' | 'RESPONDING' | 'INTERRUPTED'

export type CopilotLatencyStage =
  | 'input_vad_end'
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
  language: 'en' | 'es' | 'code-switch' | 'unknown'
  activation: 'direct' | 'follow_up' | 'one_to_one'
}

export interface TurnLifecycleOptions {
  now?: () => number
  createTraceId?: () => string
  followUpWindowMs?: number
  requireDirectAddress?: boolean
  addressNames?: string[]
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
  private readonly requireDirectAddress: boolean
  private addressNames: string[]
  private readonly onEvent?: (event: CopilotLatencyEvent) => void
  private readonly onStateChange?: (state: CopilotParticipationState) => void
  private traceId: string | null = null
  private traceStartedAt = 0
  private events = new Map<CopilotLatencyStage, Omit<CopilotLatencyEvent, 'elapsedMs'>>()
  private followUpUntil = 0
  private followUpAvailable = false
  private pendingTools = 0
  private toolUsed = false
  private awaitingPostToolAudio = false
  private responseAllowed = false
  private responded = false
  private lastAddressedInputAt = 0
  private currentUtteranceActivated = false
  private language: CopilotLatencyEvent['language'] = 'unknown'
  private activation: CopilotLatencyEvent['activation'] = 'one_to_one'
  private currentState: CopilotParticipationState = 'PASSIVE'

  constructor(options: TurnLifecycleOptions = {}) {
    this.now = options.now ?? Date.now
    this.createTraceId = options.createTraceId ?? defaultTraceId
    this.followUpWindowMs = options.followUpWindowMs ?? 8_000
    this.requireDirectAddress = options.requireDirectAddress ?? false
    this.addressNames = options.addressNames ?? []
    this.onEvent = options.onEvent
    this.onStateChange = options.onStateChange
  }

  get state(): CopilotParticipationState {
    return this.currentState
  }

  get followUpActive(): boolean {
    return this.followUpAvailable && this.now() <= this.followUpUntil
  }

  get canOutput(): boolean {
    return this.responseAllowed && (this.currentState === 'ADDRESSED' || this.currentState === 'RESPONDING')
  }

  setAddressNames(names: string[]): void {
    this.addressNames = names
  }

  /** Permit a deliberate opening/proactive turn. It is not user-latency data. */
  beginSystemTurn(): void {
    this.responseAllowed = true
    this.lastAddressedInputAt = this.now()
    this.setState('ADDRESSED')
  }

  userTranscript(
    text: string,
    final: boolean,
    serverInterrupted = false,
  ): 'direct' | 'follow_up' | 'one_to_one' | 'incidental' {
    if (this.currentUtteranceActivated) {
      this.language = detectTurnLanguage(text)
      this.lastAddressedInputAt = this.now()
      if (final) {
        this.ensureTrace(this.lastAddressedInputAt)
        if (!this.events.has('input_vad_end')) this.record('input_vad_end', this.lastAddressedInputAt)
      }
      return this.activation
    }
    const direct = !this.requireDirectAddress || isDirectAddress(text, this.addressNames)
    const followUp = this.requireDirectAddress && !direct && this.followUpActive && isLikelyFollowUp(text)
    if (!direct && !followUp) {
      if (final) this.setState('PASSIVE')
      return 'incidental'
    }

    this.activation = this.requireDirectAddress ? (direct ? 'direct' : 'follow_up') : 'one_to_one'
    this.language = detectTurnLanguage(text)
    this.responseAllowed = true
    this.currentUtteranceActivated = true
    if (followUp || serverInterrupted) this.followUpAvailable = false
    this.setState('ADDRESSED')
    if (final) {
      this.ensureTrace(this.lastAddressedInputAt)
      if (!this.events.has('input_vad_end')) this.record('input_vad_end', this.lastAddressedInputAt)
    }
    return this.activation
  }

  responseAudio(atMs = this.now()): boolean {
    if (!this.canOutput) return false
    if (!this.traceId && this.lastAddressedInputAt > 0) {
      this.ensureTrace(this.lastAddressedInputAt)
      this.record('input_vad_end', this.lastAddressedInputAt)
    }
    this.setState('RESPONDING')
    this.responded = true
    if (this.traceId && this.pendingTools === 0 && !this.awaitingPostToolAudio) {
      this.record('response_audio_received', atMs)
    } else if (this.traceId && this.awaitingPostToolAudio) {
      this.awaitingPostToolAudio = false
      this.record('response_audio_received', atMs)
    }
    return true
  }

  playbackScheduled(scheduledAtMs: number): void {
    if (this.traceId && this.pendingTools === 0 && !this.awaitingPostToolAudio) {
      this.record('playback_scheduled', scheduledAtMs)
    }
  }

  toolCallStarted(): void {
    if (!this.canOutput) return
    this.pendingTools++
    this.toolUsed = true
    // Audio before a tool call is acknowledgement/filler, not answer onset.
    this.events.delete('response_audio_received')
    this.events.delete('playback_scheduled')
    if (this.traceId) this.record('tool_call_started', this.now())
  }

  toolCallCompleted(): void {
    this.pendingTools = Math.max(0, this.pendingTools - 1)
    this.awaitingPostToolAudio = this.toolUsed
    if (this.traceId) this.record('tool_call_completed', this.now())
  }

  screenFrameReceived(): void {
    if (this.traceId) this.record('screen_frame_received', this.now())
  }

  interrupted(): void {
    if (!this.responseAllowed) return
    this.setState('INTERRUPTED')
    if (this.traceId) this.record('interrupted', this.now())
    this.responseAllowed = false
    this.currentUtteranceActivated = false
  }

  selfEchoSuppressed(): void {
    if (this.traceId) this.record('self_echo_suppressed', this.now())
  }

  turnComplete(): void {
    if (this.pendingTools > 0) return
    this.awaitingPostToolAudio = false
    const completedAt = this.now()
    if (this.traceId) {
      this.record('turn_complete', completedAt)
      this.flushEvents()
    }
    if (this.responded) {
      this.followUpUntil = completedAt + this.followUpWindowMs
      this.followUpAvailable = true
    }
    this.traceId = null
    this.events.clear()
    this.pendingTools = 0
    this.toolUsed = false
    this.awaitingPostToolAudio = false
    this.responseAllowed = false
    this.responded = false
    this.lastAddressedInputAt = 0
    this.currentUtteranceActivated = false
    this.setState('PASSIVE')
  }

  private ensureTrace(startedAt = this.now()): void {
    if (this.traceId) return
    this.traceId = this.createTraceId()
    this.traceStartedAt = startedAt
    this.events.clear()
  }

  private record(stage: CopilotLatencyStage, atMs: number): void {
    if (!this.traceId) return
    this.events.set(stage, {
      traceId: this.traceId,
      stage,
      atMs,
      state: this.currentState,
      language: this.language,
      activation: this.activation,
    })
  }

  private flushEvents(): void {
    const ordered = [...this.events.values()].sort((a, b) => a.atMs - b.atMs)
    for (const event of ordered) {
      this.onEvent?.({
        ...event,
        elapsedMs: Math.max(0, event.atMs - this.traceStartedAt),
      })
    }
  }

  private setState(state: CopilotParticipationState): void {
    if (this.currentState === state) return
    this.currentState = state
    this.onStateChange?.(state)
  }
}

const normalizeWords = (value: string): string[] =>
  value
    .toLocaleLowerCase()
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .match(/[\p{L}\p{N}]+/gu) ?? []

const DIRECT_CUE_WORDS = new Set([
  'hey', 'hi', 'hello', 'okay', 'ok', 'please', 'can', 'could', 'would', 'what', 'how', 'why',
  'tell', 'help', 'show', 'hola', 'oye', 'por', 'favor', 'puedes', 'podrias', 'que', 'como',
  'dime', 'ayuda', 'explica',
])

/** Conservative vocative classifier: a bare incidental name mention does not activate. */
export function isDirectAddress(text: string, names: string[]): boolean {
  const words = normalizeWords(text)
  if (words.length === 0) return false
  const aliases = [...names, 'assistant', 'ai assistant', 'copilot', 'co pilot', 'asistente', 'ia']
    .map(normalizeWords)
    .filter(alias => alias.length > 0)

  for (const alias of aliases) {
    for (let i = 0; i <= words.length - alias.length; i++) {
      if (!alias.every((word, offset) => words[i + offset] === word)) continue
      const before = words[i - 1]
      const after = words[i + alias.length]
      const atEdge = i === 0 || i + alias.length === words.length
      const hasCue = (before && DIRECT_CUE_WORDS.has(before)) || (after && DIRECT_CUE_WORDS.has(after))
      if (atEdge && (hasCue || words.length === alias.length || /[?!¿¡]/u.test(text))) return true
      if (hasCue && i <= 2) return true
    }
  }
  return false
}

export function isLikelyFollowUp(text: string): boolean {
  const words = normalizeWords(text)
  if (words.length === 0 || words.length > 24) return false
  return /[?¿]/u.test(text) || DIRECT_CUE_WORDS.has(words[0]) || ['and', 'but', 'also', 'y', 'pero', 'tambien'].includes(words[0])
}

export function detectTurnLanguage(text: string): CopilotLatencyEvent['language'] {
  const words = normalizeWords(text)
  const spanish = words.some(word =>
    ['hola', 'oye', 'puedes', 'podrias', 'que', 'como', 'dime', 'ayuda', 'gracias', 'por', 'favor'].includes(word),
  )
  const english = words.some(word => ['hey', 'hello', 'can', 'could', 'what', 'how', 'tell', 'help', 'please', 'thanks'].includes(word))
  if (spanish && english) return 'code-switch'
  if (spanish || /[¿¡ñ]/iu.test(text)) return 'es'
  if (english) return 'en'
  return 'unknown'
}

/** Best-effort echo classification for mixed meeting audio.
 *
 * Recall exposes one mixed browser microphone to the webpage, not
 * participant-isolated tracks. Browser AEC is the primary defence; this
 * textual check prevents recent assistant output echoed back through that
 * mixed route from activating the application state a second time.
 */
export interface SelfEchoSplit {
  echoDetected: boolean
  /** Non-echo speech following the aligned echo prefix. */
  suffix: string
}

export function splitSelfEcho(input: string, recentOutput: string, serverInterrupted = false): SelfEchoSplit {
  const heard = normalizeWords(input)
  const spoken = normalizeWords(recentOutput)
  if (heard.length < 3 || spoken.length < 3) return { echoDetected: false, suffix: input }

  let matched = 0
  while (matched < heard.length && matched < spoken.length && heard[matched] === spoken[matched]) matched++
  const required = Math.max(3, Math.ceil(spoken.length * 0.75))
  if (matched < required) return { echoDetected: false, suffix: input }

  const suffixWords = heard.slice(matched)
  // Preserve a real barge-in after echoed words. Server interruption is
  // strong evidence, but a substantive unmatched suffix is preserved too.
  const preserveSuffix = serverInterrupted || suffixWords.length >= 2
  return {
    echoDetected: true,
    suffix: preserveSuffix ? suffixWords.join(' ') : '',
  }
}

export function isLikelySelfEcho(input: string, recentOutput: string): boolean {
  const split = splitSelfEcho(input, recentOutput)
  return split.echoDetected && split.suffix.length === 0
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
