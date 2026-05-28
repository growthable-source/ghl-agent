import { describe, it, expect } from 'vitest'
import { AGENT_PRESETS, getPreset } from './presets'

describe('AGENT_PRESETS registry', () => {
  it('exports the three V1 presets', () => {
    const ids = AGENT_PRESETS.map(p => p.id).sort()
    expect(ids).toEqual(['booking', 'conversational', 'custom'])
  })

  it('every preset has guided autonomy by default', () => {
    for (const p of AGENT_PRESETS) {
      expect(p.autonomyMode).toBe('guided')
    }
  })
})

describe('getPreset', () => {
  it('returns null for an unknown id', () => {
    expect(getPreset('nope')).toBeNull()
  })

  it('returns the matching preset', () => {
    expect(getPreset('booking')?.label).toBe('Booking Bot')
  })
})

describe('Conversational Bot preset', () => {
  const conv = getPreset('conversational')!

  it('disables book_appointment', () => {
    const delta = conv.tools.find(t => t.toolName === 'book_appointment')
    expect(delta?.enabled).toBe(false)
  })

  it('disables create_shopify_checkout', () => {
    const delta = conv.tools.find(t => t.toolName === 'create_shopify_checkout')
    expect(delta?.enabled).toBe(false)
  })
})

describe('Booking Bot preset', () => {
  const booking = getPreset('booking')!

  it('does NOT disable book_appointment (lets catalog default enabled stand)', () => {
    const delta = booking.tools.find(t => t.toolName === 'book_appointment')
    // delta exists for onFailure override, but enabled is undefined (not false)
    expect(delta?.enabled).toBeUndefined()
  })

  it('sets book_appointment.onFailure to transfer_to_human', () => {
    const delta = booking.tools.find(t => t.toolName === 'book_appointment')
    expect(delta?.onFailure).toBe('transfer_to_human')
  })

  it('disables commerce tools', () => {
    expect(
      booking.tools.find(t => t.toolName === 'create_shopify_checkout')?.enabled,
    ).toBe(false)
  })
})

describe('Custom preset', () => {
  it('has an empty tools array', () => {
    expect(getPreset('custom')?.tools).toEqual([])
  })
})
