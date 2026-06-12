/**
 * Screen-share frame capture with change detection (P0-4).
 *
 * Frame rate is the primary cost lever for the realtime channel —
 * video tokens dominate per-minute cost. Policy here:
 *
 *   - hard cap at `fpsCap` (default 1 fps, env-configurable)
 *   - under the cap, frames are sent ONLY when the screen visibly
 *     changed (mean abs pixel diff on a 32×18 grayscale thumbnail
 *     beats a threshold)
 *   - a heartbeat frame goes out every HEARTBEAT_MS regardless, so
 *     the model's view can't silently go stale during long static
 *     stretches
 *
 * frameDiffScore() is pure and exported for unit tests.
 */

/** Mean absolute difference between two equal-length grayscale buffers, 0–255. */
export function frameDiffScore(a: Uint8ClampedArray | number[], b: Uint8ClampedArray | number[]): number {
  if (a.length === 0 || a.length !== b.length) return 255
  let total = 0
  for (let i = 0; i < a.length; i++) total += Math.abs(a[i] - b[i])
  return total / a.length
}

/** Diff score above this counts as "the screen changed". Tuned for
 *  dashboard UIs: page navigations score 30–80, cursor-only movement
 *  scores < 1, typing into one field ~2–4. */
export const CHANGE_THRESHOLD = 3

const THUMB_W = 32
const THUMB_H = 18
const HEARTBEAT_MS = 10_000

export interface CapturedFrame {
  base64Jpeg: string
  /** Why this frame was sent. */
  trigger: 'change' | 'heartbeat' | 'first' | 'user_speech' | 'closer_look'
  diffScore: number
}

/** Regular frames: dense dashboard UIs need more pixels than the old
 *  1024/0.6 setting gave — the model's per-frame token budget is fixed
 *  by mediaResolution, so a sharper source costs only bandwidth. */
const FRAME_MAX_SIDE = 1536
const FRAME_JPEG_QUALITY = 0.8
/** closer-look frames: full detail for reading small text. */
const HIGHRES_MAX_SIDE = 2048
const HIGHRES_JPEG_QUALITY = 0.92
/** Floor between forced captures so speech-triggered sends can't spam. */
const FORCED_MIN_INTERVAL_MS = 1500

export class ScreenFrameCapture {
  private video: HTMLVideoElement | null = null
  private canvas: HTMLCanvasElement | null = null
  private thumbCanvas: HTMLCanvasElement | null = null
  private timer: ReturnType<typeof setInterval> | null = null
  private lastThumb: Uint8ClampedArray | null = null
  private lastSentAt = 0
  /** Total frames actually sent — feeds cost telemetry. */
  sentFrames = 0

  constructor(
    private stream: MediaStream,
    private fpsCap: number,
    private onFrame: (frame: CapturedFrame) => void,
  ) {}

  async start(): Promise<void> {
    this.video = document.createElement('video')
    this.video.srcObject = this.stream
    this.video.muted = true
    await this.video.play()

    this.canvas = document.createElement('canvas')
    this.thumbCanvas = document.createElement('canvas')
    this.thumbCanvas.width = THUMB_W
    this.thumbCanvas.height = THUMB_H

    // Tick at the cap; change detection decides whether to actually send.
    const intervalMs = Math.max(250, 1000 / Math.max(0.1, this.fpsCap))
    this.timer = setInterval(() => this.tick(), intervalMs)
  }

  private tick() {
    if (!this.video || !this.canvas || !this.thumbCanvas) return
    const vw = this.video.videoWidth
    const vh = this.video.videoHeight
    if (!vw || !vh) return

    const thumbCtx = this.thumbCanvas.getContext('2d', { willReadFrequently: true })
    if (!thumbCtx) return
    thumbCtx.drawImage(this.video, 0, 0, THUMB_W, THUMB_H)
    const rgba = thumbCtx.getImageData(0, 0, THUMB_W, THUMB_H).data
    const gray = new Uint8ClampedArray(THUMB_W * THUMB_H)
    for (let i = 0; i < gray.length; i++) {
      const o = i * 4
      gray[i] = (rgba[o] * 0.299 + rgba[o + 1] * 0.587 + rgba[o + 2] * 0.114) | 0
    }

    const isFirst = this.lastThumb === null
    const diff = isFirst ? 255 : frameDiffScore(this.lastThumb!, gray)
    const heartbeatDue = Date.now() - this.lastSentAt >= HEARTBEAT_MS
    if (!isFirst && diff < CHANGE_THRESHOLD && !heartbeatDue) {
      this.lastThumb = gray
      return
    }
    this.lastThumb = gray

    this.emitFrame(isFirst ? 'first' : diff >= CHANGE_THRESHOLD ? 'change' : 'heartbeat', diff)
  }

  /**
   * Force an immediate frame, bypassing change detection — used when
   * the user starts speaking (so the model never answers off a stale
   * heartbeat frame) and by the take_a_closer_look tool (full-res so
   * small UI text is legible). Rate-floored so speech events can't
   * flood the channel. Returns whether a frame was actually sent.
   */
  captureNow(trigger: 'user_speech' | 'closer_look'): boolean {
    if (!this.video || !this.canvas) return false
    // closer_look is an explicit model request — always honor it.
    if (trigger === 'user_speech' && Date.now() - this.lastSentAt < FORCED_MIN_INTERVAL_MS) return false
    if (!this.video.videoWidth || !this.video.videoHeight) return false
    this.emitFrame(trigger, 255)
    return true
  }

  private emitFrame(trigger: CapturedFrame['trigger'], diff: number) {
    if (!this.video || !this.canvas) return
    const vw = this.video.videoWidth
    const vh = this.video.videoHeight
    const highRes = trigger === 'closer_look'
    const maxSide = highRes ? HIGHRES_MAX_SIDE : FRAME_MAX_SIDE
    const quality = highRes ? HIGHRES_JPEG_QUALITY : FRAME_JPEG_QUALITY

    const scale = Math.min(1, maxSide / Math.max(vw, vh))
    this.canvas.width = Math.round(vw * scale)
    this.canvas.height = Math.round(vh * scale)
    const ctx = this.canvas.getContext('2d')
    if (!ctx) return
    ctx.drawImage(this.video, 0, 0, this.canvas.width, this.canvas.height)
    const dataUrl = this.canvas.toDataURL('image/jpeg', quality)
    const base64Jpeg = dataUrl.slice(dataUrl.indexOf(',') + 1)

    this.lastSentAt = Date.now()
    this.sentFrames++
    this.onFrame({
      base64Jpeg,
      trigger,
      diffScore: Math.round(diff * 100) / 100,
    })
  }

  stop() {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    this.stream.getTracks().forEach(t => t.stop())
    this.video = null
    this.canvas = null
    this.thumbCanvas = null
    this.lastThumb = null
  }
}
