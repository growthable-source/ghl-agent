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

  let payload: any
  try {
    payload = JSON.parse(raw)
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
  const isThreadReply =
    event?.type === 'message' && event.thread_ts && event.thread_ts !== event.ts
  const isHuman = !event?.bot_id && !event?.subtype

  if (isThreadReply && isHuman) {
    after(async () => {
      try {
        const conn = await getConnectionByTeam(payload.team_id)
        if (!conn || event.user === conn.botUserId) return // ignore our own posts

        const convo = await db.widgetConversation.findFirst({
          where: { slackChannelId: event.channel, slackThreadTs: event.thread_ts },
          select: { id: true },
        })
        if (!convo) return

        const botToken = await getDecryptedBotToken(conn.workspaceId)
        if (!botToken) return

        await applySlackReply({
          conversationId: convo.id,
          slackUserId: event.user,
          botToken,
          rawText: event.text ?? '',
        })
      } catch (e: unknown) {
        console.error('[slack] event processing failed:', e instanceof Error ? e.message : e)
      }
    })
  }

  return NextResponse.json({ ok: true })
}
