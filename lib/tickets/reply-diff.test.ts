import { describe, it, expect } from 'vitest'
import { computeReplyDiff } from './reply-diff'

describe('computeReplyDiff', () => {
  it('reports no change for identical text', () => {
    const d = computeReplyDiff('Hello there', 'Hello there')
    expect(d.changed).toBe(false)
    expect(d.unified).toBe('')
    expect(d.addedLines).toBe(0)
    expect(d.removedLines).toBe(0)
  })

  it('ignores leading/trailing whitespace when deciding "changed"', () => {
    const d = computeReplyDiff('Hello there', '  Hello there\n')
    expect(d.changed).toBe(false)
    expect(d.unified).toBe('')
  })

  it('marks a reworded line as one removal + one addition', () => {
    const d = computeReplyDiff(
      'Hi,\nYour refund is on the way.\nThanks',
      'Hi,\nYour refund has been processed.\nThanks',
    )
    expect(d.changed).toBe(true)
    expect(d.removedLines).toBe(1)
    expect(d.addedLines).toBe(1)
    expect(d.unified).toContain('- Your refund is on the way.')
    expect(d.unified).toContain('+ Your refund has been processed.')
    // Unchanged lines are carried as context.
    expect(d.unified).toContain('  Hi,')
    expect(d.unified).toContain('  Thanks')
  })

  it('detects a purely added line', () => {
    const d = computeReplyDiff('Line one', 'Line one\nLine two')
    expect(d.changed).toBe(true)
    expect(d.addedLines).toBe(1)
    expect(d.removedLines).toBe(0)
    expect(d.unified).toContain('+ Line two')
  })

  it('detects a purely removed line', () => {
    const d = computeReplyDiff('Line one\nLine two', 'Line one')
    expect(d.changed).toBe(true)
    expect(d.addedLines).toBe(0)
    expect(d.removedLines).toBe(1)
    expect(d.unified).toContain('- Line two')
  })

  it('handles a full rewrite (all lines replaced)', () => {
    const d = computeReplyDiff('old a\nold b', 'new x\nnew y\nnew z')
    expect(d.changed).toBe(true)
    expect(d.removedLines).toBe(2)
    expect(d.addedLines).toBe(3)
  })

  it('treats an empty original (rare) as all-added', () => {
    const d = computeReplyDiff('', 'brand new reply')
    expect(d.changed).toBe(true)
    expect(d.addedLines).toBe(1)
    expect(d.removedLines).toBe(0)
  })
})
