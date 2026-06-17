import { NextRequest, NextResponse, after } from 'next/server'
import { verifySlackSignature } from '@/lib/slack/signature'
import { getConnectionByTeam, getDecryptedBotToken } from '@/lib/slack/connection'
import { applySlackReply } from '@/lib/slack/bridge'
import { db } from '@/lib/db'

/**
 * Slack Events API receiver. Signature-verified, deduped (Slack delivers
 * at-least-once and retries on non-200), and ack'd within Slack's 3-second
 * window — the actual work runs in after(). We only act on human text
 * replies inside a known conversation thread.
 */
export async function POST(req: NextRequest) {
  const raw = await req.text()

  const signingSecret = process.env.SLACK_SIGNING_SECRET
  if (!signingSecret) return NextResponse.json({ error: 'not configured' }, { status: 500 })

  const ok = verifySlackSignature({
    secret: signingSecret,
    signature: req.headers.get('x-slack-signature'),
    timestamp: req.headers.get('x-slack-request-timestamp'),
    body: raw,
  })
  if (!ok) return NextResponse.json({ error: 'bad signature' }, { status: 401 })

  interface SlackEventEnvelope {
    type?: string
    challenge?: string
    event_id?: string
    team_id?: string
    event?: {
      type?: string
      subtype?: string
      bot_id?: string
      user?: string
      text?: string
      channel?: string
      thread_ts?: string
      ts?: string
    }
  }

  let payload: SlackEventEnvelope
  try {
    payload = JSON.parse(raw) as SlackEventEnvelope
  } catch {
    return NextResponse.json({ error: 'bad json' }, { status: 400 })
  }

  // URL verification handshake (Slack app setup).
  if (payload.type === 'url_verification') {
    return NextResponse.json({ challenge: payload.challenge })
  }

  // Dedup at-least-once delivery + explicit retries via a unique-insert race.
  const eventId: string | undefined = payload.event_id
  if (eventId) {
    try {
      await db.processedSlackEvent.create({ data: { eventId } })
    } catch {
      return NextResponse.json({ ok: true }) // already processed
    }
  }

  const event = payload.event
  const teamId = payload.team_id

  // Only human text replies inside a thread, with all the fields we need.
  if (
    event?.type === 'message' &&
    event.thread_ts &&
    event.thread_ts !== event.ts &&
    event.channel &&
    event.user &&
    !event.bot_id &&
    !event.subtype &&
    teamId
  ) {
    // Capture narrowed primitives so the async closure stays well-typed.
    const channel = event.channel
    const threadTs = event.thread_ts
    const slackUserId = event.user
    const text = event.text ?? ''

    after(async () => {
      try {
        const conn = await getConnectionByTeam(teamId)
        if (!conn || slackUserId === conn.botUserId) return // ignore our own posts

        const convo = await db.widgetConversation.findFirst({
          where: { slackChannelId: channel, slackThreadTs: threadTs },
          select: { id: true },
        })
        if (!convo) return

        const botToken = await getDecryptedBotToken(conn.workspaceId)
        if (!botToken) return

        await applySlackReply({ conversationId: convo.id, slackUserId, botToken, rawText: text })
      } catch (e: unknown) {
        console.error('[slack] event processing failed:', e instanceof Error ? e.message : e)
      }
    })
  }

  return NextResponse.json({ ok: true })
}
