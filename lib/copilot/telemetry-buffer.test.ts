import { describe, expect, it } from 'vitest'
import { TelemetryBuffer } from './telemetry-buffer'

describe('TelemetryBuffer', () => {
  it('retains an unconfirmed snapshot and commits only its sent prefix', () => {
    const buffer = new TelemetryBuffer()
    buffer.turns.push({ role: 'user', text: 'first', ts: new Date(0).toISOString() })
    const snapshot = buffer.snapshot({ audioIn: 1, audioOut: 0, frames: 0 })

    // A failed send performs no commit; a later event remains queued too.
    buffer.turns.push({ role: 'user', text: 'second', ts: new Date(1).toISOString() })
    expect(buffer.turns).toHaveLength(2)
    expect(buffer.snapshot({ audioIn: 1.5, audioOut: 0, frames: 0 }).batchId).toBe(snapshot.batchId)
    const final = buffer.finalSnapshots({ audioIn: 1.5, audioOut: 0, frames: 0 })
    expect(final).toHaveLength(2)
    expect(final[1].turns.map(turn => turn.text)).toEqual(['second'])

    buffer.commit(snapshot)
    expect(buffer.turns.map(turn => turn.text)).toEqual(['second'])
    expect(buffer.snapshot({ audioIn: 1.5, audioOut: 0, frames: 0 }).counters.audioInSecs).toBe(0.5)
  })

  it('uses a stable snapshot payload for end finalization', () => {
    const buffer = new TelemetryBuffer()
    buffer.latencyEvents.push({
      traceId: 'trace-final',
      stage: 'input_vad_end',
      atMs: 100,
      elapsedMs: 0,
      state: 'ADDRESSED',
      language: 'es',
      activation: 'direct',
    })
    const snapshot = buffer.snapshot({ audioIn: 2, audioOut: 1, frames: 0 })
    expect(snapshot.batchId).toMatch(/^[a-zA-Z0-9-]{8,}$/)
    expect(snapshot.latencyEvents).toHaveLength(1)
    buffer.commit(snapshot)
    expect(buffer.empty).toBe(true)
  })
})
