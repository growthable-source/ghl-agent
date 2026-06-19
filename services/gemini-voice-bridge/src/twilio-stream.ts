/**
 * Twilio Media Streams framing. Twilio sends JSON text frames over the
 * WebSocket; we parse the inbound ones we care about and serialize the
 * two we emit (media playback + clear/barge-in flush).
 *
 * Docs: https://www.twilio.com/docs/voice/media-streams/websocket-messages
 */

export type TwilioInbound =
  | { event: 'connected' }
  | { event: 'start'; streamSid: string; callSid: string; params: Record<string, string> }
  | { event: 'media'; payload: string }
  | { event: 'stop' }
  | { event: 'mark'; name: string }

/** Parse a raw Twilio WS text frame. Returns null for anything we don't model. */
export function parseTwilioFrame(raw: string): TwilioInbound | null {
  let msg: any
  try {
    msg = JSON.parse(raw)
  } catch {
    return null
  }
  switch (msg?.event) {
    case 'connected':
      return { event: 'connected' }
    case 'start':
      return {
        event: 'start',
        streamSid: String(msg.start?.streamSid ?? ''),
        callSid: String(msg.start?.callSid ?? ''),
        params: (msg.start?.customParameters ?? {}) as Record<string, string>,
      }
    case 'media':
      return { event: 'media', payload: String(msg.media?.payload ?? '') }
    case 'mark':
      return { event: 'mark', name: String(msg.mark?.name ?? '') }
    case 'stop':
      return { event: 'stop' }
    default:
      return null
  }
}

/** Serialize an outbound media frame (base64 μ-law 8k payload). */
export function mediaFrame(streamSid: string, payloadBase64: string): string {
  return JSON.stringify({ event: 'media', streamSid, media: { payload: payloadBase64 } })
}

/** Serialize a clear frame to flush queued playback on barge-in. */
export function clearFrame(streamSid: string): string {
  return JSON.stringify({ event: 'clear', streamSid })
}
