/**
 * Minimal Twilio REST client for Gemini voice phone provisioning.
 *
 * No SDK — plain fetch with HTTP Basic auth (ACCOUNT_SID:AUTH_TOKEN).
 * Only the three operations the dashboard needs: search available
 * numbers, buy one (wiring its Voice webhook to our TwiML route), and
 * list owned numbers. Mirrors lib/vapi-client.ts in spirit; all copy
 * stays brand-neutral.
 */

const TWILIO_BASE = 'https://api.twilio.com/2010-04-01'
// Regulatory endpoints live on a different host than the classic REST API.
const TWILIO_NUMBERS_BASE = 'https://numbers.twilio.com/v2'

export class TwilioError extends Error {
  constructor(
    public status: number,
    public body: string,
    public userMessage: string,
    /** Twilio's numeric error code (e.g. 21631), when the body carries one. */
    public code?: number,
  ) {
    super(`Twilio API error ${status}: ${userMessage}`)
    this.name = 'TwilioError'
  }
}

function creds(): { sid: string; token: string } {
  const sid = process.env.TWILIO_ACCOUNT_SID
  const token = process.env.TWILIO_AUTH_TOKEN
  if (!sid || !token) throw new TwilioError(500, '', 'Twilio is not configured. Contact support to enable phone provisioning.')
  return { sid, token }
}

function authHeader(): string {
  const { sid, token } = creds()
  return 'Basic ' + Buffer.from(`${sid}:${token}`).toString('base64')
}

async function request(base: string, path: string, init?: RequestInit): Promise<any> {
  const res = await fetch(`${base}${path}`, {
    ...init,
    headers: { Authorization: authHeader(), ...(init?.headers ?? {}) },
  })
  const text = await res.text()
  if (!res.ok) {
    let userMessage = 'Twilio request failed.'
    let code: number | undefined
    try {
      const parsed = JSON.parse(text)
      if (parsed?.message) userMessage = String(parsed.message)
      if (typeof parsed?.code === 'number') code = parsed.code
    } catch {}
    throw new TwilioError(res.status, text, userMessage, code)
  }
  return text ? JSON.parse(text) : {}
}

async function twilioFetch(path: string, init?: RequestInit): Promise<any> {
  return request(TWILIO_BASE, path, init)
}

async function numbersFetch(path: string, init?: RequestInit): Promise<any> {
  return request(TWILIO_NUMBERS_BASE, path, init)
}

export interface AvailableNumber {
  phoneNumber: string // E.164
  friendlyName: string
  locality: string | null
  region: string | null
}

/** Search purchasable local numbers in a country (optionally near an area code). */
export async function listAvailableNumbers(opts: {
  countryCode: string
  areaCode?: string
}): Promise<AvailableNumber[]> {
  const { sid } = creds()
  const qs = new URLSearchParams({ PageSize: '20' })
  if (opts.areaCode) qs.set('AreaCode', opts.areaCode)
  const data = await twilioFetch(
    `/Accounts/${sid}/AvailablePhoneNumbers/${encodeURIComponent(opts.countryCode)}/Local.json?${qs}`,
  )
  return (data.available_phone_numbers ?? []).map((n: any) => ({
    phoneNumber: n.phone_number,
    friendlyName: n.friendly_name,
    locality: n.locality ?? null,
    region: n.region ?? null,
  }))
}

export interface OwnedNumber {
  sid: string
  phoneNumber: string
  friendlyName: string
  voiceUrl: string | null
}

/**
 * Many countries (AU, GB, and most of the EU among them) will not sell a
 * local number unless the buying account has a *validated* Address on
 * file, referenced at purchase time as `AddressSid`. Omitting it is what
 * produces Twilio error 21631 — "Phone Number Requires an Address but the
 * 'AddressSid' parameter was empty."
 *
 * Rather than hardcode which countries need one (Twilio changes the list),
 * we look up a validated address for the country and attach it whenever we
 * find one. US purchases keep working untouched — no address, no param.
 */
export async function findValidatedAddress(isoCountry: string): Promise<string | null> {
  const { sid } = creds()
  const data = await twilioFetch(`/Accounts/${sid}/Addresses.json?PageSize=50`)
  const match = (data.addresses ?? []).find(
    (a: any) =>
      String(a.iso_country).toUpperCase() === isoCountry.toUpperCase() &&
      // `validated` is the carrier-verified flag; `verified` is the newer
      // alias some accounts return. Either is good enough to buy against.
      (a.validated === true || a.verified === true),
  )
  return match?.sid ?? null
}

/**
 * Some countries additionally require an approved Regulatory Bundle — an
 * address alone is not sufficient. AU local numbers are in this category,
 * so a purchase can still fail with an address attached if no bundle
 * exists. Returns the first Twilio-approved bundle for the country.
 */
