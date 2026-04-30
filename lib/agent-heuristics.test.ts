import { describe, it, expect } from 'vitest'
import {
  hasBookingIntent,
  isShortAffirmation,
  looksLikeOfferedTime,
  formatRelativeAge,
  widgetPubsubChannelName,
} from './agent-heuristics'

describe('hasBookingIntent', () => {
  it('catches the screenshot phrase that previously slipped through', () => {
    // The original "what kind of appointment" bug — "book an appointment"
    // wasn't in the pattern list, so tool_choice didn't fire.
    expect(hasBookingIntent('can I book an appointment?')).toBe(true)
  })

  it('catches the obvious phrasings', () => {
    expect(hasBookingIntent('book a call')).toBe(true)
    expect(hasBookingIntent('schedule a meeting')).toBe(true)
    expect(hasBookingIntent('I want to book a demo')).toBe(true)
    expect(hasBookingIntent('what times work?')).toBe(true)
    expect(hasBookingIntent('any availability tomorrow?')).toBe(true)
  })

  it('is case-insensitive', () => {
    expect(hasBookingIntent('BOOK AN APPOINTMENT')).toBe(true)
    expect(hasBookingIntent('Schedule A Call')).toBe(true)
  })

  it('returns false for unrelated chatter', () => {
    expect(hasBookingIntent('what are your prices?')).toBe(false)
    expect(hasBookingIntent('is your product good?')).toBe(false)
    expect(hasBookingIntent('hi')).toBe(false)
  })

  it('handles null/undefined safely', () => {
    expect(hasBookingIntent(null)).toBe(false)
    expect(hasBookingIntent(undefined)).toBe(false)
    expect(hasBookingIntent('')).toBe(false)
  })
})

describe('isShortAffirmation', () => {
  it('catches the screenshot bug — "Yes" alone after a slot offer', () => {
    // The user typed "Yes" and the agent went in circles. This is the
    // single most important assertion in this file: the heuristic must
    // recognise "Yes" as a confirmation.
    expect(isShortAffirmation('Yes')).toBe(true)
    expect(isShortAffirmation('yes')).toBe(true)
    expect(isShortAffirmation('YES')).toBe(true)
    expect(isShortAffirmation('yes!')).toBe(true)
    expect(isShortAffirmation('yes.')).toBe(true)
  })

  it('catches common variants', () => {
    expect(isShortAffirmation('yep')).toBe(true)
    expect(isShortAffirmation('yeah')).toBe(true)
    expect(isShortAffirmation('sure')).toBe(true)
    expect(isShortAffirmation('sounds good')).toBe(true)
    expect(isShortAffirmation('that works')).toBe(true)
    expect(isShortAffirmation('perfect')).toBe(true)
    expect(isShortAffirmation('book it')).toBe(true)
    expect(isShortAffirmation("let's do it")).toBe(true)
  })

  it('catches the user typing the time back ("11.45")', () => {
    // Note: this is NOT a confirmation in our heuristic — the contact is
    // restating a time, not saying yes. The pin should NOT fire here;
    // the agent should still treat it as a fresh statement and likely
    // respond by booking that exact time. We rely on the system prompt
    // for that path, not the affirmation pin.
    expect(isShortAffirmation('11.45')).toBe(false)
    expect(isShortAffirmation('11:45am')).toBe(false)
  })

  it('rejects timezone-request "yes-shaped" replies', () => {
    // The classic false-positive trap: starts with "ok" or "sure" but is
    // really asking to re-fetch in a different zone. Pinning to
    // book_appointment here would book without the user's consent.
    expect(isShortAffirmation('ok but in PST')).toBe(false)
    expect(isShortAffirmation('sure, can you do London time?')).toBe(false)
    expect(isShortAffirmation('ok, what about EST?')).toBe(false)
    expect(isShortAffirmation('yes in Sydney time')).toBe(false)
  })

  it('rejects rejections', () => {
    expect(isShortAffirmation("can't do that")).toBe(false)
    expect(isShortAffirmation('nope')).toBe(false)
    expect(isShortAffirmation('something else')).toBe(false)
    expect(isShortAffirmation('nothing earlier?')).toBe(false)
    expect(isShortAffirmation('got anything later?')).toBe(false)
  })

  it('rejects questions', () => {
    expect(isShortAffirmation('yes?')).toBe(false)
    expect(isShortAffirmation('that works?')).toBe(false)
  })

  it('rejects long messages even if they contain a yes-word', () => {
    // A 60-char message that happens to start with "ok" probably has
    // more nuance than a confirmation. Don't pin.
    expect(isShortAffirmation('ok i think that one might work but only if you can also do email confirmation')).toBe(false)
  })

  it('handles null/undefined/empty safely', () => {
    expect(isShortAffirmation(null)).toBe(false)
    expect(isShortAffirmation(undefined)).toBe(false)
    expect(isShortAffirmation('')).toBe(false)
    expect(isShortAffirmation('   ')).toBe(false)
  })
})

