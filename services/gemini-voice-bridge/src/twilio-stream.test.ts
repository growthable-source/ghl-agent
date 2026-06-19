import { describe, it, expect } from 'vitest'
import { parseTwilioFrame, mediaFrame, clearFrame } from './twilio-stream'

describe('parseTwilioFrame', () => {
  it('parses a start frame and surfaces customParameters', () => {
    const raw = JSON.stringify({
      event: 'start',
      start: {
        streamSid: 'MZ123',
        callSid: 'CA456',
        customParameters: { p: 'signed.token' },
      },
    })
    const f = parseTwilioFrame(raw)
    expect(f).toEqual({
      event: 'start',
      streamSid: 'MZ123',
      callSid: 'CA456',
      params: { p: 'signed.token' },
    })
  })

  it('parses a media frame and exposes base64 payload', () => {
    const raw = JSON.stringify({ event: 'media', media: { payload: 'AAAA', track: 'inbound' } })
    const f = parseTwilioFrame(raw)
    expect(f).toEqual({ event: 'media', payload: 'AAAA' })
  })

  it('parses connected and stop frames', () => {
    expect(parseTwilioFrame(JSON.stringify({ event: 'connected' }))).toEqual({ event: 'connected' })
    expect(parseTwilioFrame(JSON.stringify({ event: 'stop' }))).toEqual({ event: 'stop' })
  })

  it('returns null on garbage', () => {
    expect(parseTwilioFrame('not json')).toBeNull()
    expect(parseTwilioFrame(JSON.stringify({ foo: 1 }))).toBeNull()
  })
})

describe('serializers', () => {
  it('builds an outbound media frame', () => {
    const s = mediaFrame('MZ123', 'BASE64==')
    expect(JSON.parse(s)).toEqual({
      event: 'media',
      streamSid: 'MZ123',
      media: { payload: 'BASE64==' },
    })
  })

  it('builds a clear frame for barge-in', () => {
    const s = clearFrame('MZ123')
    expect(JSON.parse(s)).toEqual({ event: 'clear', streamSid: 'MZ123' })
  })
})
