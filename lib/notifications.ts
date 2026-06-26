import { db } from './db'

/**
 * Dispatch a notification to all configured channels for a workspace.
 * Supports Slack, Discord, email (Resend), and SMS (Twilio).
 *
 * Event types:
 *   - needs_attention
 *   - approval_pending
 *   - agent_error
 *   - pause_activated
 *   - human_handover    — fires when the agent escalates to a human
 *                         (transfer_to_human tool, or message_and_transfer
 *                         fallback). Payload includes a deep link to the
 *                         conversation so whoever is on-call can jump
 *                         straight in.
 *   - test
 */
export async function notify(params: {
  workspaceId: string
  event: string
  title: string
  body?: string
  link?: string
  severity?: 'info' | 'warning' | 'error'
  // When set, this notification is *personal* — meant for one user, not
  // the whole workspace. Skips shared channels (Slack/Discord/etc.) and
  // only fans out to the targeted user's own email/web push. Used for
  // events like widget.conversation_assigned where blasting the whole
  // team would be noise.
  targetUserId?: string
}) {
  if (!params.targetUserId) {
    let channels: Array<{ id: string; type: string; config: any; events: string[] }>
    try {
      channels = await db.notificationChannel.findMany({
        where: { workspaceId: params.workspaceId, isActive: true },
        select: { id: true, type: true, config: true, events: true },
      })
    } catch {
      return
    }

    const matchingChannels = channels.filter(
      c => c.events.length === 0 || c.events.includes(params.event)
    )

    for (const channel of matchingChannels) {
      try {
        if (channel.type === 'slack') {
          await dispatchSlack(channel.config, params)
        } else if (channel.type === 'discord') {
          await dispatchDiscord(channel.config, params)
        } else if (channel.type === 'email') {
          await dispatchEmail(channel.config, params)
        } else if (channel.type === 'sms') {
          await dispatchSms(params.workspaceId, channel.config, params)
        }
      } catch (err: any) {
        console.warn(`[Notify] ${channel.type} dispatch failed:`, err.message)
      }
    }
  }

  // ── Per-user fan-out ─────────────────────────────────────────────────
  // In addition to the workspace's shared channels (above), every member
  // of the workspace can opt into delivery to *their own* email + browser
  // push. Falls back to defaults from the event catalog when a user has
  // never set explicit preferences.
  await fanOutPerUser(params).catch(err => {
    console.warn('[Notify] per-user fan-out failed:', err.message)
  })
}

async function fanOutPerUser(params: {
  workspaceId: string
  event: string
  title: string
  body?: string
  link?: string
  severity?: 'info' | 'warning' | 'error'
  targetUserId?: string
}) {
  let members: Array<{ userId: string; user: { email: string | null; name: string | null } | null }>
  try {
    members = await db.workspaceMember.findMany({
      where: {
        workspaceId: params.workspaceId,
        ...(params.targetUserId ? { userId: params.targetUserId } : {}),
      },
      select: { userId: true, user: { select: { email: true, name: true } } },
    })
  } catch (err: any) {
    if (
      err?.code === 'P2022' || err?.code === 'P2021'
      || /column .* does not exist/i.test(err?.message ?? '')
    ) return
    throw err
  }
  if (members.length === 0) return

  const { defaultPreferenceFor } = await import('./notification-events')

  // Bulk-load preferences for all members in this workspace for this event.
  let prefs: Array<{ userId: string; channels: string[] }> = []
  try {
    prefs = await (db as any).userNotificationPreference.findMany({
      where: { workspaceId: params.workspaceId, event: params.event },
      select: { userId: true, channels: true },
    })
  } catch (err: any) {
    if (
      err?.code === 'P2022' || err?.code === 'P2021'
      || /relation .* does not exist/i.test(err?.message ?? '')
    ) {
      // Migration pending — fall back to defaults so we still notify.
    } else {
      throw err
    }
  }
  const prefByUser = new Map(prefs.map(p => [p.userId, p.channels]))

  await Promise.all(members.map(async m => {
    const channels = prefByUser.get(m.userId) ?? defaultPreferenceFor(params.event)
    if (channels.length === 0) return

    if (channels.includes('email') && m.user?.email) {
      try {
        await dispatchEmail({ email: m.user.email }, params)
      } catch (err: any) {
        console.warn('[Notify] per-user email failed:', err.message)
      }
    }
    if (channels.includes('web_push')) {
      try {
        const { sendPushToUser } = await import('./web-push')
        await sendPushToUser(m.userId, params.workspaceId, {
          title: params.title,
          body: params.body,
          link: params.link,
          severity: params.severity,
          tag: params.event,
        })
      } catch (err: any) {
        console.warn('[Notify] per-user push failed:', err.message)
      }
    }
  }))
}

