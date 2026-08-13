/**
 * Fleet-level alerting — pages the operator, not the tenant.
 *
 * Deliberately NOT routed through lib/notifications.ts `notify()`: that is
 * workspace-scoped, and these conditions are properties of the deployment.
 * No customer should be emailed because an OpenRouter key is missing, and
 * fanning one infrastructure fault out across every workspace would be both
 * a support incident and a data-boundary smell.
 *
 * Destination is SUPER_ADMIN_EMAILS (already used by lib/help-auth.ts, so
 * there is no new variable to forget on one project), plus an optional Slack
 * webhook. Slack is best-effort: if it is not configured or fails, email
 * still goes, because the whole point is that this cannot fail quietly.
 *
 * De-duplication uses the CronHeartbeat table under a namespaced key rather
 * than a new model. That is a small semantic stretch — documented here so it
 * is not mistaken for a real cron — and buys a migration-free deploy, which
 * matters when hand-applied SQL is the convention and pending SQL is itself
 * a recurring source of breakage.
 */

import { db } from '@/lib/db'
import type { FleetHealth, FleetHealthStatus } from '@/lib/fleet-health'

/** Namespaced CronHeartbeat key holding alert state (not an actual cron). */
const ALERT_STATE_KEY = 'state:fleet-health-alert'

/** A sustained problem re-alerts at most this often. */
const REPEAT_INTERVAL_MS = 60 * 60_000

interface AlertState {
  lastStatus: FleetHealthStatus | null
  lastAlertAt: Date | null
}

async function readState(): Promise<AlertState> {
  try {
    const row = await db.cronHeartbeat.findUnique({ where: { name: ALERT_STATE_KEY } })
    if (!row) return { lastStatus: null, lastAlertAt: null }
    const s = row.lastError as string | null
    const valid = s === 'ok' || s === 'degraded' || s === 'outage'
    return { lastStatus: valid ? s : null, lastAlertAt: row.lastRunAt ?? null }
  } catch {
    // Table missing or DB blip. Returning "nothing known" makes us alert,
    // which is the safe direction to fail for a paging system.
    return { lastStatus: null, lastAlertAt: null }
  }
}

async function writeState(status: FleetHealthStatus): Promise<void> {
  const now = new Date()
  try {
    await db.cronHeartbeat.upsert({
      where: { name: ALERT_STATE_KEY },
      create: { name: ALERT_STATE_KEY, lastRunAt: now, lastSuccessAt: now, lastError: status, consecutiveFailures: 0 },
      update: { lastRunAt: now, lastSuccessAt: now, lastError: status },
    })
  } catch (err) {
    console.warn('[fleet-alert] could not persist alert state:', err instanceof Error ? err.message : err)
  }
}

function recipients(): string[] {
  return (process.env.SUPER_ADMIN_EMAILS ?? '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

async function sendEmail(subject: string, body: string): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY
  const from = process.env.NOTIFICATION_FROM_EMAIL
  const to = recipients()
  if (!apiKey || !from || to.length === 0) {
    console.warn(
      '[fleet-alert] cannot email: need RESEND_API_KEY, NOTIFICATION_FROM_EMAIL and SUPER_ADMIN_EMAILS. ' +
      `Alert was: ${subject}`,
    )
    return false
  }
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from,
        to,
        subject,
        text: body,
        html: `<div style="font-family:system-ui,-apple-system,Arial,sans-serif;font-size:14px;line-height:1.55;color:#1c1917;white-space:pre-wrap">${escapeHtml(body)}</div>`,
      }),
    })
    if (!res.ok) {
      console.error(`[fleet-alert] Resend ${res.status}: ${(await res.text().catch(() => '')).slice(0, 300)}`)
      return false
    }
    return true
  } catch (err) {
    console.error('[fleet-alert] email send threw:', err instanceof Error ? err.message : err)
    return false
  }
}

async function sendSlack(text: string): Promise<void> {
  const url = process.env.FLEET_ALERT_SLACK_WEBHOOK
  if (!url) return
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    })
  } catch (err) {
    // Never let Slack failure suppress the email that already went.
    console.warn('[fleet-alert] slack post failed:', err instanceof Error ? err.message : err)
  }
}

/**
 * Decide whether `health` warrants paging, and page if so.
 *
 * Alerts when the status CHANGES (including recovery), and re-alerts hourly
 * while a problem persists. Returns what it did so the cron can report it.
 */
export async function dispatchFleetAlert(health: FleetHealth): Promise<{ alerted: boolean; reason: string }> {
  const { lastStatus, lastAlertAt } = await readState()
  const changed = lastStatus !== health.status
  const stale = !lastAlertAt || Date.now() - lastAlertAt.getTime() > REPEAT_INTERVAL_MS

  if (health.status === 'ok') {
    // Only speak up to close the loop on a problem we actually reported.
    if (lastStatus && lastStatus !== 'ok') {
      const subject = '[Xovera] Recovered — AI is answering again'
      const body =
        `${health.headline}\n\n` +
        `Previous state: ${lastStatus}. The fleet is now serving replies normally.\n\n` +
        `Window: last ${health.windowMinutes} minutes\n` +
        `  AI replies:        ${health.aiReplies}\n` +
        `  Failed fallbacks:  ${health.fallbacks}\n` +
        `  Default model:     ${health.defaultModelKey} (${health.defaultModelCallsToday} calls today)\n`
      await sendEmail(subject, body)
      await sendSlack(`✅ *Xovera recovered* — ${health.headline} (was: ${lastStatus})`)
      await writeState('ok')
      return { alerted: true, reason: `recovered from ${lastStatus}` }
    }
    await writeState('ok')
    return { alerted: false, reason: 'healthy' }
  }

  if (!changed && !stale) {
    return { alerted: false, reason: `already alerted ${health.status}, within repeat interval` }
  }

  const urgent = health.status === 'outage'
  const subject = urgent
    ? `[Xovera] OUTAGE — ${health.headline}`
    : `[Xovera] Degraded — ${health.headline}`

  const body =
    `${health.headline}\n\n${health.detail}\n\n` +
    `Measured over the last ${health.windowMinutes} minutes:\n` +
    `  AI replies:        ${health.aiReplies}\n` +
    `  Failed fallbacks:  ${health.fallbacks}\n` +
    `  Agent calls today: ${health.agentCallsToday}\n` +
    `  Default model:     ${health.defaultModelKey} — ${health.defaultModelCallsToday} calls today\n`

  const emailed = await sendEmail(subject, body)
  await sendSlack(
    urgent
      ? `🚨 *Xovera OUTAGE* — ${health.headline}\n${health.detail.split('\n')[0]}`
      : `⚠️ *Xovera degraded* — ${health.headline}`,
  )
  await writeState(health.status)
  return {
    alerted: true,
    reason: `${changed ? 'status changed to' : 'still'} ${health.status}${emailed ? '' : ' (email failed — see logs)'}`,
  }
}
