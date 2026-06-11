import { describe, it, expect } from 'vitest'
import {
  PUBLISH_FIRST_AGENT,
  getWorkflow,
  currentStepIndex,
  describeWorkflowProgress,
  DEFAULT_WORKFLOW_KEY,
} from './workflows'
import type { WorkspaceSetupState } from './setup-state'

function state(overrides: Partial<WorkspaceSetupState> = {}): WorkspaceSetupState {
  return {
    workspaceName: 'Test',
    plan: 'trial',
    agentCount: 0,
    activeAgentCount: 0,
    voiceAgentCount: 0,
    deployedChannels: [],
    knowledgeEntryCount: 0,
    knowledgeCollectionCount: 0,
    crmLocations: [],
    phoneNumberCount: 0,
    ...overrides,
  }
}

describe('publish-first-agent workflow', () => {
  it('is the default workflow and resolves by key', () => {
    expect(DEFAULT_WORKFLOW_KEY).toBe(PUBLISH_FIRST_AGENT.key)
    expect(getWorkflow('publish-first-agent')).toBe(PUBLISH_FIRST_AGENT)
  })

  it('falls back to the default for unknown / null keys', () => {
    expect(getWorkflow('nope')).toBe(PUBLISH_FIRST_AGENT)
    expect(getWorkflow(null)).toBe(PUBLISH_FIRST_AGENT)
    expect(getWorkflow(undefined)).toBe(PUBLISH_FIRST_AGENT)
  })

  it('goal requires an active agent AND a deployed channel', () => {
    expect(PUBLISH_FIRST_AGENT.goalReached(state())).toBe(false)
    expect(PUBLISH_FIRST_AGENT.goalReached(state({ activeAgentCount: 1 }))).toBe(false)
    expect(PUBLISH_FIRST_AGENT.goalReached(state({ deployedChannels: ['SMS'] }))).toBe(false)
    expect(
      PUBLISH_FIRST_AGENT.goalReached(state({ activeAgentCount: 1, deployedChannels: ['SMS'] })),
    ).toBe(true)
  })

  it('tracks current step through the funnel', () => {
    // Nothing done → step 0 (create agent)
    expect(currentStepIndex(PUBLISH_FIRST_AGENT, state())).toBe(0)
    // Agent created but inactive, no knowledge → step 1 (knowledge)
    expect(currentStepIndex(PUBLISH_FIRST_AGENT, state({ agentCount: 1 }))).toBe(1)
    // Agent + knowledge → step 2 (deploy channel)
    expect(
      currentStepIndex(PUBLISH_FIRST_AGENT, state({ agentCount: 1, knowledgeEntryCount: 3 })),
    ).toBe(2)
    // Everything except active toggle → step 3 (activate)
    expect(
      currentStepIndex(
        PUBLISH_FIRST_AGENT,
        state({ agentCount: 1, knowledgeEntryCount: 3, deployedChannels: ['Live_Chat'] }),
      ),
    ).toBe(3)
    // All done → past the end
    expect(
      currentStepIndex(
        PUBLISH_FIRST_AGENT,
        state({
          agentCount: 1,
          activeAgentCount: 1,
          knowledgeEntryCount: 3,
          deployedChannels: ['Live_Chat'],
        }),
      ),
    ).toBe(PUBLISH_FIRST_AGENT.steps.length)
  })

  it('renders DONE/TODO markers and goal status in the progress text', () => {
    const done = describeWorkflowProgress(
      PUBLISH_FIRST_AGENT,
      state({ agentCount: 1, activeAgentCount: 1, knowledgeEntryCount: 1, deployedChannels: ['SMS'] }),
    )
    expect(done).toContain('GOAL REACHED')
    expect(done).not.toContain('[TODO]')

    const fresh = describeWorkflowProgress(PUBLISH_FIRST_AGENT, state())
    expect(fresh).toContain('goal not yet reached')
    expect(fresh).toContain('[TODO] Create an agent')
  })
})