export async function findApprovedBundle(isoCountry: string): Promise<string | null> {
  const qs = new URLSearchParams({
    IsoCountry: isoCountry.toUpperCase(),
    NumberType: 'local',
    Status: 'twilio-approved',
    PageSize: '20',
  })
  try {
    const data = await numbersFetch(`/RegulatoryCompliance/Bundles?${qs}`)
    return (data.results ?? [])[0]?.sid ?? null
  } catch {
    // Bundle lookup is best-effort — an account with no regulatory
    // profile at all 404s here. Fall through and let the purchase
    // attempt produce the authoritative error.
    return null
  }
}

/** Derive the ISO country for an E.164 number we just listed for sale. */
function isoCountryFor(phoneNumber: string, fallback?: string): string {
  if (fallback) return fallback.toUpperCase()
  if (phoneNumber.startsWith('+61')) return 'AU'
  if (phoneNumber.startsWith('+44')) return 'GB'
  if (phoneNumber.startsWith('+64')) return 'NZ'
  return 'US'
}

/** Buy a number and point its Voice webhook at our TwiML answer route. */
export async function purchaseNumber(opts: {
  phoneNumber: string
  voiceUrl: string
  /** ISO-3166 alpha-2 the number was searched in. Inferred when omitted. */
  countryCode?: string
}): Promise<OwnedNumber> {
  const { sid } = creds()
  const country = isoCountryFor(opts.phoneNumber, opts.countryCode)
  const form = new URLSearchParams({
    PhoneNumber: opts.phoneNumber,
    VoiceUrl: opts.voiceUrl,
    VoiceMethod: 'POST',
  })

  // US numbers sell without any regulatory paperwork; skip the two extra
  // round-trips for the common case.
  if (country !== 'US') {
    const [addressSid, bundleSid] = await Promise.all([
      findValidatedAddress(country),
      findApprovedBundle(country),
    ])
    if (addressSid) form.set('AddressSid', addressSid)
    if (bundleSid) form.set('BundleSid', bundleSid)
  }

  try {
    const n = await twilioFetch(`/Accounts/${sid}/IncomingPhoneNumbers.json`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
    })
    return {
      sid: n.sid,
      phoneNumber: n.phone_number,
      friendlyName: n.friendly_name,
      voiceUrl: n.voice_url ?? null,
    }
  } catch (err) {
    // 21631 (address required) / 21649 (bundle required) reach the operator
    // as raw Twilio prose naming an API parameter they've never heard of.
    // Say what's actually missing and who can fix it.
    if (err instanceof TwilioError && (err.code === 21631 || err.code === 21649)) {
      const missing = err.code === 21649 ? 'regulatory bundle' : 'verified local address'
      throw new TwilioError(
        err.status,
        err.body,
        `${country} numbers require a ${missing} registered to the number's owner, and this account doesn't have one on file yet. Contact support to enable ${country} numbers — or choose a US number for now.`,
        err.code,
      )
    }
    throw err
  }
}

/** True when account creds + an outbound voice "From" number are configured. */
export function isOutboundVoiceConfigured(): boolean {
  return !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_VOICE_FROM_NUMBER)
}

/** Send an SMS (used for the demo OTP). Returns the message SID. */
export async function sendSms(opts: { to: string; body: string; from?: string }): Promise<string> {
  const { sid } = creds()
  const from = opts.from ?? process.env.TWILIO_SMS_FROM_NUMBER ?? process.env.TWILIO_VOICE_FROM_NUMBER
  if (!from) throw new TwilioError(500, '', 'No Twilio sending number configured.')
  const form = new URLSearchParams({ To: opts.to, From: from, Body: opts.body })
  const m = await twilioFetch(`/Accounts/${sid}/Messages.json`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
  })
  return m.sid
}

/** Place an outbound call that fetches TwiML from `answerUrl` on answer. Returns the call SID. */
export async function placeCall(opts: { to: string; answerUrl: string; from?: string }): Promise<string> {
  const { sid } = creds()
  const from = opts.from ?? process.env.TWILIO_VOICE_FROM_NUMBER
  if (!from) throw new TwilioError(500, '', 'No Twilio voice number configured.')
  const form = new URLSearchParams({
    To: opts.to,
    From: from,
    Url: opts.answerUrl,
    Method: 'POST',
    // Stop ringing a number that doesn't pick up promptly.
    Timeout: '20',
    MachineDetection: 'Enable',
  })
  const c = await twilioFetch(`/Accounts/${sid}/Calls.json`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
  })
  return c.sid
}

/** List numbers already owned on this Twilio account. */
export async function listOwnedNumbers(): Promise<OwnedNumber[]> {
  const { sid } = creds()
  const data = await twilioFetch(`/Accounts/${sid}/IncomingPhoneNumbers.json?PageSize=50`)
  return (data.incoming_phone_numbers ?? []).map((n: any) => ({
    sid: n.sid,
    phoneNumber: n.phone_number,
    friendlyName: n.friendly_name,
    voiceUrl: n.voice_url ?? null,
  }))
}
