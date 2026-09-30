import { beforeEach, describe, expect, it, vi } from 'vitest'

interface Callbacks {
  onopen(): void
  onmessage(message: unknown): void
  onerror(error: { message?: string }): void
  onclose(): void
}

const connections: Array<{
  callbacks: Callbacks
  config: Record<string, unknown>
  session: {
    sendRealtimeInput: ReturnType<typeof vi.fn>
    sendClientContent: ReturnType<typeof vi.fn>
    sendToolResponse: ReturnType<typeof vi.fn>
    close: ReturnType<typeof vi.fn>
  }
}> = []

vi.mock('@google/genai', () => ({
  GoogleGenAI: class {
    live = {
      connect: vi.fn(async ({ callbacks, config }: { callbacks: Callbacks; config: Record<string, unknown> }) => {
        const session = {
          sendRealtimeInput: vi.fn(),
          sendClientContent: vi.fn(),
          sendToolResponse: vi.fn(),
          close: vi.fn(),
        }
        connections.push({ callbacks, config, session })
        callbacks.onopen()
        return session
      }),
    }
  },
}))

import { GeminiLiveProvider } from './gemini-live'
import type { RealtimeProviderConfig } from '../types'

const cfg: RealtimeProviderConfig = {
  connection: {
    token: 'token',
    vendorModelId: 'gemini-3.1-flash-live-preview',
    provider: 'gemini-live',
    maxSessionSecs: 600,
    frameFpsCap: 2,
  },
  tools: [],
  vendorConfig: {},
}

const settle = async () => {
  await Promise.resolve()
  await Promise.resolve()
}

beforeEach(() => {
  connections.length = 0
})

describe('GeminiLiveProvider connection epochs', () => {
  it('waits for setupComplete and flushes rolling audio plus only the newest video frame', async () => {
    const provider = new GeminiLiveProvider()
    const connected = provider.connect(cfg)
    await settle()
    provider.sendAudioChunk('AAAA')
    provider.sendVideoFrame('old', 'image/png')
    provider.sendVideoFrame('new', 'image/png')
    expect(connections[0].session.sendRealtimeInput).not.toHaveBeenCalled()

    connections[0].callbacks.onmessage({ setupComplete: {} })
    await connected
    expect(connections[0].session.sendRealtimeInput.mock.calls).toEqual([
      [{ audio: { data: 'AAAA', mimeType: 'audio/pcm;rate=16000' } }],
      [{ video: { data: 'new', mimeType: 'image/png' } }],
    ])
  })

  it('rejects stale callbacks and closes the exact pending handle', async () => {
    const provider = new GeminiLiveProvider()
    const connected = provider.connect(cfg)
    await settle()
    const first = connections[0]
    await provider.close()
    expect(first.session.close).toHaveBeenCalledTimes(1)
    first.callbacks.onmessage({
      serverContent: {
        modelTurn: { parts: [{ inlineData: { data: 'late', mimeType: 'audio/pcm' } }] },
      },
    })
    const output = vi.fn()
    provider.onAudioOutput = output
    expect(output).not.toHaveBeenCalled()
    await expect(connected).rejects.toThrow()
  })

  it('resumes with the current handle and ignores stale pre-reconnect messages', async () => {
    const provider = new GeminiLiveProvider()
    const output = vi.fn()
    provider.onAudioOutput = output
    const connected = provider.connect(cfg)
    await settle()
    connections[0].callbacks.onmessage({ setupComplete: {} })
    await connected
    connections[0].callbacks.onmessage({
      sessionResumptionUpdate: { resumable: true, newHandle: 'resume-1' },
    })
    const staleCallbacks = connections[0].callbacks
    staleCallbacks.onclose()
    await settle()
    expect(connections[1].config).toMatchObject({ sessionResumption: { handle: 'resume-1' } })

    staleCallbacks.onmessage({
      serverContent: {
        modelTurn: { parts: [{ inlineData: { data: 'stale', mimeType: 'audio/pcm' } }] },
      },
    })
    expect(output).not.toHaveBeenCalled()
    connections[1].callbacks.onmessage({ setupComplete: {} })
  })
})

describe('GeminiLiveProvider response epochs and echo', () => {
  it('drops late canceled audio until fresh input and allocates a new response epoch', async () => {
    const provider = new GeminiLiveProvider()
    const audio: Array<{ data: string; epoch: number }> = []
    provider.onAudioOutput = (data, meta) => audio.push({ data, epoch: meta.responseEpoch })
    const connected = provider.connect(cfg)
    await settle()
    connections[0].callbacks.onmessage({ setupComplete: {} })
    await connected

    connections[0].callbacks.onmessage({
      serverContent: { modelTurn: { parts: [{ inlineData: { data: 'first', mimeType: 'audio/pcm' } }] } },
    })
    connections[0].callbacks.onmessage({
      serverContent: { interrupted: true },
    })
    connections[0].callbacks.onmessage({
      serverContent: { modelTurn: { parts: [{ inlineData: { data: 'late', mimeType: 'audio/pcm' } }] } },
    })
    connections[0].callbacks.onmessage({
      serverContent: {
        inputTranscription: { text: 'Nova, stop' },
        modelTurn: { parts: [{ inlineData: { data: 'fresh', mimeType: 'audio/pcm' } }] },
      },
    })

    expect(audio).toEqual([
      { data: 'first', epoch: 1 },
      { data: 'fresh', epoch: 2 },
    ])
  })

  it.each([
    ['let me check that now stop please', 'let me check that now', 'stop please'],
    ['dejame revisar eso ahora no espera', 'déjame revisar eso ahora', 'no espera'],
    ['let me check that now no espera', 'let me check that now', 'no espera'],
  ])('preserves a real interruption after echoed speech: %s', async (heard, spoken, suffix) => {
    const provider = new GeminiLiveProvider()
    const transcripts: string[] = []
    provider.onTranscript = turn => {
      if (turn.role === 'user') transcripts.push(turn.text)
    }
    const connected = provider.connect(cfg)
    await settle()
    connections[0].callbacks.onmessage({ setupComplete: {} })
    await connected
    connections[0].callbacks.onmessage({
      serverContent: { outputTranscription: { text: spoken } },
    })
    connections[0].callbacks.onmessage({
      serverContent: { interrupted: true, inputTranscription: { text: heard } },
    })
    expect(transcripts.at(-1)).toBe(suffix)
  })
})
