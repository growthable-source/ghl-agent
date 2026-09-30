import { describe, expect, it } from 'vitest'
import {
  detectTurnLanguage,
  isDirectAddress,
  isLikelySelfEcho,
  RollingPreActivationAudio,
  splitSelfEcho,
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

    lifecycle.userTranscript('Can you help?', true)
    now += 300
    lifecycle.responseAudio()
    now += 5
    lifecycle.playbackScheduled(now + 20)
    now += 200
    lifecycle.turnComplete()

    expect(events.map(event => event.stage)).toEqual([
      'input_vad_end',
      'response_audio_received',
      'playback_scheduled',
      'turn_complete',
    ])
    expect(new Set(events.map(event => event.traceId))).toEqual(new Set(['trace-1']))
    expect(events.map(event => event.elapsedMs)).toEqual([0, 300, 325, 505])
    expect(states).toEqual(['ADDRESSED', 'RESPONDING', 'PASSIVE'])
    expect(events[0]).toMatchObject({ language: 'en', activation: 'one_to_one' })
  })

  it('consumes one bounded follow-up after a direct response', () => {
    let now = 0
    const lifecycle = new TurnLifecycle({
      now: () => now,
      createTraceId: () => 'trace-2',
      requireDirectAddress: true,
      addressNames: ['Nova'],
    })

    expect(lifecycle.userTranscript('Nova, can you help?', true)).toBe('direct')
    lifecycle.responseAudio()
    lifecycle.turnComplete()
    expect(lifecycle.state).toBe('PASSIVE')
    expect(lifecycle.followUpActive).toBe(true)
    now = 1_000
    expect(lifecycle.userTranscript('What about the second option?', true)).toBe('follow_up')
    expect(lifecycle.followUpActive).toBe(false)
    lifecycle.responseAudio()
    lifecycle.turnComplete()
    now = 9_001
    expect(lifecycle.followUpActive).toBe(false)
  })

  it('keeps one trace across tool acknowledgement and post-tool audio', () => {
    const events: CopilotLatencyEvent[] = []
    let now = 0
    const lifecycle = new TurnLifecycle({
      now: () => now,
      createTraceId: () => 'trace-3',
      onEvent: event => events.push(event),
    })
    lifecycle.userTranscript('Please check pricing', true)
    now = 10
    lifecycle.responseAudio()
    lifecycle.playbackScheduled(11)
    lifecycle.toolCallStarted()
    now = 100
    lifecycle.turnComplete()
    expect(events).toEqual([])
    lifecycle.toolCallCompleted()
    now = 250
    lifecycle.responseAudio()
    lifecycle.playbackScheduled(260)
    now = 400
    lifecycle.turnComplete()
    expect(events.map(event => event.stage)).toEqual([
      'input_vad_end',
      'tool_call_started',
      'tool_call_completed',
      'response_audio_received',
      'playback_scheduled',
      'turn_complete',
    ])
    expect(new Set(events.map(event => event.traceId))).toEqual(new Set(['trace-3']))
    expect(events.find(event => event.stage === 'response_audio_received')?.atMs).toBe(250)
  })

  it('uses the last input fragment as VAD-end estimate when audio starts before final transcription', () => {
    let now = 100
    const events: CopilotLatencyEvent[] = []
    const lifecycle = new TurnLifecycle({
      now: () => now,
      createTraceId: () => 'trace-vad',
      onEvent: event => events.push(event),
    })
    lifecycle.userTranscript('Can you', false)
    now = 180
    lifecycle.userTranscript('Can you help?', false)
    now = 300
    lifecycle.responseAudio()
    now = 350
    lifecycle.userTranscript('Can you help?', true)
    now = 400
    lifecycle.turnComplete()
    expect(events.find(event => event.stage === 'input_vad_end')?.atMs).toBe(180)
    expect(events.find(event => event.stage === 'response_audio_received')?.elapsedMs).toBe(120)
  })
})

describe('direct-address classification', () => {
  it('distinguishes direct address from incidental mentions', () => {
    expect(isDirectAddress('Nova, can you summarize that?', ['Nova'])).toBe(true)
    expect(isDirectAddress('Oye Nova, ¿puedes ayudarme?', ['Nova'])).toBe(true)
    expect(isDirectAddress('I told Nova about this yesterday', ['Nova'])).toBe(false)
    expect(isDirectAddress('Le dije a Nova que volviera mañana', ['Nova'])).toBe(false)
  })

  it('detects trace language without storing transcript text', () => {
    expect(detectTurnLanguage('Can you help, por favor?')).toBe('code-switch')
    expect(detectTurnLanguage('¿Puedes ayudarme?')).toBe('es')
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

  it('preserves English, Spanish, and code-switched interruption suffixes', () => {
    expect(splitSelfEcho('let me check that now stop please', 'let me check that now', true)).toEqual({
      echoDetected: true,
      suffix: 'stop please',
    })
    expect(splitSelfEcho('dejame revisar eso ahora no espera', 'déjame revisar eso ahora', true)).toEqual({
      echoDetected: true,
      suffix: 'no espera',
    })
    expect(splitSelfEcho('let me check that now no espera', 'let me check that now', true)).toEqual({
      echoDetected: true,
      suffix: 'no espera',
    })
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
