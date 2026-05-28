import { describe, it, expect } from 'vitest'
import { collectAgentReferences } from './collect'

describe('collectAgentReferences', () => {
  it('returns empty array when agent has no references', () => {
    const agent = {
      id: 'a1', calendarId: null,
      stopConditions: [], triggers: [],
    } as any
    expect(collectAgentReferences(agent)).toEqual([])
  })

  it('emits a calendar reference when calendarId is set', () => {
    const agent = {
      id: 'a1', calendarId: 'cal_123',
      stopConditions: [], triggers: [],
    } as any
    expect(collectAgentReferences(agent)).toEqual([
      { resourceType: 'calendar', resourceId: 'cal_123', sourceField: 'Agent.calendarId' },
    ])
  })

  it('emits workflow references from stop conditions', () => {
    const agent = {
      id: 'a1', calendarId: null,
      stopConditions: [
        { id: 'sc1', enrollWorkflowId: 'wf_enroll', removeWorkflowId: null },
        { id: 'sc2', enrollWorkflowId: null, removeWorkflowId: 'wf_remove' },
        { id: 'sc3', enrollWorkflowId: 'wf_both_a', removeWorkflowId: 'wf_both_b' },
      ],
      triggers: [],
    } as any
    expect(collectAgentReferences(agent)).toEqual([
      { resourceType: 'workflow', resourceId: 'wf_enroll', sourceField: 'StopCondition[sc1].enrollWorkflowId' },
      { resourceType: 'workflow', resourceId: 'wf_remove', sourceField: 'StopCondition[sc2].removeWorkflowId' },
      { resourceType: 'workflow', resourceId: 'wf_both_a', sourceField: 'StopCondition[sc3].enrollWorkflowId' },
      { resourceType: 'workflow', resourceId: 'wf_both_b', sourceField: 'StopCondition[sc3].removeWorkflowId' },
    ])
  })

  it('combines calendar + workflow references in source order', () => {
    const agent = {
      id: 'a1', calendarId: 'cal_x',
      stopConditions: [{ id: 'sc1', enrollWorkflowId: 'wf_x', removeWorkflowId: null }],
      triggers: [],
    } as any
    const refs = collectAgentReferences(agent)
    expect(refs).toHaveLength(2)
    expect(refs[0].resourceType).toBe('calendar')
    expect(refs[1].resourceType).toBe('workflow')
  })

  it('skips empty-string IDs (treat as unset)', () => {
    const agent = {
      id: 'a1', calendarId: '',
      stopConditions: [{ id: 'sc1', enrollWorkflowId: '', removeWorkflowId: null }],
      triggers: [],
    } as any
    expect(collectAgentReferences(agent)).toEqual([])
  })
})
