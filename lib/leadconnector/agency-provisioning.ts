/**
 * LeadConnector agency-level provisioning adapter for the /try/[slug]
 * embedded-checkout bundle (see lib/demo-purchase/fulfill.ts). Distinct
 * from lib/leadconnector-agency.ts (that one is an OAuth-based connection
 * used by per-workspace agency widget-control sync) — this adapter
 * authenticates with a single static agency API token pulled straight
 * from an env var, because the demo-bundle pipeline provisions
 * sub-accounts under RYAN's own agency, not a customer's.
 *
 * Every exported function degrades to a typed error rather than ever
 * throwing something the caller can't branch on:
 *   - LeadConnectorNotConfiguredError — LEADCONNECTOR_AGENCY_TOKEN unset.
 *     fulfill.ts / the numbers+number routes treat this as "route to
 *     concierge, keep the buyer moving" — never a hard failure.
 *   - LeadConnectorError — the API responded, just not with 2xx. Carries
 *     .status/.body/.userMessage (same status/body/userMessage shape as
 *     lib/voice/gemini/twilio.ts's TwilioError) so callers can log the
 *     raw body while showing something human-readable.
 *
 * Endpoint paths and request bodies below are marked TODO(ryan): confirm
 * endpoint — Ryan hasn't supplied the exact agency-API contract yet (see
 * the plan's "Ryan must do" list). Each TODO is scoped so correcting it
 * is a one-line change inside that single function; the auth/timeout/
 * error-handling scaffolding around it (lcFetch below) never needs to
 * change. Until confirmed, isLeadConnectorConfigured() gates every call
 * site so the whole pipeline ships and works (via the concierge path)
 * before these details land.
 *
 * House rule: "leadconnector" naming only — never GHL/HighLevel, per
 * CLAUDE.md (lib/leadconnector-agency.ts set this precedent already).
 */

const DEFAULT_API_BASE = 'https://services.leadconnectorhq.com'
const DEFAULT_API_VERSION = '2021-07-28'
const REQUEST_TIMEOUT_MS = 15_000

function apiBase(): string {
  return (process.env.LEADCONNECTOR_API_BASE || DEFAULT_API_BASE).replace(/\/+$/, '')
}

function apiVersion(): string {
  return process.env.LEADCONNECTOR_API_VERSION || DEFAULT_API_VERSION
}

/** True once the agency token is present. The one gate every exported
 *  function in this file (indirectly, via lcFetch) is subject to — call
 *  it up front wherever a caller wants to skip straight to the
 *  concierge path instead of eating a round trip that's guaranteed to
 *  throw LeadConnectorNotConfiguredError. */
export function isLeadConnectorConfigured(): boolean {
  return !!process.env.LEADCONNECTOR_AGENCY_TOKEN
}

export class LeadConnectorNotConfiguredError extends Error {
  constructor(message = 'LeadConnector agency provisioning is not configured (missing LEADCONNECTOR_AGENCY_TOKEN).') {
    super(message)
    this.name = 'LeadConnectorNotConfiguredError'
  }
}

/** Typed LeadConnector API error. `userMessage` is safe to log/surface;
 *  `body` keeps the raw response text for debugging. Mirrors the
 *  status/body/userMessage shape lib/voice/gemini/twilio.ts's TwilioError
 *  already established for exactly this kind of external-API wrapper. */
export class LeadConnectorError extends Error {
  constructor(
    public status: number,
    public body: string,
    public userMessage: string,
  ) {
    super(`LeadConnector API error ${status}: ${userMessage}`)
    this.name = 'LeadConnectorError'
  }
}

/**
 * Shared fetch wrapper: auth header, Version header, JSON parsing,
 * timeout, typed errors. Every function below funnels through this so
 * correcting the base URL/version/timeout later is a one-line env change,
 * not a per-function edit.
 */
