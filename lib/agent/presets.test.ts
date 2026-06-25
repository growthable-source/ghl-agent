import { describe, it, expect } from 'vitest'
import { AGENT_PRESETS, getPreset } from './presets'

describe('AGENT_PRESETS registry', () => {
  it('exports the four built-in presets', () => {
    const ids = AGENT_PRESETS.map(p => p.id).sort()
    expect(ids).toEqual(['booking', 'conversational', 'custom', 'voice'])
  })

  it('non-voice presets are guided; voice is autonomous (ungated booking on a live call)', () => {
    for (const p of AGENT_PRESETS) {
      expect(p.autonomyMode).toBe(p.id === 'voice' ? 'autonomous' : 'guided')
    }
  })
})

describe('Voice Agent preset (book + capture defaults)', () => {
  const voice = getPreset('voice')!

  it('enables the booking + capture tools explicitly', () => {
    for (const n of ['get_available_slots', 'book_appointment', 'upsert_contact', 'create_contact', 'find_contact_by_email_or_phone']) {
      const d = voice.tools.find(t => t.toolName === n)
      expect(d, `expected a delta for ${n}`).toBeTruthy()
      expect(d!.enabled, `${n} should be enabled`).toBe(true)
    }
  })

  it('keeps text-send tools disabled', () => {
    for (const n of ['send_reply', 'send_sms', 'send_email']) {
      expect(voice.tools.find(t => t.toolName === n)?.enabled).toBe(false)
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

describe('Voice Agent preset', () => {
  const voice = getPreset('voice')!

  it('disables every text-channel send tool', () => {
    for (const t of ['send_reply', 'send_sms', 'send_email']) {
      const delta = voice.tools.find(d => d.toolName === t)
      expect(delta?.enabled).toBe(false)
    }
  })

  it('routes book_appointment failure to transfer_to_human', () => {
    const delta = voice.tools.find(t => t.toolName === 'book_appointment')
    expect(delta?.onFailure).toBe('transfer_to_human')
  })

  it('disables workflow enrolment by default', () => {
    expect(voice.tools.find(t => t.toolName === 'add_to_workflow')?.enabled).toBe(false)
    expect(voice.tools.find(t => t.toolName === 'remove_from_workflow')?.enabled).toBe(false)
  })
})
