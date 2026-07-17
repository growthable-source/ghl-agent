import { describe, it, expect } from 'vitest'
import {
  renderTemplate,
  resolveTemplates,
  landingPathForVertical,
  buildTemplateVars,
} from './templates'

describe('renderTemplate', () => {
  it('substitutes {{vars}}', () => {
    expect(renderTemplate('Hi {{businessName}}!', { businessName: 'Acme' })).toBe('Hi Acme!')
  })
  it('renders unknown vars as empty string', () => {
    expect(renderTemplate('A{{nope}}B', {})).toBe('AB')
  })
  it('tolerates whitespace inside braces', () => {
    expect(renderTemplate('{{ businessName }}', { businessName: 'Acme' })).toBe('Acme')
  })
})

describe('buildTemplateVars', () => {
  it('merges base fields with string metadata values', () => {
    const vars = buildTemplateVars(
      { businessName: 'Acme', websiteDomain: 'acme.com', vertical: 'gym' },
      { ownerFirstName: 'Sam', ignored: 42 },
    )
    expect(vars).toEqual({
      businessName: 'Acme',
      websiteDomain: 'acme.com',
      vertical: 'gym',
      ownerFirstName: 'Sam',
    })
  })
  it('metadata cannot shadow base fields', () => {
    const vars = buildTemplateVars(
      { businessName: 'Acme', websiteDomain: 'acme.com', vertical: null },
      { businessName: 'Evil Corp' },
    )
    expect(vars.businessName).toBe('Acme')
  })
})

describe('resolveTemplates', () => {
  const vars = { businessName: 'Shred Gym', websiteDomain: 'shred.fit', vertical: 'gym' }

  it('uses the global default when no vertical/overrides', () => {
    const t = resolveTemplates({ vertical: null, overrides: null, vars: { ...vars, vertical: '' } })
    expect(t.prompt).toContain('Shred Gym')
    expect(t.firstMessage).toContain('Shred Gym')
  })
  it('applies a vertical preset when one exists', () => {
    const t = resolveTemplates({ vertical: 'gym', overrides: null, vars })
    expect(t.prompt).toContain('membership')
  })
  it('unknown vertical falls back to the default template', () => {
    const t = resolveTemplates({ vertical: 'submarine-dealer', overrides: null, vars })
    expect(t.prompt).toContain('Shred Gym')
  })
  it('per-prospect overrides beat everything and still render vars', () => {
    const t = resolveTemplates({
      vertical: 'gym',
      overrides: { prompt: 'Custom for {{businessName}}', firstMessage: 'Yo {{businessName}}' },
      vars,
    })
    expect(t.prompt).toBe('Custom for Shred Gym')
    expect(t.firstMessage).toBe('Yo Shred Gym')
  })
})

describe('landingPathForVertical', () => {
  it('maps known verticals', () => {
    expect(landingPathForVertical('med-spa')).toBe('/ai-for-med-spas')
    expect(landingPathForVertical('gym')).toBe('/ai-for-gyms')
  })
  it('falls back to /ai-receptionist', () => {
    expect(landingPathForVertical('unknown')).toBe('/ai-receptionist')
    expect(landingPathForVertical(null)).toBe('/ai-receptionist')
  })
})
