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

export class TwilioError extends Error {
  constructor(public status: number, public body: string, public userMessage: string) {
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

async function twilioFetch(path: string, init?: RequestInit): Promise<any> {
  const res = await fetch(`${TWILIO_BASE}${path}`, {
    ...init,
    headers: { Authorization: authHeader(), ...(init?.headers ?? {}) },
  })
  const text = await res.text()
  if (!res.ok) {
    let userMessage = 'Twilio request failed.'
    try {
      const parsed = JSON.parse(text)
      if (parsed?.message) userMessage = String(parsed.message)
    } catch {}
    throw new TwilioError(res.status, text, userMessage)
  }
  return text ? JSON.parse(text) : {}
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

/** Buy a number and point its Voice webhook at our TwiML answer route. */
export async function purchaseNumber(opts: {
  phoneNumber: string
  voiceUrl: string
}): Promise<OwnedNumber> {
  const { sid } = creds()
  const form = new URLSearchParams({
    PhoneNumber: opts.phoneNumber,
    VoiceUrl: opts.voiceUrl,
    VoiceMethod: 'POST',
  })
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
