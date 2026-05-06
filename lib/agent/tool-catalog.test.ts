import { describe, it, expect } from 'vitest'
import { AGENT_TOOLS, SAFE_READ_ONLY_TOOLS, constrainWorkflowTool } from './tool-catalog'

describe('AGENT_TOOLS', () => {
  it('contains the canonical send tools', () => {
    const names = AGENT_TOOLS.map(t => t.name)
    expect(names).toContain('send_reply')
    expect(names).toContain('send_sms')
    expect(names).toContain('send_email')
  })

  it('contains the booking tool trio', () => {
    const names = AGENT_TOOLS.map(t => t.name)
    expect(names).toContain('get_available_slots')
    expect(names).toContain('book_appointment')
    expect(names).toContain('create_appointment_note')
  })

  it('every tool has a name, description, and object input_schema', () => {
    for (const t of AGENT_TOOLS) {
      expect(t.name).toBeTruthy()
      expect(t.description).toBeTruthy()
      expect((t.input_schema as any).type).toBe('object')
    }
  })

  it('tool names are unique', () => {
    const names = AGENT_TOOLS.map(t => t.name)
    expect(new Set(names).size).toBe(names.length)
  })
})

describe('SAFE_READ_ONLY_TOOLS', () => {
  it('only lists tools that exist in the catalog', () => {
    const catalogNames = new Set(AGENT_TOOLS.map(t => t.name))
    for (const name of SAFE_READ_ONLY_TOOLS) {
      expect(catalogNames.has(name)).toBe(true)
    }
  })

  it('does not list any write tool', () => {
    // None of these should ever leak into the read-only set — they all
    // mutate CRM state and would bypass sandbox stubbing.
    const writeTools = ['send_reply', 'send_sms', 'send_email', 'book_appointment', 'create_contact', 'update_contact_field', 'update_contact_tags', 'transfer_to_human']
    for (const w of writeTools) {
      expect(SAFE_READ_ONLY_TOOLS.has(w)).toBe(false)
    }
  })
})

describe('constrainWorkflowTool', () => {
  const baseTool = AGENT_TOOLS.find(t => t.name === 'add_to_workflow')!

  it('publishes the tool unchanged when picks is empty', () => {
    expect(constrainWorkflowTool(baseTool, undefined, 'enroll')).toEqual([baseTool])
    expect(constrainWorkflowTool(baseTool, [], 'enroll')).toEqual([baseTool])
  })

  it('rewrites workflowId to an enum of pinned ids when picks is provided', () => {
    const picks = [
      { id: 'wf_1', name: 'Lead Nurture' },
      { id: 'wf_2', name: 'Won Deal Followup' },
    ]
    const [out] = constrainWorkflowTool(baseTool, picks, 'enroll')
    const props = (out.input_schema as any).properties
    expect(props.workflowId.enum).toEqual(['wf_1', 'wf_2'])
    // Description is enriched with the human-readable directory.
    expect(out.description).toContain('Lead Nurture')
    expect(out.description).toContain('Won Deal Followup')
  })

  it('phrases the workflow direction based on the verb argument', () => {
    const picks = [{ id: 'wf_1', name: 'Demo' }]
    const [enroll] = constrainWorkflowTool(baseTool, picks, 'enroll')
    const [remove] = constrainWorkflowTool(baseTool, picks, 'remove')
    expect((enroll.input_schema as any).properties.workflowId.description).toContain('enroll')
    expect((remove.input_schema as any).properties.workflowId.description).toContain('remove')
  })
})
