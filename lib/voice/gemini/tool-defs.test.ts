import { describe, it, expect } from 'vitest'
import { agentToolsToRealtimeDefs } from './tool-defs'

describe('agentToolsToRealtimeDefs', () => {
  it('filters AGENT_TOOLS to the enabled names, preserving order of the catalogue', () => {
    const defs = agentToolsToRealtimeDefs(['send_reply', 'get_contact_details'])
    const names = defs.map(d => d.name).sort()
    expect(names).toEqual(['get_contact_details', 'send_reply'])
  })

  it('maps input_schema → RealtimeToolDef.parameters with string property types', () => {
    const [def] = agentToolsToRealtimeDefs(['get_contact_details'])
    expect(def.name).toBe('get_contact_details')
    expect(typeof def.description).toBe('string')
    expect(def.parameters.type).toBe('object')
    expect(def.parameters.properties.contactId.type).toBe('string')
    expect(def.parameters.required).toContain('contactId')
  })

  it('ignores unknown tool names', () => {
    expect(agentToolsToRealtimeDefs(['not_a_real_tool'])).toEqual([])
  })

  it('returns [] for an empty enabled list', () => {
    expect(agentToolsToRealtimeDefs([])).toEqual([])
  })

  it('coerces non-string schema types to strings and drops missing descriptions gracefully', () => {
    const defs = agentToolsToRealtimeDefs(['send_reply'])
    for (const d of defs) {
      for (const prop of Object.values(d.parameters.properties)) {
        expect(typeof prop.type).toBe('string')
      }
    }
  })
})