async function dispatchSlack(
  config: { webhookUrl?: string },
  params: { event: string; title: string; body?: string; link?: string; severity?: string }
) {
  if (!config.webhookUrl) return
  const color = params.severity === 'error' ? '#ef4444'
    : params.severity === 'warning' ? '#f59e0b'
    : '#fa4d2e'

  await fetch(config.webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      attachments: [{
        color,
        title: params.title,
        text: params.body || '',
        ...(params.link ? { title_link: params.link } : {}),
        footer: 'Xovera',
        ts: Math.floor(Date.now() / 1000),
      }],
    }),
  })
}

/**
 * Email dispatch via the shared branded wrapper (lib/email-render.ts +
 * lib/email-send.ts). The severity strings we accept here match the
 * EmailSeverity enum on the render side ('error' | 'warning' | other →
 * info), so a notification flagged 'error' renders with the red top
 * bar + "Attention required" badge automatically.
 */
async function dispatchEmail(
  config: { email?: string },
  params: { event: string; title: string; body?: string; link?: string; severity?: string }
) {
  const to = config.email
  if (!to) return

  const { renderBrandedEmail, paragraphs } = await import('@/lib/email-render')
  const { sendEmail } = await import('@/lib/email-send')

  const severity =
    params.severity === 'error' ? 'error'
    : params.severity === 'warning' ? 'warning'
    : 'info'

  const { html, text } = renderBrandedEmail({
    title: params.title,
    severity,
    bodyHtml: params.body ? paragraphs([params.body]) : '',
    cta: params.link ? { label: 'Open in Xovera', url: params.link } : undefined,
    manageNotificationsUrl: `${process.env.APP_URL || ''}/dashboard`,
  })

  await sendEmail({
    to,
    subject: params.title,
    html,
    text,
    context: 'Notify',
  })
}

/**
 * Discord incoming webhook. Discord accepts the "embeds" array so we get
 * a proper card with a clickable title rather than a plain text blob.
 */
async function dispatchDiscord(
  config: { webhookUrl?: string },
  params: { event: string; title: string; body?: string; link?: string; severity?: string }
) {
  if (!config.webhookUrl) return
  // Discord uses integer decimal colors. Keep the palette in sync with Slack.
  const color = params.severity === 'error' ? 0xef4444
    : params.severity === 'warning' ? 0xf59e0b
    : 0xfa4d2e

  await fetch(config.webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      embeds: [{
        title: params.title,
        description: params.body || '',
        color,
        ...(params.link ? { url: params.link } : {}),
        footer: { text: 'Xovera' },
        timestamp: new Date().toISOString(),
      }],
    }),
  })
}

/**
 * SMS via Twilio. Reuses the workspace's existing Twilio integration when
 * present (same creds that power inbound SMS), and falls back to top-level
 * env vars for workspaces that haven't connected Twilio yet. Config on
 * the channel only carries the destination phone number.
 *
 * Deliberately short body — SMS has a ~160 char sweet spot. Long alerts
 * truncate and include the deep link so whoever gets paged can jump in.
 */
async function dispatchSms(
  workspaceId: string,
  config: { phoneNumber?: string; from?: string },
  params: { event: string; title: string; body?: string; link?: string; severity?: string }
) {
  const to = config.phoneNumber
  if (!to) return

  // Prefer workspace-scoped Twilio creds (same integration that powers
  // inbound SMS). Fall back to env for single-tenant setups.
  let accountSid: string | undefined
  let authToken: string | undefined
  let from = config.from

  try {
    // Integration is location-scoped. Resolve all locations in this
    // workspace, then look for a Twilio integration attached to any of
    // them. Workspaces typically have one location, so in practice this
    // is a single round trip.
    const locations = await db.location.findMany({
      where: { workspaceId }, select: { id: true },
    })
    if (locations.length > 0) {
      const integ = await db.integration.findFirst({
        where: { locationId: { in: locations.map(l => l.id) }, type: 'twilio' },
      })
      if (integ) {
        const creds = integ.credentials as any
        accountSid = creds?.accountSid
        authToken = creds?.authToken
        if (!from) from = creds?.fromNumber || creds?.from
      }
    }
  } catch { /* fall through to env */ }

  if (!accountSid) accountSid = process.env.TWILIO_ACCOUNT_SID
  if (!authToken)  authToken  = process.env.TWILIO_AUTH_TOKEN
  if (!from)       from       = process.env.TWILIO_FROM_NUMBER

  if (!accountSid || !authToken || !from) {
    console.warn('[Notify] SMS skipped — no Twilio creds for workspace', workspaceId, 'to', to)
    return
  }

  // Compose: title + (short body) + link. Keep under 320 chars to avoid
  // excessive segmentation on carriers that charge per segment.
  const bodyLine = params.body ? ` — ${params.body}` : ''
  const linkLine = params.link ? `\n${params.link}` : ''
  const raw = `[Xovera] ${params.title}${bodyLine}${linkLine}`
  const message = raw.length > 320 ? raw.slice(0, 317) + '…' : raw

  const res = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
    {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ To: to, From: from, Body: message }),
    }
  )
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Twilio ${res.status}: ${body.slice(0, 200)}`)
  }
}
