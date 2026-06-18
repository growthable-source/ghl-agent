import { describe, it, expect } from 'vitest'
import { buildCopilotBlockFlow, normalizeBlocks, type CopilotBlock } from './blocks'

const blocks: CopilotBlock[] = [
  {
    id: 'b1', label: 'Share screen',
    instruction: 'Ask if they can share their screen, and wait.',
    waitForResponse: true,
    rules: [{ id: 'r1', when: 'the user cannot share their screen', then: { action: 'jump', targetId: 'b2' } }],
  },
  { id: 'b2', label: 'Verbal walkthrough', instruction: 'Guide them by voice instead.', waitForResponse: false, rules: [] },
]

describe('buildCopilotBlockFlow', () => {
  it('returns empty string for no blocks', () => {
    expect(buildCopilotBlockFlow([])).toBe('')
  })
  it('renders each block label + instruction', () => {
    const s = buildCopilotBlockFlow(blocks)
    expect(s).toContain('Share screen')
    expect(s).toContain('Verbal walkthrough')
    expect(s).toContain('Ask if they can share')
  })
  it('marks wait-for-reply blocks', () => {
    expect(buildCopilotBlockFlow(blocks)).toMatch(/waits for/i)
  })
  it('renders a jump rule resolving targetId to the block label', () => {
    const s = buildCopilotBlockFlow(blocks)
    expect(s).toMatch(/cannot share their screen/)
    expect(s).toMatch(/jump to "Verbal walkthrough"/)
  })
  it('renders instruct + end actions', () => {
    const s = buildCopilotBlockFlow([
      { id: 'x', label: 'X', instruction: 'do x', waitForResponse: true, rules: [
        { id: 'r1', when: 'they object', then: { action: 'instruct', instruction: 'reassure them' } },
        { id: 'r2', when: 'they refuse', then: { action: 'end' } },
      ] },
    ])
    expect(s).toContain('reassure them')
    expect(s).toMatch(/end the (call|flow)/i)
  })
})

describe('normalizeBlocks', () => {
  it('drops blocks with no instruction and assigns ids', () => {
    const out = normalizeBlocks([
      { label: 'Keep', instruction: 'do it', waitForResponse: true, rules: [] },
      { label: 'Drop', instruction: '   ', rules: [] },
    ])
    expect(out).toHaveLength(1)
    expect(out[0].id).toBeTruthy()
    expect(out[0].label).toBe('Keep')
  })
  it('clamps rule actions to the three allowed and drops empty whens', () => {
    const out = normalizeBlocks([
      { label: 'B', instruction: 'x', rules: [
        { when: 'ok', then: { action: 'jump', targetId: 't' } },
        { when: '', then: { action: 'end' } },
        { when: 'bad', then: { action: 'frobnicate' as any } },
      ] },
    ])
    expect(out[0].rules).toHaveLength(1)
    expect(out[0].rules[0].then.action).toBe('jump')
  })
})
