export interface TelemetryPersistenceInput {
  sessionId: string
  batchId: string
  turns: Array<Record<string, unknown>>
  screenEvents: Array<Record<string, unknown>>
  counters: { audioIn: number; audioOut: number; frames: number }
}

export interface TelemetryTransaction {
  copilotTelemetryBatch: {
    createMany(args: {
      data: Array<{ sessionId: string; batchId: string }>
      skipDuplicates: boolean
    }): Promise<{ count: number }>
  }
  copilotTranscriptTurn: {
    createMany(args: { data: Array<Record<string, unknown>> }): Promise<{ count: number }>
  }
  copilotScreenEvent: {
    createMany(args: { data: Array<Record<string, unknown>> }): Promise<{ count: number }>
  }
  copilotSession: {
    update(args: {
      where: { id: string }
      data: Record<string, unknown>
    }): Promise<unknown>
  }
}

export interface TelemetryDatabase {
  $transaction<T>(callback: (tx: TelemetryTransaction) => Promise<T>): Promise<T>
}

/**
 * Claims and persists one telemetry batch in one database transaction.
 * The composite claim key makes concurrent retries deterministic: exactly
 * one transaction observes count=1 and performs side effects.
 */
export async function persistTelemetryBatchAtomically(
  database: TelemetryDatabase,
  input: TelemetryPersistenceInput,
): Promise<{ accepted: boolean; duplicate: boolean }> {
  return database.$transaction(async tx => {
    const claim = await tx.copilotTelemetryBatch.createMany({
      data: [{ sessionId: input.sessionId, batchId: input.batchId }],
      skipDuplicates: true,
    })
    if (claim.count === 0) return { accepted: false, duplicate: true }

    if (input.turns.length > 0) {
      await tx.copilotTranscriptTurn.createMany({ data: input.turns })
    }
    if (input.screenEvents.length > 0) {
      await tx.copilotScreenEvent.createMany({ data: input.screenEvents })
    }
    const { audioIn, audioOut, frames } = input.counters
    if (audioIn > 0 || audioOut > 0 || frames > 0) {
      await tx.copilotSession.update({
        where: { id: input.sessionId },
        data: {
          ...(audioIn > 0 ? { audioInSecs: { increment: audioIn } } : {}),
          ...(audioOut > 0 ? { audioOutSecs: { increment: audioOut } } : {}),
          ...(frames > 0 ? { videoFrames: { increment: frames } } : {}),
        },
      })
    }
    return { accepted: true, duplicate: false }
  })
}
