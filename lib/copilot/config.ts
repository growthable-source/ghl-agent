/**
 * Co-Pilot runtime configuration. All env-overridable so model id,
 * session ceiling, and frame budget can change without a deploy
 * (spec Appendix B).
 */

export const COPILOT_DEFAULTS = {
  /** Gemini Live native-audio model the ephemeral token is locked to. */
  vendorModelId: process.env.COPILOT_MODEL_PRIMARY || 'gemini-3.1-flash-live-preview',
  /** Hard session ceiling (P0-11). Client enforces a timer; server rejects writes past it. */
  maxSessionSecs: Number(process.env.COPILOT_MAX_SESSION_SECS) || 1800,
  /** Frame throttle hard cap, frames/sec. Change detection runs under this (P0-4). */
  frameFpsCap: Number(process.env.COPILOT_FRAME_FPS_CAP) || 1,
  /**
   * Token budget per video frame. The Live API default is LOW
   * (64 tokens/frame) — at that resolution dashboard UI text is
   * unreadable and the model falls back to guessing from its prompt.
   * MEDIUM (256 tokens) makes screen text legible; frames are already
   * change-gated so the cost delta stays small.
   */
  mediaResolution: process.env.COPILOT_MEDIA_RESOLUTION || 'MEDIA_RESOLUTION_MEDIUM',
}
