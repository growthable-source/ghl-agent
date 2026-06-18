import { describe, it, expect } from 'vitest'
import { buildProcedureBlock, evaluateStepRules, type ProcStep } from './procedure'

const steps: ProcStep[] = [
  { id: 's1', order: 0, title: 'Greet', instruction: 'Welcome them', question: null, collectFieldKey: null, rules: [] },
  { id: 's2', order: 1, title: 'Plan', instruction: 'Ask their plan', question: 'Which plan?', collectFieldKey: null, rules: [{ when: 'enterprise', action: 'jump', target: 's4' }] },
  { id: 's3', order: 2, title: 'Card', instruction: 'Collect card', question: null, collectFieldKey: null, rules: [] },
  { id: 's4', order: 3, title: 'Done', instruction: 'Confirm', question: null, collectFieldKey: null, rules: [] },
]

describe('buildProcedureBlock', () => {
  it('states current step and progress for procedural', () => {
    const b = buildProcedureBlock(steps, 1, 'advanced')
    expect(b).toContain('Step 2 of 4')
    expect(b).toContain('Plan')
    expect(b).toContain('Which plan?')
  })
  it('returns empty string when there are no steps', () => {
    expect(buildProcedureBlock([], 0, 'simple')).toBe('')
  })
  it('clamps an out-of-range current order to the last step', () => {
    const b = buildProcedureBlock(steps, 99, 'simple')
    expect(b).toContain('Step 4 of 4')
  })
})

describe('evaluateStepRules', () => {
  it('jumps to target step on matching answer', () => {
    expect(evaluateStepRules(steps[1], 'we want enterprise')).toEqual({ action: 'jump', target: 's4' })
  })
  it('returns advance when no rule matches', () => {
    expect(evaluateStepRules(steps[1], 'starter please')).toEqual({ action: 'advance' })
  })
  it('returns advance for a step with no rules', () => {
    expect(evaluateStepRules(steps[0], 'hi')).toEqual({ action: 'advance' })
  })
})
