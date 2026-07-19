import { describe, it, expect } from 'vitest'
import { classifyOutboundSource } from './autopilot-settings'

describe('classifyOutboundSource', () => {
  it('classifies workflow/automation sources', () => {
    expect(classifyOutboundSource({ source: 'workflow' })).toBe('workflow')
    expect(classifyOutboundSource({ source: 'WORKFLOW' })).toBe('workflow')
    expect(classifyOutboundSource({ source: 'campaign' })).toBe('workflow')
    expect(classifyOutboundSource({ source: 'bulk_actions' })).toBe('workflow')
    expect(classifyOutboundSource({ meta: { source: 'automation' } })).toBe('workflow')
  })

  it('NEVER classifies the agent/API own-send as manual or workflow', () => {
    // This is the critical case: the agent's own reply comes back as an
    // OutboundMessage. Misclassifying it would pause the agent after every
    // message it sends.
    expect(classifyOutboundSource({ source: 'api' })).toBeNull()
    expect(classifyOutboundSource({ source: 'integration' })).toBeNull()
    // API send that (defensively) also carried a userId must still be ignored.
    expect(classifyOutboundSource({ source: 'api', userId: 'u_1' })).toBeNull()
  })

  it('classifies a human operator send (has a userId) as manual', () => {
    expect(classifyOutboundSource({ userId: 'u_123' })).toBe('manual')
    expect(classifyOutboundSource({ source: 'app', userId: 'u_123' })).toBe('manual')
    expect(classifyOutboundSource({ meta: { userId: 'u_123' } })).toBe('manual')
    expect(classifyOutboundSource({ user: { id: 'u_123' } })).toBe('manual')
  })

  it('returns null for unknown / unattributable sends (safe default = do not sleep)', () => {
    expect(classifyOutboundSource({})).toBeNull()
    expect(classifyOutboundSource({ source: '' })).toBeNull()
    expect(classifyOutboundSource(null)).toBeNull()
    expect(classifyOutboundSource(undefined)).toBeNull()
  })
})
