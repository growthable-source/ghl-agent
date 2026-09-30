import type { CopilotLatencyEvent } from './turn-lifecycle'

export interface TelemetryTurn {
  role: string
  text: string
  ts: string
}

export interface TelemetryScreenEvent {
  detectedContext: Record<string, unknown>
  ts: string
}

export interface TelemetryCounters {
  audioIn: number
  audioOut: number
  frames: number
}

export interface TelemetrySnapshot {
  batchId: string
  turns: TelemetryTurn[]
  latencyEvents: CopilotLatencyEvent[]
  screenEvents: TelemetryScreenEvent[]
  counters: { audioInSecs: number; audioOutSecs: number; videoFrames: number }
  token: { turns: number; latency: number; screens: number; counters: TelemetryCounters }
}

const batchId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `batch-${Date.now()}-${Math.random().toString(36).slice(2)}`

/** Client-side at-least-once queue. A failed/aborted send never consumes data. */
export class TelemetryBuffer {
  readonly turns: TelemetryTurn[] = []
  readonly latencyEvents: CopilotLatencyEvent[] = []
  readonly screenEvents: TelemetryScreenEvent[] = []
  private committed: TelemetryCounters = { audioIn: 0, audioOut: 0, frames: 0 }
  private pending: TelemetrySnapshot | null = null

  snapshot(current: TelemetryCounters): TelemetrySnapshot {
    if (this.pending) return this.pending
    this.pending = this.createSnapshot(current, 0, 0, 0, this.committed)
    return this.pending
  }

  /** Pending retry first, then any events/counters added after that snapshot. */
  finalSnapshots(current: TelemetryCounters): TelemetrySnapshot[] {
    const first = this.snapshot(current)
    const snapshots = [first]
    const hasRemainder =
      this.turns.length > first.token.turns ||
      this.latencyEvents.length > first.token.latency ||
      this.screenEvents.length > first.token.screens ||
      current.audioIn > first.token.counters.audioIn ||
      current.audioOut > first.token.counters.audioOut ||
      current.frames > first.token.counters.frames
    if (hasRemainder) {
      snapshots.push(
        this.createSnapshot(
          current,
          first.token.turns,
          first.token.latency,
          first.token.screens,
          first.token.counters,
        ),
      )
    }
    return snapshots
  }

  private createSnapshot(
    current: TelemetryCounters,
    turnOffset: number,
    latencyOffset: number,
    screenOffset: number,
    baseline: TelemetryCounters,
  ): TelemetrySnapshot {
    return {
      batchId: batchId(),
      turns: this.turns.slice(turnOffset),
      latencyEvents: this.latencyEvents.slice(latencyOffset),
      screenEvents: this.screenEvents.slice(screenOffset),
      counters: {
        audioInSecs: Math.max(0, Math.round((current.audioIn - baseline.audioIn) * 100) / 100),
        audioOutSecs: Math.max(0, Math.round((current.audioOut - baseline.audioOut) * 100) / 100),
        videoFrames: Math.max(0, Math.round(current.frames - baseline.frames)),
      },
      token: {
        turns: this.turns.length,
        latency: this.latencyEvents.length,
        screens: this.screenEvents.length,
        counters: current,
      },
    }
  }

  commit(snapshot: TelemetrySnapshot): void {
    this.turns.splice(0, snapshot.token.turns)
    this.latencyEvents.splice(0, snapshot.token.latency)
    this.screenEvents.splice(0, snapshot.token.screens)
    this.committed = snapshot.token.counters
    if (this.pending?.batchId === snapshot.batchId) this.pending = null
  }

  get empty(): boolean {
    return this.turns.length === 0 && this.latencyEvents.length === 0 && this.screenEvents.length === 0
  }
}
