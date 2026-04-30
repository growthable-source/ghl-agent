import { describe, it, expect } from 'vitest'
import { pickMessagingType } from './meta-client'

describe('pickMessagingType — 24h messaging window', () => {
  const NOW = new Date('2026-04-30T12:00:00Z').getTime()
  const FIVE_MIN_AGO = new Date(NOW - 5 * 60_000).toISOString()
  const TWENTY_THREE_HOURS_AGO = new Date(NOW - 23 * 60 * 60_000).toISOString()
  const TWENTY_FOUR_HOURS_AGO = new Date(NOW - 24 * 60 * 60_000).toISOString()
  const TWENTY_FIVE_HOURS_AGO = new Date(NOW - 25 * 60 * 60_000).toISOString()

  it('uses RESPONSE inside the window', () => {
    expect(pickMessagingType({ lastInboundAt: FIVE_MIN_AGO }, NOW))
      .toEqual({ messagingType: 'RESPONSE' })
    expect(pickMessagingType({ lastInboundAt: TWENTY_THREE_HOURS_AGO }, NOW))
      .toEqual({ messagingType: 'RESPONSE' })
  })

  it('flips to MESSAGE_TAG with HUMAN_AGENT default once the window closes', () => {
    // Exactly 24h is the boundary — Meta's policy is `< 24h`, so 24h
    // exactly is OUT of the window. Picking HUMAN_AGENT here is the safe
    // default for a sales/CS agent re-engaging.
    expect(pickMessagingType({ lastInboundAt: TWENTY_FOUR_HOURS_AGO }, NOW))
      .toEqual({ messagingType: 'MESSAGE_TAG', tag: 'HUMAN_AGENT' })
    expect(pickMessagingType({ lastInboundAt: TWENTY_FIVE_HOURS_AGO }, NOW))
      .toEqual({ messagingType: 'MESSAGE_TAG', tag: 'HUMAN_AGENT' })
  })

  it('treats null lastInboundAt as out-of-window (safer default)', () => {
    expect(pickMessagingType({ lastInboundAt: null }, NOW))
      .toEqual({ messagingType: 'MESSAGE_TAG', tag: 'HUMAN_AGENT' })
    expect(pickMessagingType({}, NOW))
      .toEqual({ messagingType: 'MESSAGE_TAG', tag: 'HUMAN_AGENT' })
  })

  it('treats unparseable lastInboundAt as out-of-window', () => {
    expect(pickMessagingType({ lastInboundAt: 'not a date' }, NOW))
      .toEqual({ messagingType: 'MESSAGE_TAG', tag: 'HUMAN_AGENT' })
  })

  it('honours an explicit messagingType override', () => {
    // Operator wants to force a specific tag (e.g., a confirmed event
    // update) even though the window is open — the override always wins.
    expect(pickMessagingType({ lastInboundAt: FIVE_MIN_AGO, messagingType: 'MESSAGE_TAG', tag: 'CONFIRMED_EVENT_UPDATE' }, NOW))
      .toEqual({ messagingType: 'MESSAGE_TAG', tag: 'CONFIRMED_EVENT_UPDATE' })
    expect(pickMessagingType({ lastInboundAt: TWENTY_FIVE_HOURS_AGO, messagingType: 'RESPONSE' }, NOW))
      .toEqual({ messagingType: 'RESPONSE' })
  })
})
