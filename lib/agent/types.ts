/**
 * Shared types for the agent runtime.
 *
 * Lifted out of lib/ai-agent.ts so the catalog, executor, prompt builder,
 * and runner can all agree on shapes without import cycles.
 */

export interface ToolCallEntry {
  tool: string
  input: Record<string, unknown>
  output: string
  durationMs: number
}

export interface AgentResponse {
  /** The reply text actually sent (or captured for approval). null if no reply was emitted. */
  reply: string | null
  /** Names of every tool the loop dispatched, in order. */
  actionsPerformed: string[]
  tokensUsed: number
  toolCallTrace: ToolCallEntry[]
  /** When deferSend=true and the agent tried to send something, captures what it wanted to send. */
  deferredCapture?: DeferredSendCapture['captured']
  /** Set when the run ended without a reply for a non-content reason
   *  the caller should treat as "leave it for next time", not a hard
   *  failure.
   *  - 'model_unavailable' = TRANSIENT provider failure (429/5xx/network)
   *    after retries — retryable out-of-band.
   *  - 'model_rejected'    = PERMANENT non-retryable 4xx (bad request, auth,
   *    model-not-found) — page immediately, retrying fails identically.
   *  - 'broken_references' = workspace config gate (own fallback path). */
  skipped?: 'model_unavailable' | 'model_rejected' | 'broken_references'
  /** Diagnostic for an unanswered skip (HTTP status + model key that failed).
   *  Persisted into MessageLog.errorMessage so a transient outage is
   *  distinguishable from a permanent 4xx after the fact. */
  skipDetail?: string
}

export interface AgentAttachment {
  url: string
  kind: 'image' | 'file'
  name?: string
  mediaType?: string
}

/**
 * Captures the message an agent *wants* to send when sends are deferred
 * for human approval. The caller receives the captured text after
 * runAgent() returns so it can either deliver or queue.
 */
export interface DeferredSendCapture {
  captured: null | {
    channel: string
    contactId: string
    message: string
    conversationProviderId?: string
  }
}

/**
 * When the agent calls transfer_to_human, the executor records the reason
 * and context summary here. runAgent reads it after the tool loop exits
 * and fires a `human_handover` notification with a deep link — we do it
 * post-loop rather than inline so we have the full conversationId / channel
 * context runAgent owns.
 */
export interface HandoverCapture {
  captured: null | {
    contactId: string
    reason: string
    contextSummary: string
  }
}

export interface FallbackConfig {
  behavior: 'message' | 'transfer' | 'message_and_transfer'
  message?: string | null
}
