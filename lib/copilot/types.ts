/**
 * Real-time screen-share Co-Pilot — shared types.
 *
 * Architecture note (v0): there is NO server-side media worker. The
 * browser connects directly to the realtime model over WebSocket
 * using a short-lived ephemeral token minted by our backend. The
 * backend locks the model id + full session config (system prompt,
 * tools, transcription, compression) INSIDE the token via
 * liveConnectConstraints, so the client cannot tamper with
 * instructions even though it holds the connection. This replaces
 * the spec's LiveKit SFU + Agents-worker design for v0 — Voxility
 * deploys to Vercel only, which can't host a long-running worker,
 * and browser-direct removes a media hop (helps the 800 ms
 * no-dead-air constraint). The P2 meeting-bot channel
 * ('recall_meeting_bot') is where a server-side worker genuinely
 * becomes necessary; the seam for it is the `channel` column.
 *
 * `RealtimeModelProvider` is the vendor-swap seam (spec §6): the
 * session UI depends on this interface, never a vendor SDK directly.
 * v0 ships GeminiLiveProvider (lib/copilot/providers/gemini-live.ts);
 * gpt-realtime is the documented fallback — OpenAI's realtime API
 * also supports browser-direct connections with ephemeral client
 * keys, so it fits this same client-side interface.
 */

// ─── Channel + lifecycle ────────────────────────────────────────────

/**
 * Where the realtime stream is being produced.
 *  - 'in_app_webrtc' — in-app screen-share + mic (v0; the only value
 *                      the runtime currently sets).
 *  - 'recall_meeting_bot' — Recall.ai bot dialed into a Zoom/Meet
 *                          call (spec §9, P2). Schema carries it now
 *                          so we don't migrate later.
 */
export type CopilotChannel = 'in_app_webrtc' | 'recall_meeting_bot'

export type CopilotStatus = 'active' | 'ended' | 'error'

/**
 * Realtime model family the session is bound to. One provider per
 * session — switching mid-session would lose context.
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

/**
 * Realtime connection material returned alongside the session DTO.
 * The token is single-use and expires within minutes; the model id
 * and config are ALSO locked inside the token server-side — they're
 * echoed here because the vendor SDK requires them at connect time
 * and they must match the constraint exactly.
 */
export interface RealtimeConnectionInfo {
  /** Ephemeral token. Never the real API key. */
  token: string
  /** Vendor model id the token is locked to (e.g. 'gemini-3.1-flash-live-preview'). */
  vendorModelId: string
  /** Provider family — selects which RealtimeModelProvider implementation to instantiate. */
  provider: CopilotModel
  /** Max session duration in seconds; the client enforces a hard timer. */
  maxSessionSecs: number
  /** Frame throttle: hard cap in frames/sec (change-detection runs under this). */
  frameFpsCap: number
}

// ─── RealtimeModelProvider — the vendor-swap seam (spec §6) ────────

/**
 * Client-side contract between the session UI and whichever realtime
 * model answers the call. Mirrors spec §6: connect / sendAudio /
 * sendVideoFrame / injectContext / interrupt / close + event
 * callbacks. The UI never imports a vendor SDK.
 */
export interface RealtimeModelProvider {
  /** Provider family id, stored in CopilotSession.model. */
  readonly name: CopilotModel

  /** Open the realtime connection. Resolves once the session is live. */
  connect(cfg: RealtimeProviderConfig): Promise<void>

  /** Push a chunk of user mic audio (base64 PCM16 @ 16 kHz mono). */
  sendAudioChunk(base64Pcm16: string): void

  /** Push one screen frame (base64 image). mimeType defaults to JPEG; the meeting relay sends PNG. */
  sendVideoFrame(base64Image: string, mimeType?: string): void

  /**
   * Async grounding update — inject fresh context (e.g. re-retrieved
   * RAG text after a screen-context change) without blocking the
   * model's speech (P0-5).
   */
  injectContext(text: string): void

  /**
   * Proactive trigger — force the model to take a turn now in response
   * to an environment event (screen change, idle progress tick, or
   * session start), not user speech. Unlike injectContext, this
   * completes the turn so the model evaluates and speaks (or elects to
   * stay silent). The text is an instruction-style cue, not user words.
   */
  nudge(text: string): void

  /** Barge-in: stop current model speech immediately (P0-3). */
  interrupt(): void

  /** Hang up cleanly + release the vendor session. */
  close(): Promise<void>

  // Event callbacks — set before connect().
  onAudioOutput?: (base64Pcm: string) => void
  onTranscript?: (turn: { role: 'user' | 'agent'; text: string; final: boolean }) => void
  /** Model requested a tool. Resolve with the JSON result; the provider feeds it back. */
  onToolCall?: (call: { id: string; name: string; args: Record<string, unknown> }) => Promise<Record<string, unknown>>
  /** Model speech was interrupted by the user (flush playback queues). */
  onInterrupted?: () => void
  onError?: (message: string) => void
  /** Connection ended (vendor-side close, goAway exhaustion, or close()). */
  onEnded?: (reason: string) => void
}

export interface RealtimeProviderConfig {
  connection: RealtimeConnectionInfo
  /** Tool declarations — must match what the server locked into the token. */
  tools: RealtimeToolDef[]
  /**
   * Vendor-shaped session config echoed by the server. Passed
   * verbatim to the vendor SDK at connect — it must match the config
   * locked inside the ephemeral token byte-for-byte, so the client
   * never constructs (or edits) it locally.
   */
  vendorConfig?: Record<string, unknown>
}

/**
 * One read-only tool the realtime model can invoke. JSON-Schema
 * subset shared with the existing agent runtimes.
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