async function lcFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = process.env.LEADCONNECTOR_AGENCY_TOKEN
  if (!token) throw new LeadConnectorNotConfiguredError()

  let res: Response
  try {
    res = await fetch(`${apiBase()}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        Version: apiVersion(),
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...(init.headers ?? {}),
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    // Network failure / timeout — no status code to carry, so 0.
    throw new LeadConnectorError(0, message, 'Could not reach LeadConnector — try again in a moment.')
  }

  const text = await res.text()
  if (!res.ok) {
    let userMessage = `LeadConnector request failed (${res.status}).`
    try {
      const parsed = JSON.parse(text)
      if (parsed?.message) userMessage = String(Array.isArray(parsed.message) ? parsed.message.join(' ') : parsed.message)
    } catch {
      // Non-JSON error body — fall back to the generic message above.
    }
    throw new LeadConnectorError(res.status, text, userMessage)
  }
  if (!text) return {} as T
  try {
    return JSON.parse(text) as T
  } catch {
    throw new LeadConnectorError(res.status, text, 'LeadConnector returned a response that was not valid JSON.')
  }
}

// ─── Sub-account creation ──────────────────────────────────────────────

export interface CreateSubAccountInput {
  businessName: string
  email: string
  /** Defaults to businessName when omitted. */
  name?: string
  websiteUrl?: string
}

export interface CreateSubAccountResult {
  locationId: string
}

interface CreateSubAccountRawResponse {
  id?: string
  locationId?: string
  location?: { id?: string }
}

/**
 * Create a new LeadConnector sub-account (location) under the agency.
 *
 * TODO(ryan): confirm endpoint. Best-known shape for LeadConnector's
 * agency "create sub-account" call: `POST /locations/` (Version
 * 2021-07-28), cloning `LEADCONNECTOR_SNAPSHOT_ID` into the new location
 * via a `snapshotId` field on the body. The real payload may also need a
 * `companyId` (agency id) plus address/timezone/phone fields the LC docs
 * require — once confirmed, only the `body` object below needs to
 * change; lcFetch/error handling above stays put.
 */
export async function createSubAccount(input: CreateSubAccountInput): Promise<CreateSubAccountResult> {
  const snapshotId = process.env.LEADCONNECTOR_SNAPSHOT_ID
  const body: Record<string, unknown> = {
    name: input.name?.trim() || input.businessName,
    email: input.email,
    ...(input.websiteUrl ? { website: input.websiteUrl } : {}),
    ...(snapshotId ? { snapshotId } : {}),
  }

  const data = await lcFetch<CreateSubAccountRawResponse>('/locations/', {
    method: 'POST',
    body: JSON.stringify(body),
  })

  const locationId = data.locationId || data.id || data.location?.id
  if (!locationId) {
    throw new LeadConnectorError(200, JSON.stringify(data), 'LeadConnector accepted the sub-account request but returned no location id.')
  }
  return { locationId }
}

// ─── Phone numbers ──────────────────────────────────────────────────────

export interface AvailableNumber {
  number: string
  formatted: string
  region?: string
}

interface SearchNumbersRawResponse {
  numbers?: Array<{
    phoneNumber?: string
    friendlyName?: string
    region?: string
    locality?: string
  }>
}

/** Cosmetic US-style formatting fallback for when the API doesn't supply
 *  a friendlyName. Purely presentational — never used for matching. */
function formatUsNumber(e164: string): string {
  const digits = e164.replace(/\D/g, '')
  const last10 = digits.slice(-10)
  if (last10.length !== 10) return e164
  return `(${last10.slice(0, 3)}) ${last10.slice(3, 6)}-${last10.slice(6)}`
}

/**
 * Search numbers available for purchase in a given area code.
 *
 * TODO(ryan): confirm endpoint. Best-known shape: LeadConnector's
 * phone-system numbers search lives under `GET
 * /phone-system/numbers/search?areaCode=...` (optionally scoped with
 * `&locationId=...` — pass `locationId` here once confirmed whether the
 * search is agency-wide or per-sub-account; the second param below is
 * already wired for that). Adjust `path` only; return shape stays the
 * same either way.
 */
export async function searchAvailableNumbers(areaCode: string, locationId?: string): Promise<AvailableNumber[]> {
  const qs = new URLSearchParams({ areaCode })
  if (locationId) qs.set('locationId', locationId)

  const data = await lcFetch<SearchNumbersRawResponse>(`/phone-system/numbers/search?${qs.toString()}`)
  const rows = Array.isArray(data.numbers) ? data.numbers : []
  const out: AvailableNumber[] = []
  for (const row of rows) {
    if (!row.phoneNumber) continue
    out.push({
      number: row.phoneNumber,
      formatted: row.friendlyName || formatUsNumber(row.phoneNumber),
      region: row.region || row.locality || undefined,
    })
  }
  return out
}

/**
 * Purchase a searched number into a sub-account.
 *
 * TODO(ryan): confirm endpoint. Best-known shape: `POST
 * /phone-system/numbers` with `{ locationId, phoneNumber }`. Adjust
 * `path`/`body` only.
 */
export async function purchaseNumber(locationId: string, number: string): Promise<{ ok: true }> {
  await lcFetch('/phone-system/numbers', {
    method: 'POST',
    body: JSON.stringify({ locationId, phoneNumber: number }),
  })
  return { ok: true }
}
