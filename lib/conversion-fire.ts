/**
 * Conversion firing — Meta CAPI + Google Ads server-side conversions.
 *
 * The unfair advantage of the Xovera funnel layer: every funnel stage
 * (lead, call_connected, qualified, booked, sale) fires server-side to
 * the ad platforms so their algos optimize on bookings, not just clicks.
 * Most advertisers never wire this up; we do it automatically as part of
 * the campaign creation flow.
 *
 * Idempotency: ConversionEvent.eventId is the dedup key. Meta uses it as
 * `event_id` (it dedupes against the browser pixel's same-id event);
 * Google uses it as the `orderId` on uploadClickConversions. Same row
 * fired twice produces zero duplicate conversions on either platform.
 *
 * Credential shapes expected on the linked Integration rows:
 *   Meta:   credentials.access_token   (pixel CAPI token / system-user token)
 *   Google: credentials.refresh_token  (OAuth refresh token)
 *           config.customer_id         (numeric, no dashes)
 *           Optional: config.developer_token; fallback is env GOOGLE_DEVELOPER_TOKEN.
 *
 * If a required credential is missing the row gets metaError/googleError
 * set with a descriptive message and we move on. The cron retry job
 * (app/api/cron/conversion-fire-retry) skips rows where the error
 * indicates a config problem (won't be solved by retry).
 */

import { db } from '@/lib/db'

const META_GRAPH = 'https://graph.facebook.com/v21.0'
const GOOGLE_ADS_API = 'https://googleads.googleapis.com/v20'

const META_EVENT_NAMES: Record<string, string> = {
  lead: 'Lead',
  call_connected: 'Contact',
  qualified: 'QualifiedLead',
  booked: 'Schedule',
  sale: 'Purchase',
  no_show: 'NoShow',
  lost: 'Lost',
}

