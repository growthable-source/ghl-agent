import { describe, it, expect } from 'vitest'
import { AGENT_TOOLS, SAFE_READ_ONLY_TOOLS, constrainWorkflowTool, VOICE_AGENT_TOOL_NAMES, anthropicToolToVapi } from './tool-catalog'

describe('VOICE_AGENT_TOOL_NAMES', () => {
  it('only lists tools that exist in the catalog', () => {
    const catalog = new Set(AGENT_TOOLS.map(t => t.name))
    for (const name of VOICE_AGENT_TOOL_NAMES) {
      expect(catalog.has(name), `${name} should exist in AGENT_TOOLS`).toBe(true)
    }
  })

  it('includes the book + capture core', () => {
    for (const n of ['get_available_slots', 'book_appointment', 'upsert_contact', 'create_contact', 'find_contact_by_email_or_phone']) {
      expect(VOICE_AGENT_TOOL_NAMES).toContain(n)
    }
  })

  it('excludes text-send / channel-inappropriate tools', () => {
    for (const n of ['send_reply', 'send_sms', 'send_email', 'end_conversation']) {
      expect(VOICE_AGENT_TOOL_NAMES).not.toContain(n)
    }
  })

  it('keeps only enabled voice tools when intersected with enabledTools', () => {
    const enabled = new Set(['book_appointment', 'send_reply', 'upsert_contact'])
    const kept = (VOICE_AGENT_TOOL_NAMES as readonly string[]).filter(n => enabled.has(n))
    expect(kept).toContain('book_appointment')
    expect(kept).toContain('upsert_contact')
    expect(kept).not.toContain('send_reply')
  })
})

describe('anthropicToolToVapi', () => {
  it('reshapes a catalog tool into the Vapi function envelope and strips internal metadata', () => {
    const book = AGENT_TOOLS.find(t => t.name === 'book_appointment')!
    const vapi = anthropicToolToVapi({ name: book.name, description: book.description as string, input_schema: book.input_schema as any })
    expect(vapi.type).toBe('function')
    expect(vapi.function.name).toBe('book_appointment')
    expect(vapi.function.parameters).toEqual(book.input_schema)
    expect((vapi.function as any).defaultUseWhen).toBeUndefined()
    expect((vapi.function as any).enforcement).toBeUndefined()
  })
})

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
