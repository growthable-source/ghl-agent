/**
 * Recall.ai meeting-bot client — the P2 `recall_meeting_bot` channel.
 *
 * Recall runs the headless meeting participant for us (Zoom, Google
 * Meet, Microsoft Teams, Webex — join URL in, bot in the call out).
 * We use their Output Media "webpage" mode: the bot loads OUR page
 * (/copilot/bot/[botToken]) in its browser; that page receives the
 * meeting's mixed audio as its microphone input and whatever the page
 * renders + plays becomes the bot's camera tile and voice. The page
 * runs the normal browser-direct Gemini Live session — no server-side
 * media worker needed, which is what makes this fit Vercel.
 *
 * Env:
 *   RECALL_API_KEY     — required; absent = channel gated off (503)
 *   RECALL_REGION      — recall data region subdomain (default us-west-2)
 *   RECALL_BOT_VARIANT — bot compute tier (default web_4_core; the
 *                        basic `web` tier is too weak for an audio
 *                        worklet + websocket page)
 */

export class RecallNotConfiguredError extends Error {}
export class RecallApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
  }
}

export function isRecallConfigured(): boolean {
  return Boolean(process.env.RECALL_API_KEY)
}

function recallBase(): string {
  const region = process.env.RECALL_REGION || 'us-west-2'
  return `https://${region}.recall.ai`
}

async function recallFetch(path: string, init?: RequestInit): Promise<Response> {
  const key = process.env.RECALL_API_KEY
  if (!key) throw new RecallNotConfiguredError('missing RECALL_API_KEY')
  return fetch(`${recallBase()}${path}`, {
    ...init,
    headers: {
      Authorization: `Token ${key}`,
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  })
}

/** Bot lifecycle codes Recall reports via status_changes. */
export type RecallBotStatusCode =
  | 'ready'
  | 'joining_call'
  | 'in_waiting_room'
  | 'in_call_not_recording'
  | 'in_call_recording'
  | 'call_ended'
  | 'done'
  | 'fatal'
  | string

export interface RecallBot {
  id: string
  status: RecallBotStatusCode | null
}

interface RecallBotResponse {
  id?: string
  status_changes?: Array<{ code?: string }>
}

function toBot(body: RecallBotResponse): RecallBot {
  const changes = Array.isArray(body.status_changes) ? body.status_changes : []
  const last = changes.length > 0 ? changes[changes.length - 1] : null
  return { id: body.id ?? '', status: last?.code ?? null }
}

/**
 * Create a bot and send it to a meeting. `webpageUrl` is the page the
 * bot streams as its camera — our Gemini Live bot page.
 */
export async function createMeetingBot(opts: {
  meetingUrl: string
  botName: string
  webpageUrl: string
}): Promise<RecallBot> {
  const variant = process.env.RECALL_BOT_VARIANT || 'web_4_core'
  const res = await recallFetch('/api/v1/bot/', {
    method: 'POST',
    body: JSON.stringify({
      meeting_url: opts.meetingUrl,
      bot_name: opts.botName.slice(0, 64),
      output_media: {
        camera: { kind: 'webpage', config: { url: opts.webpageUrl } },
      },
      variant: { zoom: variant, google_meet: variant, microsoft_teams: variant },
    }),
  })
  const body = (await res.json().catch(() => ({}))) as RecallBotResponse & { detail?: string }
  if (!res.ok || !body.id) {
    throw new RecallApiError(
      `bot create failed (${res.status})${body.detail ? `: ${body.detail}` : ''}`,
      res.status,
    )
  }
  return toBot(body)
}

export async function getMeetingBot(botId: string): Promise<RecallBot> {
  const res = await recallFetch(`/api/v1/bot/${encodeURIComponent(botId)}/`)
  const body = (await res.json().catch(() => ({}))) as RecallBotResponse
  if (!res.ok) throw new RecallApiError(`bot fetch failed (${res.status})`, res.status)
  return toBot(body)
}

/** Tell the bot to hang up. Idempotent from our perspective — a bot
 *  that already left returns an error we deliberately swallow. */
export async function removeMeetingBot(botId: string): Promise<void> {
  try {
    await recallFetch(`/api/v1/bot/${encodeURIComponent(botId)}/leave_call/`, { method: 'POST' })
  } catch (err) {
    if (err instanceof RecallNotConfiguredError) throw err
    console.warn(`[Recall] leave_call for ${botId} failed:`, err)
  }
}

/** Human-readable status for the dashboard UI. */
export function describeBotStatus(code: RecallBotStatusCode | null): string {
  switch (code) {
    case null:
    case 'ready':
    case 'joining_call':
      return 'Joining the meeting…'
    case 'in_waiting_room':
      return 'In the waiting room — admit the bot from inside the meeting'
    case 'in_call_not_recording':
    case 'in_call_recording':
      return 'In the call'
    case 'call_ended':
    case 'done':
      return 'Left the call'
    case 'fatal':
      return 'Could not join the meeting'
    default:
      return code
  }
}
