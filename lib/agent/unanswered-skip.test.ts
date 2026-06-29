import { describe, it, expect } from 'vitest'
import { describeUnansweredSkip } from './unanswered-skip'

describe('describeUnansweredSkip', () => {
  it('transient model_unavailable → recoverable copy, retryable=true, carries detail', () => {
    const n = describeUnansweredSkip({
      agentName: 'FacebookAds - Gyms',
      inboundMessage: 'Do you have a free trial?',
      skipped: 'model_unavailable',
      skipDetail: 'status=529 model=auto retryable=true',
    })
    expect(n.retryable).toBe(true)
    expect(n.errorMessage).toContain('model_unavailable')
    expect(n.errorMessage).toContain('temporarily unavailable')
    expect(n.errorMessage).toContain('status=529') // evidence persisted
    expect(n.notifyTitle).toContain('FacebookAds - Gyms')
    expect(n.notifyBody).toContain('Do you have a free trial?')
  })

  it('permanent model_rejected → "needs attention" copy, retryable=false', () => {
    const n = describeUnansweredSkip({
      agentName: 'FacebookAds - Gyms',
      inboundMessage: 'long convo…',
      skipped: 'model_rejected',
      skipDetail: 'status=400 model=claude-sonnet retryable=false',
    })
    expect(n.retryable).toBe(false)
    expect(n.errorMessage).toContain('model_rejected')
    expect(n.errorMessage).toContain('rejected the request')
    expect(n.notifyBody).toContain("won't resolve on its own")
    expect(n.notifyBody).toContain('status=400')
  })

  it('tolerates a missing skipDetail without printing "[undefined]"', () => {
    const n = describeUnansweredSkip({
      agentName: 'A',
      inboundMessage: 'hi',
      skipped: 'model_unavailable',
    })
    expect(n.errorMessage).not.toContain('undefined')
    expect(n.errorMessage).not.toContain('[]')
  })
})
