/**
 * Pure, deterministic heuristics used inside runAgent — extracted so
 * they can be unit-tested without spinning up the full agent loop.
 *
 * Everything here MUST stay free of: db, network, time-of-day awareness
 * (callers pass `now`), or any implicit context. That's what makes them
 * testable. If you find yourself wanting to add side effects, make a
 * different module.
 */

// ─── Booking / confirmation patterns ─────────────────────────────────────

/**
 * Phrases that, when present in an inbound message, mean "the contact
 * wants to start the booking flow." On match we force tool_choice on the
 * first iteration so the agent calls get_available_slots / book_appointment
 * instead of replying "let me check and get back to you."
 */
export const BOOKING_INTENT_PATTERNS = [
  'speak to sales', 'talk to sales', 'book a call', 'book a meeting', 'book a demo',
  'book an appointment', 'book appointment', 'make an appointment', 'schedule an appointment',
  'schedule appointment', 'set an appointment', 'set up an appointment', 'get an appointment',
  'an appointment', 'appointment',
  'schedule a call', 'schedule a meeting', 'schedule a demo', 'set up a call',
  'hop on a call', 'get on a call', 'have a call', 'have a meeting',
  'what times', 'available times', 'other times', 'another time', 'different time',
  'next available', 'whats next', "what's next", 'other options', 'something else',
  'have access to the calendar', 'check the calendar', 'any availability',
  'can we chat', 'quick chat', 'jump on', 'catch up',
  "i need another", 'need another time', 'need a different',
  "haven't heard", "havent heard", 'any update',
] as const

export function hasBookingIntent(incomingMessage: string | null | undefined): boolean {
  if (!incomingMessage) return false
  const lower = incomingMessage.toLowerCase()
  return BOOKING_INTENT_PATTERNS.some(p => lower.includes(p))
}

/**
 * Short-affirmation tokens that, when the contact's reply consists of
 * (or starts/ends with) one of these, mean "yes, do the thing you just
 * proposed." Pairs with the offered-time detector below.
 */
export const CONFIRMATION_TOKENS = [
  'yes', 'yep', 'yeah', 'yup', 'ya', 'yas', 'yess', 'yessir',
  'sure', 'sure thing', 'ok', 'okay', 'okey', 'k',
  'sounds good', 'sounds great', 'sounds perfect',
  'works', 'works for me', 'that works', 'that one', "that's good", 'that is good',
  'perfect', 'great', 'awesome', 'lovely', 'cool', 'fine', 'good',
  'do it', 'book it', 'book me', 'book that', 'lock it in',
  'confirmed', "let's do it", 'lets do it', 'lgtm',
  'go ahead', 'go for it', 'lets go', "let's go",
] as const

const TIMEZONE_HINT_RE = /\b(timezone|time zone|in\s+[a-z]{2,4}\s*$|in\s+(pst|est|cst|mst|edt|pdt|cdt|mdt|gmt|bst|cet|ist|aest|jst|kst|sgt)\b|london|sydney|tokyo|berlin|paris|new york|chicago|los angeles|san francisco|denver|seattle|melbourne|brisbane|perth|auckland|toronto|vancouver|mumbai|delhi|bangalore|dubai)\b/i
const REJECTION_HINT_RE = /\b(can't|cannot|won't|can not|will not|nope|nah|no\s|no$|busy|already have|conflict|earlier|later|after|before|other|else|different)\b/i
const TIME_PATTERN_RE = /\b\d{1,2}(:\d{2})?\s*(am|pm|AM|PM)\b/
const TIME_24H_RE = /\b\d{1,2}:\d{2}\b/
const OFFER_PHRASE_RE = /(does that work|which works|works better|how about|next available|i can do|i have|are you free|free at|available at|got\s+\w+\s+at|book(ed)?\s+you|how does)/i

/**
 * True when the reply is a short, unambiguous yes — and NOT a request to
 * adjust timezone, ask a question, or reject the offer. Conservative:
 * false negatives just mean we don't pin the tool, false positives would
 * cause the agent to book without consent.
 */
export function isShortAffirmation(incomingMessage: string | null | undefined): boolean {
  if (!incomingMessage) return false
  const trimmed = incomingMessage.toLowerCase().trim()
  if (trimmed.length === 0 || trimmed.length > 40) return false
  if (TIMEZONE_HINT_RE.test(trimmed)) return false
  if (trimmed.includes('?')) return false
  if (REJECTION_HINT_RE.test(trimmed)) return false
  return CONFIRMATION_TOKENS.some(w =>
    trimmed === w
    || trimmed === w + '.' || trimmed === w + '!' || trimmed === w + ','
    || trimmed.startsWith(w + ' ') || trimmed.startsWith(w + ',') || trimmed.startsWith(w + '.')
    || trimmed.endsWith(' ' + w) || trimmed.endsWith(' ' + w + '.')
  )
}

/**
 * True when a message body looks like the agent offered a specific time
 * (e.g. "Monday at 11:45am — does that work?"). Used as part of the
 * confirmation pin: yes-words alone aren't enough; the previous outbound
 * must actually have offered something to confirm.
 */
export function looksLikeOfferedTime(body: string | null | undefined): boolean {
  if (!body) return false
  const hasTimePattern = TIME_PATTERN_RE.test(body) || TIME_24H_RE.test(body)
  if (!hasTimePattern) return false
  return OFFER_PHRASE_RE.test(body)
}

// ─── Relative-age formatting ─────────────────────────────────────────────

/**
 * Coarse, human-friendly relative age tag — "[3 days ago]", "[just now]".
 * Coarse on purpose so the agent reasons about gaps without anchoring on
 * exact minutes. `nowMs` is injected so tests are deterministic.
 *
 * Returns empty string when the input isn't a parseable timestamp.
 */
export function formatRelativeAge(createdAt: string | null | undefined, nowMs: number): string {
  if (!createdAt) return ''
  const t = new Date(createdAt).getTime()
  if (!Number.isFinite(t) || t <= 0) return ''
  const diffMs = Math.max(0, nowMs - t)
  const min = Math.round(diffMs / 60_000)
  if (min < 2) return '[just now]'
  if (min < 60) return `[${min} minutes ago]`
  const hr = Math.round(diffMs / 3_600_000)
  if (hr < 24) return hr === 1 ? '[1 hour ago]' : `[${hr} hours ago]`
  const day = Math.round(diffMs / 86_400_000)
  if (day < 14) return day === 1 ? '[1 day ago]' : `[${day} days ago]`
  const wk = Math.round(diffMs / (7 * 86_400_000))
  if (wk < 8) return wk === 1 ? '[1 week ago]' : `[${wk} weeks ago]`
  const mo = Math.round(diffMs / (30 * 86_400_000))
  return mo === 1 ? '[1 month ago]' : `[${mo} months ago]`
}

// ─── Pubsub channel sanitization ─────────────────────────────────────────

/**
 * Sanitize a conversationId into a Postgres LISTEN/NOTIFY channel name.
 * Postgres identifiers: letters/digits/underscores, max 63 bytes.
 * We prefix with "widget_" and lowercase + replace any non-alphanumeric
 * to keep the name safe to interpolate into NOTIFY without parameter
 * binding (NOTIFY doesn't support parameterised channel names).
 */
export function widgetPubsubChannelName(conversationId: string): string {
  const safe = conversationId.toLowerCase().replace(/[^a-z0-9_]/g, '_')
  return `widget_${safe}`.slice(0, 63)
}
