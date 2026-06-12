import { describe, it, expect } from 'vitest'
import { parseVocabularyRules, buildVocabularyBlock, applyVocabularyRules } from './vocabulary'

describe('parseVocabularyRules', () => {
  it('normalises valid rules and drops junk', () => {
    const rules = parseVocabularyRules([
      { never: '  HighLevel ', sayInstead: ' your CRM ' },
      { never: 'GHL' },
      { never: '', sayInstead: 'x' },
      { nope: true },
      'not-an-object',
    ])
    expect(rules).toEqual([
      { never: 'HighLevel', sayInstead: 'your CRM' },
      { never: 'GHL', sayInstead: null },
    ])
  })

  it('merges legacy neverSayList without duplicating upgraded rules', () => {
    const rules = parseVocabularyRules(
      [{ never: 'HighLevel', sayInstead: 'your CRM' }],
      ['highlevel', 'cheap'],
    )
    expect(rules).toEqual([
      { never: 'HighLevel', sayInstead: 'your CRM' },
      { never: 'cheap', sayInstead: null },
    ])
  })

  it('handles null/undefined input', () => {
    expect(parseVocabularyRules(null)).toEqual([])
    expect(parseVocabularyRules(undefined, null)).toEqual([])
  })
})

describe('buildVocabularyBlock', () => {
  it('is empty with no rules', () => {
    expect(buildVocabularyBlock([])).toBe('')
  })

  it('includes replacements with examples and plain bans', () => {
    const block = buildVocabularyBlock([
      { never: 'HighLevel', sayInstead: 'your CRM' },
      { never: 'cheap', sayInstead: null },
    ])
    expect(block).toContain('NEVER say "HighLevel" — say "your CRM" instead.')
    expect(block).toContain('❌')
    expect(block).toContain('NEVER say "cheap" — rephrase')
    expect(block).toContain('override EVERYTHING')
  })
})

describe('applyVocabularyRules', () => {
  const rules = [
    { never: 'HighLevel', sayInstead: 'your CRM' },
    { never: 'GHL', sayInstead: 'your CRM' },
    { never: 'cheap', sayInstead: null }, // ban-only — not enforced
  ]

  it('replaces case-insensitively with word boundaries', () => {
    expect(applyVocabularyRules('Workflows in HighLevel are powerful. HIGHLEVEL rocks. Use highlevel.', rules))
      .toBe('Workflows in your CRM are powerful. your CRM rocks. Use your CRM.')
  })

  it('replaces multi-word phrases', () => {
    const r = [{ never: 'Go HighLevel', sayInstead: 'your CRM' }]
    expect(applyVocabularyRules('Try Go HighLevel today', r)).toBe('Try your CRM today')
  })

  it('respects word boundaries (no partial-word mangling)', () => {
    expect(applyVocabularyRules('GHLX is unrelated', rules)).toBe('GHLX is unrelated')
  })

  it('leaves ban-only rules untouched and handles empty input', () => {
    expect(applyVocabularyRules('cheap and cheerful', rules)).toBe('cheap and cheerful')
    expect(applyVocabularyRules('', rules)).toBe('')
  })

  it('survives regex-special characters in terms', () => {
    const r = [{ never: 'A+ (Pro)', sayInstead: 'Premium' }]
    expect(applyVocabularyRules('Get A+ (Pro) now', r)).toBe('Get Premium now')
  })
})
