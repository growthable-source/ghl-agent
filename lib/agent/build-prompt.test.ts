import { describe, it, expect } from 'vitest'
import { buildSystemPrompt, buildSystemPromptParts } from './build-prompt'
import type { AgentContext } from '@/types'

const ctx = (over: Partial<AgentContext> = {}): AgentContext => ({
  locationId: 'loc_test',
  contactId: 'contact_test',
  contact: {
    id: 'contact_test',
    firstName: 'Pat',
    name: 'Pat',
    phone: '+10000000000',
    tags: ['lead'],
    source: 'website',
  } as any,
  ...over,
})

describe('buildSystemPrompt', () => {
  it('substitutes the contact name into the context block', () => {
    const out = buildSystemPrompt(ctx())
    expect(out).toContain('Contact: Pat')
    expect(out).toContain('Phone: +10000000000')
  })

  it('falls back to "this contact" when no name available', () => {
    const out = buildSystemPrompt(ctx({ contact: { id: 'c', tags: [] } as any }))
    expect(out).toContain('Contact: this contact')
  })

  it('uses SMS as the channel when none provided', () => {
    const out = buildSystemPrompt(ctx())
    expect(out).toContain('Channel: SMS')
  })

  it('honors an explicit channel option', () => {
    const out = buildSystemPrompt(ctx(), { channel: 'WhatsApp' })
    expect(out).toContain('Channel: WhatsApp')
  })

  it('uses the caller-supplied base prompt when provided', () => {
    const out = buildSystemPrompt(ctx(), { customPrompt: 'You are CustomBot, a friendly concierge.' })
    expect(out.startsWith('You are CustomBot, a friendly concierge.')).toBe(true)
  })

  it('appends optional context blocks in order: qualifying, detection, listening, memory', () => {
    const out = buildSystemPrompt(ctx(), {
      qualifyingBlock: '\n\n## QUAL_BLOCK',
      detectionRulesBlock: '\n\n## DETECT_BLOCK',
      listeningRulesBlock: '\n\n## LISTEN_BLOCK',
      contactMemoryBlock: '\n\n## MEMORY_BLOCK',
    })
    const idxQual = out.indexOf('## QUAL_BLOCK')
    const idxDetect = out.indexOf('## DETECT_BLOCK')
    const idxListen = out.indexOf('## LISTEN_BLOCK')
    const idxMem = out.indexOf('## MEMORY_BLOCK')
    expect(idxQual).toBeGreaterThan(0)
    expect(idxDetect).toBeGreaterThan(idxQual)
    expect(idxListen).toBeGreaterThan(idxDetect)
    expect(idxMem).toBeGreaterThan(idxListen)
  })

  it('puts platform guidelines after persona/integrations blocks', () => {
    const out = buildSystemPrompt(ctx(), {
      platformGuidelinesBlock: '\n\n## PLATFORM_GUIDELINES',
      connectedIntegrationsBlock: '\n\n## INTEGRATIONS',
    })
    const idxPlatform = out.indexOf('## PLATFORM_GUIDELINES')
    const idxInteg = out.indexOf('## INTEGRATIONS')
    expect(idxPlatform).toBeGreaterThan(0)
    expect(idxInteg).toBeGreaterThan(idxPlatform)
  })

  it('renders the default fallback line when no fallback config is given', () => {
    const out = buildSystemPrompt(ctx())
    expect(out).toContain("Acknowledge that you don't have that information")
  })

  it('renders the transfer-only fallback', () => {
    const out = buildSystemPrompt(ctx(), { fallback: { behavior: 'transfer' } })
    expect(out).toContain('transfer the conversation to a human')
  })

  it('renders a custom fallback message', () => {
    const out = buildSystemPrompt(ctx(), {
      fallback: { behavior: 'message', message: 'Hold tight, I will check.' },
    })
    expect(out).toContain('Hold tight, I will check.')
  })

  it('treats an empty options object as all-defaults', () => {
    const out = buildSystemPrompt(ctx(), {})
    expect(out).toContain('Channel: SMS')
    expect(out).toContain('Contact: Pat')
  })
})

describe('buildSystemPromptParts (prompt-cache split)', () => {
  it('keeps the per-minute timestamp OUT of the cacheable prefix', () => {
    const { prefix, volatile } = buildSystemPromptParts(ctx())
    // The prefix is what carries cache_control — if it contained the
    // current time it would change every minute and never cache.
    expect(prefix).not.toContain('Current date/time')
    expect(volatile).toContain('Current date/time')
  })

  it('puts the date-derived slot guidance in the volatile tail', () => {
    const { prefix, volatile } = buildSystemPromptParts(ctx())
    expect(prefix).not.toContain('get_available_slots, pass startDate')
    expect(volatile).toContain('get_available_slots, pass startDate')
  })

  it('prefix + volatile equals the full string prompt', () => {
    const { prefix, volatile } = buildSystemPromptParts(ctx(), { channel: 'WhatsApp' })
    expect(prefix + volatile).toBe(buildSystemPrompt(ctx(), { channel: 'WhatsApp' }))
  })

  it('keeps the stable instructions and contact context in the prefix', () => {
    const { prefix } = buildSystemPromptParts(ctx())
    expect(prefix).toContain('## Your Behaviour')
    expect(prefix).toContain('Contact: Pat')
    expect(prefix).toContain('Channel: SMS')
  })
})