async function sha256Hex(input: string): Promise<string> {
  const enc = new TextEncoder().encode(input.trim().toLowerCase())
  const hash = await crypto.subtle.digest('SHA-256', enc)
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

function digitsOnly(phone: string): string {
  return phone.replace(/\D/g, '')
}

interface FireResult {
  meta?: { ok: boolean; reason?: string; eventsReceived?: number }
  google?: { ok: boolean; reason?: string }
}

/**
 * Fire a single ConversionEvent to whichever platforms its PixelConfig
 * has wired up. Idempotent: rows already-sent on a platform are skipped
 * rather than re-fired. Errors are captured on the event row, not thrown.
 *
 * Returns a small summary for logs / cron stats. Never throws —
 * everything is best-effort.
 */
export async function fireConversion(conversionEventId: string): Promise<FireResult> {
  const event = await db.conversionEvent.findUnique({
    where: { id: conversionEventId },
  })
  if (!event) return {}

  const result: FireResult = {}

  // Resolve PixelConfig: prefer per-campaign, fall back to workspace default.
  const pixelConfig = await db.pixelConfig.findFirst({
    where: event.campaignId
      ? {
          OR: [
            { campaignId: event.campaignId },
            { workspaceId: event.workspaceId, campaignId: null },
          ],
        }
      : { workspaceId: event.workspaceId, campaignId: null },
    orderBy: { campaignId: { sort: 'desc', nulls: 'last' } },
  })

  if (!pixelConfig) {
    // No config = nothing to fire. Mark both with a clear reason so the
    // cron doesn't re-process this row indefinitely.
    if (!event.metaSentAt && !event.metaError) {
      await db.conversionEvent.update({
        where: { id: event.id },
        data: { metaError: 'no_pixel_config' },
      })
    }
    if (!event.googleSentAt && !event.googleError) {
      await db.conversionEvent.update({
        where: { id: event.id },
        data: { googleError: 'no_pixel_config' },
      })
    }
    return { meta: { ok: false, reason: 'no_pixel_config' }, google: { ok: false, reason: 'no_pixel_config' } }
  }

  // Load related rows in parallel — contact for PII hashing, submission
  // for fbp/fbc/gclid + ip + ua.
  const [contact, submission] = await Promise.all([
    event.contactId
      ? db.nativeContact.findUnique({
          where: { id: event.contactId },
          select: { firstName: true, lastName: true, email: true, phone: true },
        })
      : Promise.resolve(null),
    event.submissionId
      ? db.formSubmission.findUnique({
          where: { id: event.submissionId },
          select: { fbp: true, fbc: true, gclid: true, ipAddress: true, userAgent: true, referrer: true },
        })
      : Promise.resolve(null),
  ])

  // ─── Meta CAPI ──────────────────────────────────────────────────────
  const metaShouldFire =
    !event.metaSentAt &&
    pixelConfig.metaPixelId &&
    pixelConfig.metaIntegrationId &&
    pixelConfig.metaEvents.includes(event.eventName)

  if (metaShouldFire) {
    result.meta = await fireMeta({
      event,
      pixelConfig,
      contact,
      submission,
    })
  } else if (event.metaSentAt) {
    result.meta = { ok: true, reason: 'already_sent' }
  } else {
    result.meta = { ok: false, reason: 'not_configured' }
  }

  // ─── Google Ads ────────────────────────────────────────────────────
  // Only fires when gclid is present (click-keyed conversion). Email-
  // hashed enhanced conversions for leads can be added later via gtag
  // (already on the page) — this path is for the server-side click-id
  // upload that drives Smart Bidding.
  const googleShouldFire =
    !event.googleSentAt &&
    pixelConfig.googleConversionId &&
    pixelConfig.googleConversionLabel &&
    pixelConfig.googleIntegrationId &&
    pixelConfig.googleEvents.includes(event.eventName) &&
    submission?.gclid

  if (googleShouldFire) {
    result.google = await fireGoogle({
      event,
      pixelConfig,
      submission,
    })
  } else if (event.googleSentAt) {
    result.google = { ok: true, reason: 'already_sent' }
  } else if (!submission?.gclid && pixelConfig.googleConversionId) {
    result.google = { ok: false, reason: 'no_gclid' }
  } else {
    result.google = { ok: false, reason: 'not_configured' }
  }

  return result
}

// ─── Meta CAPI sender ────────────────────────────────────────────────

async function fireMeta(args: {
  event: {
    id: string
    eventId: string
    eventName: string
    value: unknown
    currency: string
    occurredAt: Date
  }
  pixelConfig: {
    metaPixelId: string | null
    metaIntegrationId: string | null
    metaTestEventCode: string | null
  }
  contact: {
    firstName: string | null
    lastName: string | null
    email: string | null
    phone: string | null
  } | null
  submission: {
    fbp: string | null
    fbc: string | null
    ipAddress: string | null
    userAgent: string | null
    referrer: string | null
  } | null
}): Promise<{ ok: boolean; reason?: string; eventsReceived?: number }> {
  const { event, pixelConfig, contact, submission } = args

  let accessToken: string
  try {
    const integration = await db.integration.findUnique({
      where: { id: pixelConfig.metaIntegrationId! },
      select: { credentials: true, isActive: true },
    })
    if (!integration?.isActive) throw new Error('integration_inactive')
    const creds = integration.credentials as Record<string, unknown> | null
    const token = creds?.access_token
    if (typeof token !== 'string' || !token) throw new Error('access_token_missing')
    accessToken = token
  } catch (err) {
    const reason = err instanceof Error ? err.message : 'integration_lookup_failed'
    await db.conversionEvent.update({ where: { id: event.id }, data: { metaError: reason } })
    return { ok: false, reason }
  }

  // user_data — hashed PII + browser cookies + ip/ua
  const userData: Record<string, unknown> = {}
  if (contact?.email) userData.em = [await sha256Hex(contact.email)]
  if (contact?.phone) userData.ph = [await sha256Hex(digitsOnly(contact.phone))]
  if (contact?.firstName) userData.fn = [await sha256Hex(contact.firstName)]
  if (contact?.lastName) userData.ln = [await sha256Hex(contact.lastName)]
  if (submission?.fbp) userData.fbp = submission.fbp
  if (submission?.fbc) userData.fbc = submission.fbc
  if (submission?.ipAddress) userData.client_ip_address = submission.ipAddress
  if (submission?.userAgent) userData.client_user_agent = submission.userAgent

  const customData: Record<string, unknown> = { currency: event.currency }
  if (event.value !== null && event.value !== undefined) {
    customData.value = typeof event.value === 'object' ? Number(event.value.toString()) : event.value
  }

  const eventName = META_EVENT_NAMES[event.eventName] ?? 'Lead'

  const payload: Record<string, unknown> = {
    data: [
      {
        event_name: eventName,
        event_time: Math.floor(event.occurredAt.getTime() / 1000),
        event_id: event.eventId,
        action_source: 'website',
        event_source_url: submission?.referrer ?? undefined,
        user_data: userData,
        custom_data: customData,
      },
    ],
  }
  if (pixelConfig.metaTestEventCode) payload.test_event_code = pixelConfig.metaTestEventCode

  const url = `${META_GRAPH}/${pixelConfig.metaPixelId}/events?access_token=${encodeURIComponent(accessToken)}`

  let res: Response
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
  } catch (err) {
    const reason = err instanceof Error ? err.message : 'network_error'
    await db.conversionEvent.update({ where: { id: event.id }, data: { metaError: reason } })
    return { ok: false, reason }
  }

  const json = (await res.json().catch(() => ({}))) as { error?: { message?: string }; events_received?: number }

  if (!res.ok || json.error) {
    const reason = json.error?.message ?? `http_${res.status}`
    await db.conversionEvent.update({
      where: { id: event.id },
      data: { metaError: reason, metaResponse: json as object },
    })
    return { ok: false, reason }
  }

  await db.conversionEvent.update({
    where: { id: event.id },
    data: { metaSentAt: new Date(), metaResponse: json as object, metaError: null },
  })
  return { ok: true, eventsReceived: json.events_received }
}

