import { describe, expect, it } from 'vitest'
import {
  isLikelySelfEcho,
  RollingPreActivationAudio,
  TurnLifecycle,
  type CopilotLatencyEvent,
} from './turn-lifecycle'

describe('TurnLifecycle', () => {
  it('emits content-free stages with one shared trace id', () => {
    let now = 1_000
    const events: CopilotLatencyEvent[] = []
    const states: string[] = []
    const lifecycle = new TurnLifecycle({
      now: () => now,
      createTraceId: () => 'trace-1',
      onEvent: event => events.push(event),
      onStateChange: state => states.push(state),
    })

    lifecycle.userTranscript(false)
    now += 120
    lifecycle.userTranscript(true)
    now += 300
    lifecycle.responseAudio()
    now += 5
    lifecycle.playbackScheduled()
    now += 200
    lifecycle.turnComplete()

    expect(events.map(event => event.stage)).toEqual([
      'input_transcript_first',
      'input_transcript_final',
      'response_audio_received',
      'playback_scheduled',
      'turn_complete',
    ])
    expect(new Set(events.map(event => event.traceId))).toEqual(new Set(['trace-1']))
    expect(events.map(event => event.elapsedMs)).toEqual([0, 120, 420, 425, 625])
    expect(states).toEqual(['ADDRESSED', 'RESPONDING', 'PASSIVE'])
    expect(Object.keys(events[0]).sort()).toEqual(['atMs', 'elapsedMs', 'stage', 'state', 'traceId'])
  })

  it('enters interrupted state and opens a bounded follow-up window', () => {
    let now = 0
    const lifecycle = new TurnLifecycle({ now: () => now, createTraceId: () => 'trace-2' })

    lifecycle.responseAudio()
    lifecycle.interrupted()
    expect(lifecycle.state).toBe('INTERRUPTED')
    lifecycle.turnComplete()
    expect(lifecycle.state).toBe('PASSIVE')
    expect(lifecycle.followUpActive).toBe(true)
    now = 8_001
    expect(lifecycle.followUpActive).toBe(false)
  })

  it('deduplicates repeated incremental stage notifications', () => {
    const events: CopilotLatencyEvent[] = []
    const lifecycle = new TurnLifecycle({
      createTraceId: () => 'trace-3',
      onEvent: event => events.push(event),
    })
    lifecycle.userTranscript(false)
    lifecycle.userTranscript(false)
    lifecycle.responseAudio()
    lifecycle.responseAudio()
    expect(events.map(event => event.stage)).toEqual(['input_transcript_first', 'response_audio_received'])
  })
})

describe('isLikelySelfEcho', () => {
  it('matches punctuation and case variants of recent assistant speech', () => {
    expect(isLikelySelfEcho('Let me check that for you.', 'Let me check that for you')).toBe(true)
  })

  it('matches bilingual echoes without language-specific assumptions', () => {
    expect(isLikelySelfEcho('Déjame revisar eso ahora', 'Déjame revisar eso ahora.')).toBe(true)
  })

  it('does not suppress a short acknowledgement or unrelated interruption', () => {
    expect(isLikelySelfEcho('yes', 'Let me check that for you')).toBe(false)
    expect(isLikelySelfEcho('No, stop and answer my other question', 'Let me check that for you')).toBe(false)
  })
})

describe('RollingPreActivationAudio', () => {
  it('keeps only the newest bounded audio and drains in order', () => {
    const audio = new RollingPreActivationAudio(6)
    audio.push('AAAA')
    audio.push('BBBB')
    audio.push('CCCC')
    expect(audio.byteLength).toBe(6)
    expect(audio.drain()).toEqual(['BBBB', 'CCCC'])
    expect(audio.byteLength).toBe(0)
  })
})
