import { describe, it, expect } from 'vitest'
import { formatSSE, buildResumeId, parseResumeId } from './widget-sse'

const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes)

describe('formatSSE', () => {
  it('emits a data-only frame when no id is supplied', () => {
    const out = decode(formatSSE({ type: 'agent_typing', isTyping: true }))
    expect(out).toBe('data: {"type":"agent_typing","isTyping":true}\n\n')
  })

  it('prepends an id line when one is supplied', () => {
    const out = decode(formatSSE({ type: 'agent_message' }, { id: '2026-05-04T00:00:00.000Z|cmsg_abc' }))
    expect(out).toBe('id: 2026-05-04T00:00:00.000Z|cmsg_abc\ndata: {"type":"agent_message"}\n\n')
  })
})

describe('buildResumeId / parseResumeId roundtrip', () => {
  it('roundtrips a Date created at a known instant', () => {
    const ts = new Date('2026-05-04T12:34:56.789Z')
    const id = buildResumeId(ts, 'cmsg_xyz')
    expect(id).toBe('2026-05-04T12:34:56.789Z|cmsg_xyz')
    const parsed = parseResumeId(id)
    expect(parsed?.createdAt.getTime()).toBe(ts.getTime())
    expect(parsed?.messageId).toBe('cmsg_xyz')
  })

  it('accepts an iso string directly', () => {
    const id = buildResumeId('2026-01-02T03:04:05.000Z', 'cmsg_q')
    expect(id).toBe('2026-01-02T03:04:05.000Z|cmsg_q')
  })

  it('returns null for missing or malformed input', () => {
    expect(parseResumeId(null)).toBeNull()
    expect(parseResumeId('')).toBeNull()
    expect(parseResumeId('no-pipe-here')).toBeNull()
    expect(parseResumeId('not-a-date|cmsg_abc')).toBeNull()
    expect(parseResumeId('2026-05-04T00:00:00.000Z|')).toBeNull()
  })

  it('keeps message ids that contain extra pipe characters intact (split-once semantics)', () => {
    const parsed = parseResumeId('2026-05-04T00:00:00.000Z|cmsg|with|pipes')
    expect(parsed?.messageId).toBe('cmsg|with|pipes')
  })
})
