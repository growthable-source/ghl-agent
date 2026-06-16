export type ParsedRecallEvent =
  | { kind: 'frame'; isScreenshare: boolean; pngBase64: string; ts: number }
  | { kind: 'ignore' }

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null
}

/**
 * Parse one raw message from Recall's real-time websocket. We only care
 * about `video_separate_png.data` frames; a screenshare is flagged by the
 * frame's `type` field. Defensive: anything unexpected → { kind: 'ignore' }.
 *
 * Assumed shape (confirmed against a real payload during go-live):
 *   { event: 'video_separate_png.data',
 *     data: { data: { buffer: '<base64 png>', type: 'screenshare'|'webcam',
 *                     timestamp: { relative: <number> } },
 *             participant: { id } } }
 */
export function parseRecallMessage(raw: string | Buffer): ParsedRecallEvent {
  let msg: unknown
  try {
    msg = JSON.parse(typeof raw === 'string' ? raw : raw.toString('utf8'))
  } catch {
    return { kind: 'ignore' }
  }
  if (!isRecord(msg) || msg.event !== 'video_separate_png.data') return { kind: 'ignore' }
  const outer = isRecord(msg.data) ? msg.data : undefined
  const inner = outer && isRecord(outer.data) ? outer.data : undefined
  const buffer = inner && typeof inner.buffer === 'string' ? inner.buffer : undefined
  if (!buffer) return { kind: 'ignore' }
  const type = inner && typeof inner.type === 'string' ? inner.type : ''
  const ts =
    inner && isRecord(inner.timestamp) && typeof inner.timestamp.relative === 'number'
      ? inner.timestamp.relative
      : 0
  return { kind: 'frame', isScreenshare: type === 'screenshare', pngBase64: buffer, ts }
}
