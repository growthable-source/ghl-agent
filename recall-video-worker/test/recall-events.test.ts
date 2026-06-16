import { describe, it, expect } from 'vitest'
import { parseRecallMessage } from '../src/recall-events.js'

const frame = (type: string, buffer = 'AAAA') =>
  JSON.stringify({
    event: 'video_separate_png.data',
    data: { data: { buffer, type, timestamp: { relative: 1.5 } }, participant: { id: 7 } },
  })

describe('parseRecallMessage', () => {
  it('parses a screenshare frame', () => {
    expect(parseRecallMessage(frame('screenshare'))).toEqual({
      kind: 'frame',
      isScreenshare: true,
      pngBase64: 'AAAA',
      ts: 1.5,
    })
  })
  it('marks a webcam frame as not screenshare', () => {
    expect(parseRecallMessage(frame('webcam'))).toMatchObject({ kind: 'frame', isScreenshare: false })
  })
  it('ignores other event types', () => {
    expect(parseRecallMessage(JSON.stringify({ event: 'transcript.data', data: {} }))).toEqual({ kind: 'ignore' })
  })
  it('ignores malformed JSON', () => {
    expect(parseRecallMessage('not json')).toEqual({ kind: 'ignore' })
  })
  it('ignores a frame with no buffer', () => {
    expect(
      parseRecallMessage(JSON.stringify({ event: 'video_separate_png.data', data: { data: { type: 'screenshare' } } })),
    ).toEqual({ kind: 'ignore' })
  })
})
