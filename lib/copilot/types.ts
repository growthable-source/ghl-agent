/**
 * Real-time screen-share Co-Pilot — shared types.
 *
 * Two purposes:
 *
 * 1.  Declare the `RealtimeModelProvider` interface — the vendor-swap
 *     seam between our session orchestrator and whichever native-audio
 *     model is answering this session (Gemini Live or GPT-Realtime).
 *     We deliberately ship no implementation in this PR; the interface
 *     is the contract that lets us land the API + UI shell now and
 *     plug a provider in next PR without reshaping anything.
 *
 * 2.  Expose strongly-typed DTOs for the session API so the
 *     route-handler and the UI agree on shape without re-deriving it
 *     from the Prisma row twice.
 *
 * Naming: deliberately brand-neutral. No `gemini`, `openai`, or
 * `livekit` references leak through this surface — callers see a
 * `model: 'gemini-live' | 'gpt-realtime'` string and that's it. Keeps
 * the swap cheap when we decide which to anchor on.
 */

// ─── Channel + lifecycle ────────────────────────────────────────────

/**
 * Where the realtime stream is being produced.
 *  - 'in_app_webrtc' — the in-app screen-share + mic via LiveKit room
 *                      (v0; the only value the runtime currently sets).
 *  - 'recall_meeting_bot' — Recall.ai bot dialed into a Zoom/Meet call
 *                          on the user's behalf (spec §9, P2). Schema
 *                          carries it now so we don't migrate later.
 */
export type CopilotChannel = 'in_app_webrtc' | 'recall_meeting_bot'

export type CopilotStatus = 'active' | 'ended' | 'error'

/**
 * Realtime model the session is bound to. The orchestrator picks one
 * provider per session and sticks with it for the whole call —
 * switching mid-session would lose context.
 */
export type CopilotModel = 'gemini-live' | 'gpt-realtime'

// ─── DTOs ───────────────────────────────────────────────────────────

/** Wire shape returned by POST /api/copilot/sessions and GET /[id]. */
export interface CopilotSessionDTO {
  id: string
  workspaceId: string
  channel: CopilotChannel
  status: CopilotStatus
  model: CopilotModel | null
  roomId: string | null
  locale: string
  workflowKey: string | null
  startedAt: string
  endedAt: string | null
  durationSecs: number | null
  endedReason: string | null
  toolCallCount: number
}

/** POST body for creating a session. All fields optional — sensible defaults applied server-side. */
export interface CreateCopilotSessionInput {
  channel?: CopilotChannel
  locale?: string
  workflowKey?: string | null
  /** Hint to the orchestrator. The provider may still elect to swap if availability requires. */
  preferredModel?: CopilotModel
}

// ─── RealtimeModelProvider — the vendor-swap seam ──────────────────

/**
 * What the session orchestrator needs from whichever realtime model
 * answers the call. Implementations live behind this interface so the
 * orchestrator stays vendor-agnostic.
 *
 * No implementation ships in this PR. We declare it now so:
 *  (a) the foundation API can reference the type in `model:` columns,
 *  (b) the next PR adds `lib/copilot/providers/gemini-live.ts` and
 *      `lib/copilot/providers/gpt-realtime.ts` without API churn,
 *  (c) it's a contract reviewers can react to before we sink time
 *      into either side of the swap.
 */
export interface RealtimeModelProvider {
  /** Stable id used in the `CopilotSession.model` column. */
  readonly name: CopilotModel

  /**
   * Open a session with the realtime model and return a handle the
   * orchestrator can stream into and out of. Implementations are
   * responsible for any auth handshake + transport setup the vendor
   * requires.
   */
  openSession(input: OpenRealtimeSessionInput): Promise<RealtimeSessionHandle>
}

export interface OpenRealtimeSessionInput {
  sessionId: string
  workspaceId: string
  locale: string
  /** Initial system instructions for the realtime model. Subset of the agent prompt — co-pilot's persona, not a CRM agent's. */
  systemPrompt: string
  /** Tool definitions the model may call mid-session (read-only in v0). */
  tools: RealtimeToolDef[]
  /** Optional caller-supplied hints (workflow key, prior context summary). */
  metadata?: Record<string, unknown>
}

/**
 * One read-only tool the realtime model can invoke. Schema matches
 * the JSON-Schema subset the existing voice/agent runtimes already
 * accept so we can reuse `lib/agent/tool-catalog.ts` shapes without
 * a converter.
 */
export interface RealtimeToolDef {
  name: string
  description: string
  parameters: {
    type: 'object'
    properties: Record<string, { type: string; description?: string; enum?: string[] }>
    required?: string[]
  }
}

/**
 * What the orchestrator gets back. Returned only — we don't model
 * the vendor's raw transport object here; implementations keep that
 * private and expose the verbs the orchestrator actually uses.
 */
export interface RealtimeSessionHandle {
  /** Push an audio frame into the model. */
  sendAudio(frame: ArrayBuffer): Promise<void>
  /** Push a video frame (or a vision-summary text) into the model. */
  sendVideo(frame: ArrayBuffer | { kind: 'summary'; text: string }): Promise<void>
  /** Hang up cleanly + release the vendor session. */
  close(reason?: string): Promise<void>
  /** Event hook the orchestrator subscribes to; emits transcript turns + tool calls. */
  on(event: RealtimeEvent['kind'], handler: (e: RealtimeEvent) => void): void
}

export type RealtimeEvent =
  | { kind: 'transcript_turn'; role: 'user' | 'agent'; text: string; tokens?: number }
  | { kind: 'tool_call'; name: string; args: Record<string, unknown>; toolCallId: string }
  | { kind: 'session_ended'; reason: string }
  | { kind: 'error'; message: string }
