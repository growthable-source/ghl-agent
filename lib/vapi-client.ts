const VAPI_BASE = 'https://api.vapi.ai'

/**
 * Typed Vapi error. Carries the parsed body so callers can branch on
 * specific Vapi failure modes (number-activating, concurrency limit,
 * etc.) without re-parsing strings.
 *
 * Common subclasses we surface via .code:
 *   - 'PHONE_NUMBER_ACTIVATING' — number was just provisioned and the
 *     carrier is still wiring it up. Retry in 30–120s.
 *   - 'CONCURRENCY_BLOCKED' — workspace hit its concurrent-call cap.
 *   - 'UNKNOWN' — everything else; raw body is available on .body.
 */
export class VapiError extends Error {
  constructor(
    public status: number,
    public code: 'PHONE_NUMBER_ACTIVATING' | 'CONCURRENCY_BLOCKED' | 'FREE_TIER_INTL_BLOCKED' | 'INTL_NUMBER_PLAN_REQUIRED' | 'UNKNOWN',
    public body: string,
    public parsed: Record<string, unknown> | null,
    /** Human-readable message safe to show the user. */
    public userMessage: string,
  ) {
    super(`Vapi API error ${status}: ${userMessage}`)
    this.name = 'VapiError'
  }
}

function classifyVapiError(status: number, rawBody: string): VapiError {
  let parsed: Record<string, unknown> | null = null
  try { parsed = JSON.parse(rawBody) } catch {}
  const message = String((parsed as any)?.message ?? '')

  // Carrier still wiring up a fresh number. The text is verbatim from
  // Vapi: "`phoneNumber` is activating. Contact support@vapi.ai if not
  // active within 5 minutes."
  if (status === 400 && /phoneNumber.+is activating/i.test(message)) {
    return new VapiError(
      status, 'PHONE_NUMBER_ACTIVATING', rawBody, parsed,
      'Your phone number is still activating with the carrier. This usually takes 30 seconds to 2 minutes after purchase. Try again in a moment.',
    )
  }

  // Workspace at the concurrent-call cap. The subscriptionLimits
  // block on the parsed body carries the cap when this fires.
  const limits = (parsed as any)?.subscriptionLimits
  if (status === 400 && limits?.concurrencyBlocked) {
    const cap = limits.concurrencyLimit
    return new VapiError(
      status, 'CONCURRENCY_BLOCKED', rawBody, parsed,
      `Your Vapi account is at its concurrent-call cap${cap ? ` (${cap})` : ''}. Wait for one of the in-progress calls to end, or upgrade your Vapi plan.`,
    )
  }

  // Voxility's default voice plan covers US outbound only. Calls to
  // non-US destinations bubble up here. The user-facing copy is
  // brand-neutral on purpose — customers shouldn't see the underlying
  // voice-vendor's brand name (we whitelabel across thousands of
  // agency domains, see CLAUDE.md). The UI surfaces a card with two
  // paths: contact support to enable international outbound, or
  // provision a number local to the destination country.
  if (/free\s+vapi\s+numbers.+international|international\s+calls/i.test(message)) {
    return new VapiError(
      status, 'FREE_TIER_INTL_BLOCKED', rawBody, parsed,
      'International calls aren\'t enabled on your workspace yet. Contact support to enable them, or provision a number in the destination country from the agent\'s Configuration tab.',
    )
  }

  // International phone-number purchase rejected because the platform's
  // voice account isn't on the paid plan that covers that country.
  // Operator never set this up directly — the right path is "contact
  // support" so Voxility flips them onto the international plan. Same
  // brand-neutral rationale as above.
  if (status === 400 && /payment|billing|subscription|plan/i.test(message) && /country|international|number/i.test(message)) {
    return new VapiError(
      status, 'INTL_NUMBER_PLAN_REQUIRED', rawBody, parsed,
      'Numbers in this country aren\'t available on your current voice plan. Contact support and we\'ll switch your workspace onto the international plan — usually same-day.',
    )
  }

  return new VapiError(status, 'UNKNOWN', rawBody, parsed, message || rawBody.slice(0, 300))
}

