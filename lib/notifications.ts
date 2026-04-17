import { db } from './db'

/**
 * Dispatch a notification to all configured channels for a workspace.
 * Currently supports Slack webhooks. Email is a stub for future wiring.
 *
 * Event types:
 *   - needs_attention
 *   - approval_pending
 *   - agent_error
 *   - pause_activated
 */
export async function notify(params: {
  workspaceId: string
  event: string
  title: string
  body?: string
  link?: string
  severity?: 'info' | 'warning' | 'error'
}) {
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
      } else if (channel.type === 'email') {
        // Stub: email requires a transactional service (Resend/SES) wired.
        console.log('[Notify] Email not yet wired:', params.title)
      }
    } catch (err: any) {
      console.warn(`[Notify] ${channel.type} dispatch failed:`, err.message)
    }
  }
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
        footer: 'Voxility',
        ts: Math.floor(Date.now() / 1000),
      }],
    }),
  })
}