// ─── Google Ads sender ───────────────────────────────────────────────

async function fireGoogle(args: {
  event: {
    id: string
    eventId: string
    value: unknown
    currency: string
    occurredAt: Date
  }
  pixelConfig: {
    googleConversionId: string | null
    googleConversionLabel: string | null
    googleIntegrationId: string | null
  }
  submission: { gclid: string | null }
}): Promise<{ ok: boolean; reason?: string }> {
  const { event, pixelConfig, submission } = args

  // Refresh access token from the integration's stored refresh_token.
  let accessToken: string
  let customerId: string
  let developerToken: string
  try {
    const integration = await db.integration.findUnique({
      where: { id: pixelConfig.googleIntegrationId! },
      select: { credentials: true, config: true, isActive: true },
    })
    if (!integration?.isActive) throw new Error('integration_inactive')

    const creds = integration.credentials as Record<string, unknown> | null
    const config = integration.config as Record<string, unknown> | null
    const refreshToken = creds?.refresh_token
    if (typeof refreshToken !== 'string' || !refreshToken) throw new Error('refresh_token_missing')

    const customerIdRaw = config?.customer_id
    if (typeof customerIdRaw !== 'string' || !customerIdRaw) throw new Error('customer_id_missing')
    customerId = customerIdRaw.replace(/-/g, '')

    developerToken =
      (typeof config?.developer_token === 'string' ? (config.developer_token as string) : '') ||
      process.env.GOOGLE_DEVELOPER_TOKEN ||
      ''
    if (!developerToken) throw new Error('developer_token_missing')

    const clientId = process.env.GOOGLE_CLIENT_ID
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET
    if (!clientId || !clientSecret) throw new Error('GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET unset')

    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        refresh_token: refreshToken,
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: 'refresh_token',
      }),
    })
    const tokenJson = (await tokenRes.json().catch(() => ({}))) as { access_token?: string; error?: string; error_description?: string }
    if (!tokenRes.ok || !tokenJson.access_token) {
      throw new Error(`token_refresh_failed: ${tokenJson.error_description ?? tokenJson.error ?? tokenRes.status}`)
    }
    accessToken = tokenJson.access_token
  } catch (err) {
    const reason = err instanceof Error ? err.message : 'integration_lookup_failed'
    await db.conversionEvent.update({ where: { id: event.id }, data: { googleError: reason } })
    return { ok: false, reason }
  }

  // YYYY-MM-DD HH:MM:SS+00:00 (Google Ads API format, UTC)
  const d = event.occurredAt
  const pad = (n: number) => String(n).padStart(2, '0')
  const conversionDateTime =
    `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ` +
    `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}+00:00`

  const conversion: Record<string, unknown> = {
    conversionAction: `customers/${customerId}/conversionActions/${pixelConfig.googleConversionLabel}`,
    conversionDateTime,
    gclid: submission.gclid,
    currencyCode: event.currency,
    orderId: event.eventId, // dedup key
  }
  if (event.value !== null && event.value !== undefined) {
    conversion.conversionValue = typeof event.value === 'object' ? Number(event.value.toString()) : event.value
  }

  const url = `${GOOGLE_ADS_API}/customers/${customerId}:uploadClickConversions`
  let res: Response
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
        'developer-token': developerToken,
      },
      body: JSON.stringify({
        conversions: [conversion],
        partialFailure: true,
      }),
    })
  } catch (err) {
    const reason = err instanceof Error ? err.message : 'network_error'
    await db.conversionEvent.update({ where: { id: event.id }, data: { googleError: reason } })
    return { ok: false, reason }
  }

  const json = (await res.json().catch(() => ({}))) as { error?: { message?: string }; partialFailureError?: { message?: string } }
  if (!res.ok || json.error) {
    const reason = json.error?.message ?? `http_${res.status}`
    await db.conversionEvent.update({
      where: { id: event.id },
      data: { googleError: reason, googleResponse: json as object },
    })
    return { ok: false, reason }
  }
  // partialFailure can succeed at HTTP level but report a per-conversion
  // failure in the body — surface that as an error too.
  if (json.partialFailureError?.message) {
    const reason = json.partialFailureError.message
    await db.conversionEvent.update({
      where: { id: event.id },
      data: { googleError: reason, googleResponse: json as object },
    })
    return { ok: false, reason }
  }

  await db.conversionEvent.update({
    where: { id: event.id },
    data: { googleSentAt: new Date(), googleResponse: json as object, googleError: null },
  })
  return { ok: true }
}

// ─── Reasons that a retry can/can't fix ─────────────────────────────

/** Returns true if the error message indicates a transient failure that
 *  a retry might fix (network glitch, 5xx, rate limit). False for config
 *  errors (missing token, invalid pixel id) — those need operator
 *  intervention, retrying just burns API quota. */
export function isRetryableConversionError(error: string | null): boolean {
  if (!error) return false
  const low = error.toLowerCase()
  if (low.includes('rate') || low.includes('limit')) return true
  if (low.includes('timeout') || low.includes('network') || low.includes('econn')) return true
  if (/^http_5/.test(low)) return true
  if (low.includes('temporarily unavailable')) return true
  // Config errors (don't retry):
  if (low.includes('not_configured') || low.includes('missing') || low.includes('inactive')) return false
  if (low.includes('no_pixel_config') || low.includes('no_gclid')) return false
  if (low.includes('invalid')) return false
  if (/^http_4/.test(low)) return false
  return false
}