async function vapiRequest(path: string, options: RequestInit = {}) {
  const apiKey = process.env.VAPI_API_KEY
  if (!apiKey) throw new Error('VAPI_API_KEY not set')
  const res = await fetch(`${VAPI_BASE}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  })
  if (!res.ok) {
    const body = await res.text()
    throw classifyVapiError(res.status, body)
  }
  return res.json()
}

export async function listPhoneNumbers() {
  const data = await vapiRequest('/phone-number')
  const items = Array.isArray(data) ? data : (data as any).results || (data as any).data || []
  if (items.length > 0) {
    console.log('[Vapi] Raw phone number object keys:', Object.keys(items[0]))
    console.log('[Vapi] Raw phone number sample:', JSON.stringify(items[0]).slice(0, 500))
  }
  return (items as any[])
    .map((p: any) => {
      // Vapi returns phone number in various fields depending on provider/version
      const number = p.number
        || p.phoneNumber
        || p.twilioPhoneNumber
        || p.vonagePhoneNumber
        || p.vapiPhoneNumber
        || (p.sipUri ? `SIP: ${p.sipUri}` : null)
        || null
      return {
        id: p.id,
        number,
        name: p.name || number || `Phone ${p.id.slice(0, 8)}`,
        provider: p.provider || 'unknown',
        status: p.status || 'unknown',
      }
    })
    .filter((p) => p.number) // Only show numbers with an actual phone number assigned
}

/**
 * ISO-3166-1 alpha-2 country codes Vapi sells provider-managed numbers
 * for. US is the only one available on free tier — the rest require
 * billing on dashboard.vapi.ai. Surface a friendly VapiError when Vapi
 * rejects a non-US purchase with a billing block (currently bubbles
 * up as an UNKNOWN 4xx; classify in a later pass once we see real
 * error bodies from production).
 */
export const VAPI_PURCHASEABLE_COUNTRIES = ['US', 'GB', 'CA', 'AU', 'NZ'] as const
export type VapiPurchaseableCountry = typeof VAPI_PURCHASEABLE_COUNTRIES[number]

export interface PurchasePhoneNumberOpts {
  /** ISO-3166-1 alpha-2. Defaults to 'US' to match the historical behaviour. */
  countryCode?: VapiPurchaseableCountry | string
  /** Numeric area / region code (US: 3 digits; AU: 2-3 digits; etc.). Optional. */
  areaCode?: string
  /**
   * Optional friendly name to attach to the number on Vapi's side
   * (defaults to the number itself in their dashboard).
   */
  name?: string
}

/**
 * Buy a Vapi-provisioned phone number. Vapi's `/phone-number` POST
 * accepts `numberDesiredCountryCode` (ISO-3166 alpha-2) alongside
 * `numberDesiredAreaCode`. Free-tier accounts get US-only; AU / GB /
 * CA / NZ require billing.
 *
 * Back-compat: the historical call site passes a bare areaCode string,
 * which still works (defaults to US).
 */
export async function purchasePhoneNumber(opts: PurchasePhoneNumberOpts | string) {
  // Back-compat: old callers pass a bare areaCode.
  const params: PurchasePhoneNumberOpts = typeof opts === 'string' ? { areaCode: opts } : opts
  const countryCode = (params.countryCode || 'US').toUpperCase()
  const payload: Record<string, string> = {
    provider: 'vapi',
    numberDesiredCountryCode: countryCode,
  }
  if (params.areaCode) payload.numberDesiredAreaCode = params.areaCode
  if (params.name) payload.name = params.name

  const data = await vapiRequest('/phone-number', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
  return {
    id: (data as any).id,
    number: (data as any).number,
    name: (data as any).name || (data as any).number,
    countryCode,
  }
}

// ─── Assistants ─────────────────────────────────────────────────────────
//
// Pre-registered Vapi assistants replace the inline transient assistant
// configs that were failing "Meeting ended due to ejection" on browser
// test calls. We POST the config once at agent-create time, store the
// returned id on VapiConfig.vapiAssistantId, then every call site
// (browser, outbound, widget) just references the assistant by id.
//
// Vapi validates the config synchronously at registration time — any
// shape problem surfaces as a typed VapiError with a real message
// (instead of daily-co's opaque "Meeting has ended" at call time).

export async function createAssistant(config: Record<string, unknown>): Promise<{ id: string; [k: string]: unknown }> {
  const data = await vapiRequest('/assistant', {
    method: 'POST',
    body: JSON.stringify(config),
  })
  return data as { id: string }
}

export async function updateAssistant(
  assistantId: string,
  partial: Record<string, unknown>,
): Promise<{ id: string; [k: string]: unknown }> {
  const data = await vapiRequest(`/assistant/${assistantId}`, {
    method: 'PATCH',
    body: JSON.stringify(partial),
  })
  return data as { id: string }
}

export async function deleteAssistant(assistantId: string): Promise<void> {
  try {
    await vapiRequest(`/assistant/${assistantId}`, { method: 'DELETE' })
  } catch (err) {
    // Vapi returns 404 for already-deleted assistants — treat as success
    // (idempotent delete) so cleanup paths don't blow up.
    if (err instanceof VapiError && err.status === 404) return
    throw err
  }
}

// ─── Outbound Calls ───────────────────────────────────────────────────────

export async function createOutboundCall(opts: {
  phoneNumberId: string
  customerNumber: string
  /**
   * EITHER an inline `assistant` object (legacy) OR an `assistantId`
   * referencing a pre-registered Vapi assistant (preferred — what
   * lib/voice/vapi-assistant.ts creates at agent-create time).
   * Pass one or the other, not both.
   */
  assistant?: Record<string, unknown>
  assistantId?: string
  assistantOverrides?: { variableValues?: Record<string, string> }
}): Promise<{ id: string; status: string }> {
  if (!opts.assistant && !opts.assistantId) {
    throw new Error('createOutboundCall: must pass either `assistant` or `assistantId`')
  }
  const body = JSON.stringify({
    phoneNumberId: opts.phoneNumberId,
    customer: { number: opts.customerNumber },
    ...(opts.assistantId ? { assistantId: opts.assistantId } : { assistant: opts.assistant }),
    ...(opts.assistantOverrides ? { assistantOverrides: opts.assistantOverrides } : {}),
  })

  // PHONE_NUMBER_ACTIVATING is the only Vapi error we treat as
  // transient. Twilio's wire-up takes 30s–2min after the number is
  // purchased; if the user dials immediately the first attempt
  // bounces. One short retry usually clears it. After that we
  // surface the typed VapiError so the UI can show the friendly
  // "your number is still activating" copy.
  try {
    const data = await vapiRequest('/call', { method: 'POST', body })
    return { id: (data as any).id, status: (data as any).status }
  } catch (err) {
    if (err instanceof VapiError && err.code === 'PHONE_NUMBER_ACTIVATING') {
      await new Promise(r => setTimeout(r, 8000))
      const data = await vapiRequest('/call', { method: 'POST', body })
      return { id: (data as any).id, status: (data as any).status }
    }
    throw err
  }
}

// ─── ElevenLabs Voice Library ──────────────────────────────────────────────

export interface ElevenLabsVoice {
  voice_id: string
  name: string
  preview_url: string | null
  labels: Record<string, string>
  category: string
}

export async function searchElevenLabsVoices(search?: string): Promise<ElevenLabsVoice[]> {
  // Try ElevenLabs API with key first (full library), then public endpoint, then curated fallback
  const elevenLabsKey = process.env.ELEVENLABS_API_KEY
  try {
    const res = await fetch('https://api.elevenlabs.io/v1/voices', {
      headers: {
        Accept: 'application/json',
        ...(elevenLabsKey ? { 'xi-api-key': elevenLabsKey } : {}),
      },
      signal: AbortSignal.timeout(10000),
    })
    if (!res.ok) return getCuratedVoices()

    const data = await res.json()
    let voices: ElevenLabsVoice[] = (data.voices || []).map((v: any) => ({
      voice_id: v.voice_id,
      name: v.name,
      preview_url: v.preview_url || null,
      labels: v.labels || {},
      category: v.category || 'premade',
    }))

    if (search) {
      const q = search.toLowerCase()
      voices = voices.filter(v =>
        v.name.toLowerCase().includes(q) ||
        Object.values(v.labels).some(l => l.toLowerCase().includes(q))
      )
    }

    return voices.length > 0 ? voices : getCuratedVoices()
  } catch {
    return getCuratedVoices()
  }
}

function getCuratedVoices(): ElevenLabsVoice[] {
  return [
    { voice_id: 'EXAVITQu4vr4xnSDxMaL', name: 'Sarah', preview_url: 'https://storage.googleapis.com/eleven-public-prod/premade/voices/EXAVITQu4vr4xnSDxMaL/01a3e33c-6e99-4ee7-8543-ff2216a32186.mp3', labels: { accent: 'american', gender: 'female', age: 'young', use_case: 'conversational', description: 'Confident and warm, mature quality with reassuring tone' }, category: 'premade' },
    { voice_id: 'cjVigY5qzO86Huf0OWal', name: 'Eric', preview_url: 'https://storage.googleapis.com/eleven-public-prod/premade/voices/cjVigY5qzO86Huf0OWal/d098fda0-6456-4030-b3d8-63aa048c9070.mp3', labels: { accent: 'american', gender: 'male', age: 'middle_aged', use_case: 'conversational', description: 'Smooth, trustworthy tenor perfect for agentic use cases' }, category: 'premade' },
    { voice_id: 'cgSgspJ2msm6clMCkdW9', name: 'Jessica', preview_url: 'https://storage.googleapis.com/eleven-public-prod/premade/voices/cgSgspJ2msm6clMCkdW9/56a97bf8-b69b-448f-846c-c3a11683d45a.mp3', labels: { accent: 'american', gender: 'female', age: 'young', use_case: 'conversational', description: 'Playful, bright and warm' }, category: 'premade' },
    { voice_id: 'iP95p4xoKVk53GoZ742B', name: 'Chris', preview_url: 'https://storage.googleapis.com/eleven-public-prod/premade/voices/iP95p4xoKVk53GoZ742B/3f4bde72-cc48-40dd-829f-57fbf906f4d7.mp3', labels: { accent: 'american', gender: 'male', age: 'middle_aged', use_case: 'conversational', description: 'Charming, down-to-earth and natural' }, category: 'premade' },
    { voice_id: 'hpp4J3VqNfWAUOO0d1Us', name: 'Bella', preview_url: 'https://storage.googleapis.com/eleven-public-prod/premade/voices/hpp4J3VqNfWAUOO0d1Us/dab0f5ba-3aa4-48a8-9fad-f138fea1126d.mp3', labels: { accent: 'american', gender: 'female', age: 'middle_aged', use_case: 'professional', description: 'Professional, bright and warm' }, category: 'premade' },
    { voice_id: 'CwhRBWXzGAHq8TQ4Fs17', name: 'Roger', preview_url: 'https://storage.googleapis.com/eleven-public-prod/premade/voices/CwhRBWXzGAHq8TQ4Fs17/58ee3ff5-f6f2-4628-93b8-e38eb31806b0.mp3', labels: { accent: 'american', gender: 'male', age: 'middle_aged', use_case: 'conversational', description: 'Laid-back, casual and resonant' }, category: 'premade' },
    { voice_id: 'XrExE9yKIg1WjnnlVkGX', name: 'Matilda', preview_url: 'https://storage.googleapis.com/eleven-public-prod/premade/voices/XrExE9yKIg1WjnnlVkGX/b930e18d-6b4d-466e-bab2-0ae97c6d8535.mp3', labels: { accent: 'american', gender: 'female', age: 'middle_aged', use_case: 'professional', description: 'Knowledgeable and professional' }, category: 'premade' },
    { voice_id: 'TX3LPaxmHKxFdv7VOQHJ', name: 'Liam', preview_url: 'https://storage.googleapis.com/eleven-public-prod/premade/voices/TX3LPaxmHKxFdv7VOQHJ/63148076-6363-42db-aea8-31424308b92c.mp3', labels: { accent: 'american', gender: 'male', age: 'young', use_case: 'social_media', description: 'Energetic and warm' }, category: 'premade' },
    { voice_id: 'FGY2WhTYpPnrIDTdsKH5', name: 'Laura', preview_url: 'https://storage.googleapis.com/eleven-public-prod/premade/voices/FGY2WhTYpPnrIDTdsKH5/67341759-ad08-41a5-be6e-de12fe448618.mp3', labels: { accent: 'american', gender: 'female', age: 'young', use_case: 'social_media', description: 'Enthusiast with quirky attitude' }, category: 'premade' },
    { voice_id: 'bIHbv24MWmeRgasZH58o', name: 'Will', preview_url: 'https://storage.googleapis.com/eleven-public-prod/premade/voices/bIHbv24MWmeRgasZH58o/8caf8f3d-ad29-4980-af41-53f20c72d7a4.mp3', labels: { accent: 'american', gender: 'male', age: 'young', use_case: 'conversational', description: 'Relaxed optimist, laid back' }, category: 'premade' },
    { voice_id: 'Xb7hH8MSUJpSbSDYk0k2', name: 'Alice', preview_url: 'https://storage.googleapis.com/eleven-public-prod/premade/voices/Xb7hH8MSUJpSbSDYk0k2/d10f7534-11f6-41fe-a012-2de1e482d336.mp3', labels: { accent: 'british', gender: 'female', age: 'middle_aged', use_case: 'educational', description: 'Clear and engaging educator' }, category: 'premade' },
    { voice_id: 'JBFqnCBsd6RMkjVDRZzb', name: 'George', preview_url: 'https://storage.googleapis.com/eleven-public-prod/premade/voices/JBFqnCBsd6RMkjVDRZzb/e6206d1a-0721-4787-aafb-06a6e705cac5.mp3', labels: { accent: 'british', gender: 'male', age: 'middle_aged', use_case: 'narrative', description: 'Warm, captivating storyteller' }, category: 'premade' },
    { voice_id: 'onwK4e9ZLuTAKqWW03F9', name: 'Daniel', preview_url: 'https://storage.googleapis.com/eleven-public-prod/premade/voices/onwK4e9ZLuTAKqWW03F9/7eee0236-1a72-4b86-b303-5dcadc007ba9.mp3', labels: { accent: 'british', gender: 'male', age: 'middle_aged', use_case: 'news', description: 'Steady broadcaster' }, category: 'premade' },
    { voice_id: 'pFZP5JQG7iQjIQuC4Bku', name: 'Lily', preview_url: 'https://storage.googleapis.com/eleven-public-prod/premade/voices/pFZP5JQG7iQjIQuC4Bku/89b68b35-b3dd-4348-a84a-a3c13a3c2b30.mp3', labels: { accent: 'british', gender: 'female', age: 'middle_aged', use_case: 'narration', description: 'Velvety actress with warmth and clarity' }, category: 'premade' },
    { voice_id: 'nPczCjzI2devNBz1zQrb', name: 'Brian', preview_url: 'https://storage.googleapis.com/eleven-public-prod/premade/voices/nPczCjzI2devNBz1zQrb/2dd3e72c-4fd3-42f1-93ea-abc5d4e5aa1d.mp3', labels: { accent: 'american', gender: 'male', age: 'middle_aged', use_case: 'narration', description: 'Deep, resonant and comforting' }, category: 'premade' },
    { voice_id: 'IKne3meq5aSn9XLyUdCD', name: 'Charlie', preview_url: 'https://storage.googleapis.com/eleven-public-prod/premade/voices/IKne3meq5aSn9XLyUdCD/102de6f2-22ed-43e0-a1f1-111fa75c5481.mp3', labels: { accent: 'australian', gender: 'male', age: 'young', use_case: 'conversational', description: 'Deep, confident and energetic' }, category: 'premade' },
    { voice_id: 'SAz9YHcvj6GT2YYXdXww', name: 'River', preview_url: 'https://storage.googleapis.com/eleven-public-prod/premade/voices/SAz9YHcvj6GT2YYXdXww/e6c95f0b-2227-491a-b3d7-2249240decb7.mp3', labels: { accent: 'american', gender: 'neutral', age: 'middle_aged', use_case: 'conversational', description: 'Relaxed, neutral and informative' }, category: 'premade' },
    { voice_id: 'pNInz6obpgDQGcFmaJgB', name: 'Adam', preview_url: 'https://storage.googleapis.com/eleven-public-prod/premade/voices/pNInz6obpgDQGcFmaJgB/d6905d7a-dd26-4187-bfff-1bd3a5ea7cac.mp3', labels: { accent: 'american', gender: 'male', age: 'middle_aged', use_case: 'social_media', description: 'Dominant, firm and confident' }, category: 'premade' },
    { voice_id: 'pqHfZKP75CvOlQylNhV4', name: 'Bill', preview_url: 'https://storage.googleapis.com/eleven-public-prod/premade/voices/pqHfZKP75CvOlQylNhV4/d782b3ff-84ba-4029-848c-acf01285524d.mp3', labels: { accent: 'american', gender: 'male', age: 'old', use_case: 'narration', description: 'Wise, mature and balanced' }, category: 'premade' },
  ]
}
