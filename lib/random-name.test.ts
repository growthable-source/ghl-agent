import { describe, it, expect } from 'vitest'
import { generateAgentName, defaultAgentName, __AGENT_NAME_INTERNALS } from './random-name'

describe('generateAgentName', () => {
  it('returns "<Adjective> <Animal>" with both words title-cased', () => {
    for (let i = 0; i < 50; i++) {
      const name = generateAgentName()
      expect(name).toMatch(/^[A-Z][a-z]+ [A-Z][a-z]+$/)
    }
  })

  it('only uses adjectives + animals from the configured lists', () => {
    const adjSet = new Set(__AGENT_NAME_INTERNALS.ADJECTIVES.map(s => s.charAt(0).toUpperCase() + s.slice(1)))
    const animalSet = new Set(__AGENT_NAME_INTERNALS.ANIMALS.map(s => s.charAt(0).toUpperCase() + s.slice(1)))
    for (let i = 0; i < 100; i++) {
      const [adj, animal] = generateAgentName().split(' ')
      expect(adjSet.has(adj)).toBe(true)
      expect(animalSet.has(animal)).toBe(true)
    }
  })

  it('produces variety — at least 5 distinct names in 50 draws', () => {
    const seen = new Set<string>()
    for (let i = 0; i < 50; i++) seen.add(generateAgentName())
    expect(seen.size).toBeGreaterThanOrEqual(5)
  })
})

describe('defaultAgentName', () => {
  it('returns the supplied name when it has content', () => {
    expect(defaultAgentName('My Cool Agent')).toBe('My Cool Agent')
  })

  it('trims surrounding whitespace before returning', () => {
    expect(defaultAgentName('  Padded  ')).toBe('Padded')
  })

  it.each([undefined, null, '', '   ', 42, {}])(
    'falls back to a random name when supplied is %p',
    (input) => {
      const result = defaultAgentName(input)
      expect(result).toMatch(/^[A-Z][a-z]+ [A-Z][a-z]+$/)
    },
  )
})
