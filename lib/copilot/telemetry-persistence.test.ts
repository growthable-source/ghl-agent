import { describe, expect, it } from 'vitest'
import {
  persistTelemetryBatchAtomically,
  type TelemetryDatabase,
  type TelemetryTransaction,
} from './telemetry-persistence'

interface State {
  claims: Set<string>
  turns: Array<Record<string, unknown>>
  screens: Array<Record<string, unknown>>
  audioIn: number
}

class FakeAtomicDatabase implements TelemetryDatabase {
  state: State = { claims: new Set(), turns: [], screens: [], audioIn: 0 }
  failScreensOnce = false
  private lock = Promise.resolve()

  async $transaction<T>(callback: (tx: TelemetryTransaction) => Promise<T>): Promise<T> {
    let release!: () => void
    const previous = this.lock
    this.lock = new Promise<void>(resolve => {
      release = resolve
    })
    await previous
    const draft: State = {
      claims: new Set(this.state.claims),
      turns: [...this.state.turns],
      screens: [...this.state.screens],
      audioIn: this.state.audioIn,
    }
    const tx: TelemetryTransaction = {
      copilotTelemetryBatch: {
        createMany: async ({ data }) => {
          const key = `${data[0].sessionId}:${data[0].batchId}`
          if (draft.claims.has(key)) return { count: 0 }
          draft.claims.add(key)
          return { count: 1 }
        },
      },
      copilotTranscriptTurn: {
        createMany: async ({ data }) => {
          draft.turns.push(...data)
          return { count: data.length }
        },
      },
      copilotScreenEvent: {
        createMany: async ({ data }) => {
          if (this.failScreensOnce) {
            this.failScreensOnce = false
            throw new Error('screen insert failed')
          }
          draft.screens.push(...data)
          return { count: data.length }
        },
      },
      copilotSession: {
        update: async ({ data }) => {
          const increment = (data.audioInSecs as { increment?: number } | undefined)?.increment ?? 0
          draft.audioIn += increment
          return {}
        },
      },
    }
    try {
      const result = await callback(tx)
      this.state = draft
      return result
    } finally {
      release()
    }
  }
}

const input = {
  sessionId: 'session-1',
  batchId: 'batch-123',
  turns: [{ role: 'user' }],
  screenEvents: [{ detectedContext: {} }],
  counters: { audioIn: 1, audioOut: 0, frames: 0 },
}

describe('persistTelemetryBatchAtomically', () => {
  it('allows exactly one concurrent claimant and applies counters once', async () => {
    const database = new FakeAtomicDatabase()
    const results = await Promise.all([
      persistTelemetryBatchAtomically(database, input),
      persistTelemetryBatchAtomically(database, input),
    ])
    expect(results.filter(result => result.accepted)).toHaveLength(1)
    expect(results.filter(result => result.duplicate)).toHaveLength(1)
    expect(database.state.turns).toHaveLength(1)
    expect(database.state.screens).toHaveLength(1)
    expect(database.state.audioIn).toBe(1)
  })

  it('rolls back the claim and partial rows when a write fails', async () => {
    const database = new FakeAtomicDatabase()
    database.failScreensOnce = true
    await expect(persistTelemetryBatchAtomically(database, input)).rejects.toThrow('screen insert failed')
    expect(database.state.claims).toHaveLength(0)
    expect(database.state.turns).toHaveLength(0)
    expect(database.state.audioIn).toBe(0)

    await expect(persistTelemetryBatchAtomically(database, input)).resolves.toEqual({
      accepted: true,
      duplicate: false,
    })
    expect(database.state.turns).toHaveLength(1)
  })
})
