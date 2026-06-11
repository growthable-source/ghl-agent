import { describe, it, expect } from 'vitest'
import { parseAnalysisJson } from './analyze'

describe('parseAnalysisJson', () => {
  it('parses a clean JSON verdict', () => {
    const parsed = parseAnalysisJson(
      JSON.stringify({
        summary: 'User wanted to connect SMS and succeeded.',
        issueResolved: true,
        sentiment: 'positive',
        topics: ['channels', 'sms'],
        ticketSubject: null,
      }),
    )
    expect(parsed).not.toBeNull()
    expect(parsed!.issueResolved).toBe(true)
    expect(parsed!.sentiment).toBe('positive')
    expect(parsed!.topics).toEqual(['channels', 'sms'])
    expect(parsed!.ticketSubject).toBeNull()
  })

  it('tolerates fenced code blocks and surrounding prose', () => {
    const raw =
      'Here is the analysis:\n```json\n' +
      '{"summary":"Could not fix the webhook.","issueResolved":false,"sentiment":"frustrated","topics":["webhooks"],"ticketSubject":"Webhook setup failing"}' +
      '\n```\nDone.'
    const parsed = parseAnalysisJson(raw)
    expect(parsed).not.toBeNull()
    expect(parsed!.issueResolved).toBe(false)
    expect(parsed!.sentiment).toBe('frustrated')
    expect(parsed!.ticketSubject).toBe('Webhook setup failing')
  })

  it('defaults invalid sentiment to neutral', () => {
    const parsed = parseAnalysisJson(
      '{"summary":"x","issueResolved":true,"sentiment":"ecstatic","topics":[]}',
    )
    expect(parsed!.sentiment).toBe('neutral')
  })

  it('rejects verdicts missing required keys', () => {
    expect(parseAnalysisJson('{"summary":"only a summary"}')).toBeNull()
    expect(parseAnalysisJson('{"issueResolved":true}')).toBeNull()
    expect(parseAnalysisJson('no json here at all')).toBeNull()
    expect(parseAnalysisJson('')).toBeNull()
  })

  it('drops non-string topics and caps lengths', () => {
    const parsed = parseAnalysisJson(
      JSON.stringify({
        summary: 'y'.repeat(2000),
        issueResolved: false,
        sentiment: 'neutral',
        topics: ['a', 42, 'b', null, 'c', 'd', 'e', 'f', 'g', 'h', 'i'],
        ticketSubject: 's'.repeat(500),
      }),
    )
    expect(parsed!.summary.length).toBe(1000)
    expect(parsed!.topics).toEqual(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'])
    expect(parsed!.ticketSubject!.length).toBe(200)
  })
})