describe('looksLikeOfferedTime', () => {
  it('detects the agent having proposed specific times', () => {
    expect(looksLikeOfferedTime('Monday May 5 at 11:45am — does that work?')).toBe(true)
    expect(looksLikeOfferedTime('I have Monday at 2:30pm available — does that work for you?')).toBe(true)
    expect(looksLikeOfferedTime('How about 11:45am EST or 2:30pm EST?')).toBe(true)
    expect(looksLikeOfferedTime('I can do tomorrow at 10am or Monday at 2:30pm. Which works better?')).toBe(true)
  })

  it('rejects generic outbounds without a time', () => {
    expect(looksLikeOfferedTime('Sure, what would you like to discuss?')).toBe(false)
    expect(looksLikeOfferedTime('Got it — let me check.')).toBe(false)
  })

  it('rejects time mentions without an offer phrase', () => {
    // Just mentioning 11:45am isn't enough — needs "does that work" /
    // "how about" / "i can do" to count as an actual offer.
    expect(looksLikeOfferedTime('Our office hours are 9am to 5pm.')).toBe(false)
  })

  it('handles null/undefined safely', () => {
    expect(looksLikeOfferedTime(null)).toBe(false)
    expect(looksLikeOfferedTime(undefined)).toBe(false)
    expect(looksLikeOfferedTime('')).toBe(false)
  })
})

describe('formatRelativeAge', () => {
  // Anchor: 2026-04-30T12:00:00Z
  const NOW_MS = new Date('2026-04-30T12:00:00Z').getTime()

  it('returns "[just now]" for very recent times', () => {
    const t = new Date(NOW_MS - 30_000).toISOString() // 30 seconds ago
    expect(formatRelativeAge(t, NOW_MS)).toBe('[just now]')
  })

  it('returns minutes for sub-hour gaps', () => {
    const t = new Date(NOW_MS - 5 * 60_000).toISOString()
    expect(formatRelativeAge(t, NOW_MS)).toBe('[5 minutes ago]')
  })

  it('returns hours for sub-day gaps', () => {
    expect(formatRelativeAge(new Date(NOW_MS - 60 * 60_000).toISOString(), NOW_MS)).toBe('[1 hour ago]')
    expect(formatRelativeAge(new Date(NOW_MS - 3 * 60 * 60_000).toISOString(), NOW_MS)).toBe('[3 hours ago]')
  })

  it('returns days for sub-fortnight gaps — covers the screenshot case', () => {
    // The "agent says I'll follow up next week then 6 days later forgets"
    // scenario depends on this rendering as "[6 days ago]" not "[just now]".
    expect(formatRelativeAge(new Date(NOW_MS - 86_400_000).toISOString(), NOW_MS)).toBe('[1 day ago]')
    expect(formatRelativeAge(new Date(NOW_MS - 6 * 86_400_000).toISOString(), NOW_MS)).toBe('[6 days ago]')
  })

  it('returns weeks then months for longer gaps', () => {
    expect(formatRelativeAge(new Date(NOW_MS - 14 * 86_400_000).toISOString(), NOW_MS)).toBe('[2 weeks ago]')
    expect(formatRelativeAge(new Date(NOW_MS - 90 * 86_400_000).toISOString(), NOW_MS)).toBe('[3 months ago]')
  })

  it('returns empty string for missing or invalid input', () => {
    expect(formatRelativeAge(null, NOW_MS)).toBe('')
    expect(formatRelativeAge(undefined, NOW_MS)).toBe('')
    expect(formatRelativeAge('', NOW_MS)).toBe('')
    expect(formatRelativeAge('not a date', NOW_MS)).toBe('')
  })

  it('clamps future timestamps to "[just now]"', () => {
    // A clock skew between the DB and Vercel runtime could produce a
    // negative gap. We never want to render "[in 3 minutes]".
    const future = new Date(NOW_MS + 3 * 60_000).toISOString()
    expect(formatRelativeAge(future, NOW_MS)).toBe('[just now]')
  })
})

describe('widgetPubsubChannelName', () => {
  it('produces a safe Postgres identifier from a CUID', () => {
    expect(widgetPubsubChannelName('clx12345abc')).toBe('widget_clx12345abc')
  })

  it('lowercases mixed-case input', () => {
    expect(widgetPubsubChannelName('Conv-ABC')).toBe('widget_conv_abc')
  })

  it('replaces unsafe characters with underscores', () => {
    expect(widgetPubsubChannelName('conv-with-dashes/and:colons')).toBe('widget_conv_with_dashes_and_colons')
  })

  it('caps at 63 bytes (Postgres identifier limit)', () => {
    const long = 'a'.repeat(200)
    const channel = widgetPubsubChannelName(long)
    expect(channel.length).toBeLessThanOrEqual(63)
    expect(channel.startsWith('widget_')).toBe(true)
  })

  it('never produces an empty identifier', () => {
    // Empty input still produces "widget_" which is a valid identifier.
    expect(widgetPubsubChannelName('')).toBe('widget_')
  })
})
