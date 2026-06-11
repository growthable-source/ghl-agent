/**
 * Browser audio plumbing for the Co-Pilot session.
 *
 * Two halves:
 *   - MicCapture: getUserMedia → AudioWorklet → 16 kHz mono PCM16
 *     chunks, base64-encoded the way the Live API wants them.
 *   - PcmPlayer: queue of 24 kHz PCM16 chunks from the model,
 *     gaplessly scheduled onto an AudioContext, with flush() for
 *     barge-in (drop everything queued the instant the user speaks).
 *
 * Client-only — never import from server code. The AudioWorklet
 * module is inlined via a Blob URL so there's no extra static asset
 * to serve.
 */

const CAPTURE_SAMPLE_RATE = 16000
const PLAYBACK_SAMPLE_RATE = 24000

/** Int16 PCM → base64, chunked to stay under argument limits. */
export function pcm16ToBase64(samples: Int16Array): string {
  const bytes = new Uint8Array(samples.buffer, samples.byteOffset, samples.byteLength)
  let binary = ''
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return btoa(binary)
}

export function base64ToPcm16(b64: string): Int16Array {
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return new Int16Array(bytes.buffer)
}

function floatTo16(float32: Float32Array): Int16Array {
  const out = new Int16Array(float32.length)
  for (let i = 0; i < float32.length; i++) {
    const s = Math.max(-1, Math.min(1, float32[i]))
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff
  }
  return out
}

const WORKLET_SOURCE = `
class PcmCaptureProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const channel = inputs[0] && inputs[0][0]
    if (channel) this.port.postMessage(channel.slice(0))
    return true
  }
}
registerProcessor('pcm-capture', PcmCaptureProcessor)
`

export class MicCapture {
  private ctx: AudioContext | null = null
  private stream: MediaStream | null = null
  private node: AudioWorkletNode | null = null
  private buffer: Float32Array[] = []
  private buffered = 0
  private muted = false
  /** Seconds of audio captured + emitted — feeds the cost telemetry. */
  capturedSecs = 0

  constructor(private onChunk: (base64Pcm16: string) => void) {}

  async start(): Promise<void> {
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 },
    })
    // Asking the context for 16 kHz makes the browser do the
    // resampling — worklet output is already at the Live API's rate.
    this.ctx = new AudioContext({ sampleRate: CAPTURE_SAMPLE_RATE })
    const blobUrl = URL.createObjectURL(new Blob([WORKLET_SOURCE], { type: 'application/javascript' }))
    try {
      await this.ctx.audioWorklet.addModule(blobUrl)
    } finally {
      URL.revokeObjectURL(blobUrl)
    }
    const source = this.ctx.createMediaStreamSource(this.stream)
    this.node = new AudioWorkletNode(this.ctx, 'pcm-capture')
    this.node.port.onmessage = (e: MessageEvent<Float32Array>) => {
      if (this.muted) return
      this.buffer.push(e.data)
      this.buffered += e.data.length
      // ~128 ms per emitted chunk: small enough for low latency,
      // large enough to keep message overhead sane.
      if (this.buffered >= 2048) this.flushBuffer()
    }
    source.connect(this.node)
    // Worklet needs a destination to keep processing; route through a
    // zero-gain node so the user doesn't hear their own mic.
    const silence = this.ctx.createGain()
    silence.gain.value = 0
    this.node.connect(silence)
    silence.connect(this.ctx.destination)
  }

  private flushBuffer() {
    const merged = new Float32Array(this.buffered)
    let offset = 0
    for (const part of this.buffer) {
      merged.set(part, offset)
      offset += part.length
    }
    this.buffer = []
    this.buffered = 0
    this.capturedSecs += merged.length / CAPTURE_SAMPLE_RATE
    this.onChunk(pcm16ToBase64(floatTo16(merged)))
  }

  setMuted(muted: boolean) {
    this.muted = muted
    this.stream?.getAudioTracks().forEach(t => (t.enabled = !muted))
  }

  stop() {
    this.node?.disconnect()
    this.stream?.getTracks().forEach(t => t.stop())
    void this.ctx?.close()
    this.node = null
    this.stream = null
    this.ctx = null
  }
}

export class PcmPlayer {
  private ctx: AudioContext | null = null
  private nextStartTime = 0
  private sources = new Set<AudioBufferSourceNode>()
  /** Seconds of model audio enqueued — feeds the cost telemetry. */
  playedSecs = 0

  async start(): Promise<void> {
    this.ctx = new AudioContext({ sampleRate: PLAYBACK_SAMPLE_RATE })
    if (this.ctx.state === 'suspended') await this.ctx.resume()
    this.nextStartTime = this.ctx.currentTime
  }

  enqueue(base64Pcm16: string) {
    if (!this.ctx) return
    const samples = base64ToPcm16(base64Pcm16)
    if (samples.length === 0) return
    const buffer = this.ctx.createBuffer(1, samples.length, PLAYBACK_SAMPLE_RATE)
    const channel = buffer.getChannelData(0)
    for (let i = 0; i < samples.length; i++) channel[i] = samples[i] / 0x8000
    const source = this.ctx.createBufferSource()
    source.buffer = buffer
    source.connect(this.ctx.destination)
    const startAt = Math.max(this.nextStartTime, this.ctx.currentTime)
    source.start(startAt)
    this.nextStartTime = startAt + buffer.duration
    this.playedSecs += buffer.duration
    this.sources.add(source)
    source.onended = () => this.sources.delete(source)
  }

  /** Barge-in: drop everything queued immediately. */
  flush() {
    for (const s of this.sources) {
      try {
        s.stop()
      } catch {
        // already stopped
      }
    }
    this.sources.clear()
    if (this.ctx) this.nextStartTime = this.ctx.currentTime
  }

  stop() {
    this.flush()
    void this.ctx?.close()
    this.ctx = null
  }
}
