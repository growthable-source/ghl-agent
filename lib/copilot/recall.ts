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
  recordings?: Array<{
    media_shortcuts?: {
      video_mixed?: { data?: { download_url?: string } }
    }
  }>
}

function toBot(body: RecallBotResponse): RecallBot {
  const changes = Array.isArray(body.status_changes) ? body.status_changes : []
  const last = changes.length > 0 ? changes[changes.length - 1] : null
  return { id: body.id ?? '', status: last?.code ?? null }
}

/**
 * recording_config that turns on per-participant PNG capture and streams it
 * to our relay worker (recall-video-worker). Recall requires the recording
 * itself to be enabled (`video_separate_png` + a `video_mixed_layout`)
 * alongside the realtime endpoint — sending just `realtime_endpoints` is
 * rejected with a 400. `video_mixed_layout` also keeps the post-call mixed
 * mp4 (the self-learning loop reads it). Returns null when
 * RECALL_VIDEO_WORKER_WS_HOST is unset — the bot then runs audio-only.
 */
export function buildMeetingRecordingConfig(botToken: string): Record<string, unknown> | null {
  const host = process.env.RECALL_VIDEO_WORKER_WS_HOST
  if (!host) return null
  return {
    video_mixed_layout: 'gallery_view_v2',
    video_separate_png: {},
    realtime_endpoints: [
      { type: 'websocket', url: `wss://${host}/recall/${botToken}`, events: ['video_separate_png.data'] },
    ],
  }
}

/**
 * Create a bot and send it to a meeting. `webpageUrl` is the page the
 * bot streams as its camera — our Gemini Live bot page. `botToken` keys
 * the real-time screenshare stream back to this session's relay room.
 *
 * Resilient: if the screen-vision recording_config is rejected (any 4xx),
 * we retry once WITHOUT it so the meeting still gets a bot (audio-only),
 * and log Recall's full error body so the video config can be corrected.
 */
export async function createMeetingBot(opts: {
  meetingUrl: string
  botName: string
  webpageUrl: string
  botToken: string
}): Promise<RecallBot> {
  const variant = process.env.RECALL_BOT_VARIANT || 'web_4_core'
  const base: Record<string, unknown> = {
    meeting_url: opts.meetingUrl,
    bot_name: opts.botName.slice(0, 64),
    output_media: { camera: { kind: 'webpage', config: { url: opts.webpageUrl } } },
    variant: { zoom: variant, google_meet: variant, microsoft_teams: variant },
  }
  const recordingConfig = buildMeetingRecordingConfig(opts.botToken)

  const attempt = async (payload: Record<string, unknown>) => {
    const res = await recallFetch('/api/v1/bot/', { method: 'POST', body: JSON.stringify(payload) })
    const raw = await res.text().catch(() => '')
    let body: (RecallBotResponse & { detail?: string }) | null = null
    try {
      body = raw ? (JSON.parse(raw) as RecallBotResponse) : null
    } catch {
      body = null
    }
    return { ok: res.ok, status: res.status, body, raw }
  }

  if (recordingConfig) {
    const withVideo = await attempt({ ...base, recording_config: recordingConfig })
    if (withVideo.ok && withVideo.body?.id) return toBot(withVideo.body)
    console.warn(
      `[Recall] bot create with screen-vision rejected (${withVideo.status}); retrying audio-only. Body: ${withVideo.raw.slice(0, 600)}`,
    )
    const audioOnly = await attempt(base)
    if (audioOnly.ok && audioOnly.body?.id) return toBot(audioOnly.body)
    throw new RecallApiError(`bot create failed (${audioOnly.status}): ${audioOnly.raw.slice(0, 300)}`, audioOnly.status)
  }

  const res = await attempt(base)
  if (res.ok && res.body?.id) return toBot(res.body)
  throw new RecallApiError(`bot create failed (${res.status}): ${res.raw.slice(0, 300)}`, res.status)
}

export async function getMeetingBot(botId: string): Promise<RecallBot> {
  const res = await recallFetch(`/api/v1/bot/${encodeURIComponent(botId)}/`)
  const body = (await res.json().catch(() => ({}))) as RecallBotResponse
  if (!res.ok) throw new RecallApiError(`bot fetch failed (${res.status})`, res.status)
  return toBot(body)
}

/**
 * Bot status + the call recording's mp4 download URL once Recall has
 * finished processing it (mixed video is recorded by default for all
 * bots; the URL appears minutes after the call ends and is
 * short-lived — download promptly, don't store it).
 */
export async function getMeetingBotRecording(botId: string): Promise<RecallBot & { recordingUrl: string | null }> {
  const res = await recallFetch(`/api/v1/bot/${encodeURIComponent(botId)}/`)
  const body = (await res.json().catch(() => ({}))) as RecallBotResponse
  if (!res.ok) throw new RecallApiError(`bot fetch failed (${res.status})`, res.status)
  const recordingUrl =
    body.recordings?.find(r => r.media_shortcuts?.video_mixed?.data?.download_url)?.media_shortcuts
      ?.video_mixed?.data?.download_url ?? null
  return { ...toBot(body), recordingUrl }
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
