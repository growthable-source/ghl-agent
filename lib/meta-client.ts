/**
 * Meta Send API wrapper for Messenger + Instagram DMs.
 *
 * One Graph API endpoint serves both channels — `POST /v19.0/me/messages`
 * — but the route depends on which Page Access Token you authenticate
 * with: a Facebook Page token sends to Messenger, an Instagram-linked
 * Page token sends to Instagram users via the same call.
 *
 * The 24-hour messaging window is the Meta-policy concern this module
 * exists to surface explicitly:
 *
 *   - Within 24h of the user's last inbound: messaging_type='RESPONSE'
 *     (always allowed, no tag).
 *   - After 24h (the "window has closed"): the message is REJECTED by
 *     Meta unless we attach a `messaging_type='MESSAGE_TAG'` plus a
 *     valid `tag`. Wrong tag = rate-limit / suspension. We default to
 *     'HUMAN_AGENT' because it's the broadest legal use for a sales /
 *     CS agent re-engaging a lead.
 *
 *   - A null `lastInboundAt` is treated as "out of window" — the safer
 *     default, since attempting RESPONSE outside the window costs more
 *     than attaching a tag inside it.
 */

const GRAPH_BASE = 'https://graph.facebook.com/v19.0'
const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000

export type MessagingType = 'RESPONSE' | 'UPDATE' | 'MESSAGE_TAG'

/**
 * Tags Meta currently accepts for out-of-window outbounds. Only a subset
 * is appropriate for an AI sales / CS agent. We default to HUMAN_AGENT
 * since it explicitly covers "responding to a user-initiated chat" and
 * keeps us inside policy without inventing a fake account-update.
 *
 * Full list: https://developers.facebook.com/docs/messenger-platform/send-messages/message-tags
 */
export type MessageTag =
  | 'HUMAN_AGENT'
  | 'CONFIRMED_EVENT_UPDATE'
  | 'POST_PURCHASE_UPDATE'
  | 'ACCOUNT_UPDATE'

export interface SendOptions {
  /** ISO timestamp of the contact's most recent inbound. Drives 24h-window logic. */
  lastInboundAt?: string | null
  /** Override the auto-picked messaging_type. */
  messagingType?: MessagingType
  /** Override the tag (only used when messagingType is MESSAGE_TAG). */
  tag?: MessageTag
}

export interface SendResult {
  ok: boolean
  messageId?: string
  /** Why the send failed, suitable for surfacing into MessageLog.errorMessage. */
  errorMessage?: string
  /** What we ended up sending (auto-picked or explicit) — useful for audit. */
  messagingType: MessagingType
  tag?: MessageTag
}

/**
 * Decide messaging_type + tag from the inbound recency. Pure so the
 * agent loop / tests can introspect what would have been sent without
 * actually firing a Graph call.
 */
export function pickMessagingType(opts: SendOptions, nowMs = Date.now()): { messagingType: MessagingType; tag?: MessageTag } {
  if (opts.messagingType) {
    return { messagingType: opts.messagingType, tag: opts.tag }
  }
  const last = opts.lastInboundAt ? new Date(opts.lastInboundAt).getTime() : NaN
  const inWindow = Number.isFinite(last) && (nowMs - last) < TWENTY_FOUR_HOURS_MS
  if (inWindow) return { messagingType: 'RESPONSE' }
  return { messagingType: 'MESSAGE_TAG', tag: opts.tag ?? 'HUMAN_AGENT' }
}

/**
 * Send a text DM via the Meta Graph API. Same call shape for Messenger
 * and Instagram — what differs is which Page Access Token you pass and
 * whether `recipientId` is a PSID (Messenger) or IGSID (Instagram).
 */
export async function sendMetaMessage(params: {
  pageAccessToken: string
  recipientId: string
  text: string
  options?: SendOptions
  nowMs?: number
}): Promise<SendResult> {
  const { pageAccessToken, recipientId, text, options = {}, nowMs = Date.now() } = params
  const picked = pickMessagingType(options, nowMs)

  const body: Record<string, unknown> = {
    recipient: { id: recipientId },
    message: { text },
    messaging_type: picked.messagingType,
  }
  if (picked.messagingType === 'MESSAGE_TAG' && picked.tag) {
    body.tag = picked.tag
  }

  let res: Response
  try {
    res = await fetch(`${GRAPH_BASE}/me/messages?access_token=${encodeURIComponent(pageAccessToken)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  } catch (err: any) {
    return {
      ok: false,
      errorMessage: `Network error reaching Graph: ${err?.message ?? 'unknown'}`,
      messagingType: picked.messagingType,
      tag: picked.tag,
    }
  }

  if (!res.ok) {
    const errBody = await res.text().catch(() => '')
    return {
      ok: false,
      errorMessage: `Graph ${res.status}: ${errBody.slice(0, 500)}`,
      messagingType: picked.messagingType,
      tag: picked.tag,
    }
  }

  let data: any
  try { data = await res.json() } catch { data = {} }
  return {
    ok: true,
    messageId: typeof data.message_id === 'string' ? data.message_id : undefined,
    messagingType: picked.messagingType,
    tag: picked.tag,
  }
}

/**
 * Quick health check for an integration's page access token. Hits
 * `/me?fields=id,name` — cheap, returns 401 if the token has expired
 * or been revoked. Used by the integrations/verify endpoint to surface
 * "your Meta token expired, reconnect" before the next inbound is lost.
 */
export async function checkPageToken(pageAccessToken: string): Promise<{ ok: boolean; pageId?: string; pageName?: string; errorMessage?: string }> {
  try {
    const res = await fetch(`${GRAPH_BASE}/me?fields=id,name&access_token=${encodeURIComponent(pageAccessToken)}`)
    if (!res.ok) {
      const errBody = await res.text().catch(() => '')
      return { ok: false, errorMessage: `Graph ${res.status}: ${errBody.slice(0, 300)}` }
    }
    const data = await res.json() as { id?: string; name?: string }
    return { ok: true, pageId: data.id, pageName: data.name }
  } catch (err: any) {
    return { ok: false, errorMessage: `Network error: ${err?.message ?? 'unknown'}` }
  }
}
