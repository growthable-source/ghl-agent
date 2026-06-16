import { parseRecallMessage } from './recall-events.js'

export interface Sink {
  send(data: string): void
}

interface Room {
  recall?: Sink
  agent?: Sink
  lastFrame?: string
}

/**
 * Pairs a Recall ingest socket and a bot-page relay socket by botToken.
 * Forwards only screenshare frames; dedupes identical consecutive frames.
 * No durable state — a restart drops rooms and both sides reconnect.
 */
export class RoomRegistry {
  private rooms = new Map<string, Room>()

  private getOrCreate(token: string): Room {
    let r = this.rooms.get(token)
    if (!r) {
      r = {}
      this.rooms.set(token, r)
    }
    return r
  }

  attachRecall(token: string, sink: Sink): void {
    this.getOrCreate(token).recall = sink
  }
  attachAgent(token: string, sink: Sink): void {
    this.getOrCreate(token).agent = sink
  }
  detachRecall(token: string): void {
    const r = this.rooms.get(token)
    if (!r) return
    r.recall = undefined
    this.cleanup(token)
  }
  detachAgent(token: string): void {
    const r = this.rooms.get(token)
    if (!r) return
    r.agent = undefined
    this.cleanup(token)
  }

  /** Handle one raw message from the Recall ingest socket. Returns whether a frame was forwarded. */
  handleRecallMessage(token: string, raw: string | Buffer): boolean {
    const r = this.rooms.get(token)
    if (!r || !r.agent) return false
    const parsed = parseRecallMessage(raw)
    if (parsed.kind !== 'frame' || !parsed.isScreenshare) return false
    if (parsed.pngBase64 === r.lastFrame) return false
    r.lastFrame = parsed.pngBase64
    r.agent.send(JSON.stringify({ type: 'frame', mime: 'image/png', data: parsed.pngBase64, ts: parsed.ts }))
    return true
  }

  private cleanup(token: string): void {
    const r = this.rooms.get(token)
    if (r && !r.recall && !r.agent) this.rooms.delete(token)
  }

  roomCount(): number {
    return this.rooms.size
  }
}
