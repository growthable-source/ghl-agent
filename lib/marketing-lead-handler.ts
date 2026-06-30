/**
 * Fan-out for a freshly captured marketing/signup lead: push it into our own
 * sales CRM (so it enters follow-up automations) and alert the team. Every
 * branch is best-effort and env-gated — a missing token or key just skips
 * that channel, never breaks the public form.
 *
 *   Sales CRM   — VOXILITY_SALES_GHL_LOCATION_ID + VOXILITY_SALES_GHL_ACCESS_TOKEN
 *   Email alert — LEAD_ALERT_EMAIL  (via Resend, NOTIFICATION_FROM_EMAIL)
 *   Slack alert — LEAD_ALERT_SLACK_WEBHOOK  (incoming webhook URL)
 */
import { sendEmail } from '@/lib/email-send'

const GHL_BASE = 'https://services.leadconnectorhq.com'
const GHL_VERSION = '2021-07-28'

export type MarketingLeadEvent = {
  email: string
  name?: string | null
  phone?: string | null
  company?: string | null
  source: string
  crmChoice?: string | null
  monthlyLeads?: string | null
  referrer?: string | null
  /** Fire the immediate Slack/email alert (true for high-intent demo/signup, false for newsletter). */
  alert?: boolean
}

/** Push the lead into the internal sales GHL location (upsert dedups by email). */
async function syncToSalesGhl(e: MarketingLeadEvent): Promise<void> {
  const locationId = process.env.VOXILITY_SALES_GHL_LOCATION_ID
  const token = process.env.VOXILITY_SALES_GHL_ACCESS_TOKEN
  if (!locationId || !token) return

  const tags = ['xovera-lead', `source:${e.source}`, e.crmChoice ? `crm:${e.crmChoice}` : null].filter(Boolean) as string[]
  const body = {
    locationId,
    email: e.email,
    firstName: e.name?.split(' ')[0] ?? null,
    lastName: e.name?.split(' ').slice(1).join(' ') || null,
    phone: e.phone ?? null,
    companyName: e.company ?? null,
    tags,
    source: `xovera: ${e.source}`,
    customFields: [
      { key: 'xovera_lead_source', field_value: e.source },
      { key: 'xovera_crm_choice', field_value: e.crmChoice ?? '' },
      { key: 'xovera_monthly_leads', field_value: e.monthlyLeads ?? '' },
      { key: 'xovera_referrer', field_value: e.referrer ?? '' },
    ],
  }
  const res = await fetch(`${GHL_BASE}/contacts/upsert`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, Version: GHL_VERSION, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    console.error('[lead-handler] sales GHL upsert failed:', res.status, text.slice(0, 300))
  }
}

function summaryLines(e: MarketingLeadEvent): string[] {
  return [
    `Name: ${e.name || '—'}`,
    `Email: ${e.email}`,
    e.phone ? `Phone: ${e.phone}` : '',
    e.company ? `Business: ${e.company}` : '',
    `Source: ${e.source}`,
    e.crmChoice ? `CRM: ${e.crmChoice}` : '',
    e.monthlyLeads ? `Monthly leads: ${e.monthlyLeads}` : '',
  ].filter(Boolean)
}

async function emailAlert(e: MarketingLeadEvent): Promise<void> {
  const to = process.env.LEAD_ALERT_EMAIL
  if (!to) return
  const lines = summaryLines(e)
  const subject = `🚀 New ${e.source} lead: ${e.name || e.email}`
  await sendEmail({
    to,
    subject,
    text: lines.join('\n'),
    html: `<h2 style="margin:0 0 12px">🚀 New lead</h2><table style="font:14px/1.6 -apple-system,sans-serif">${lines
      .map((l) => {
        const [k, ...rest] = l.split(': ')
        return `<tr><td style="color:#666;padding-right:12px">${k}</td><td><strong>${rest.join(': ')}</strong></td></tr>`
      })
      .join('')}</table>`,
    context: 'lead-alert',
  })
}

async function slackAlert(e: MarketingLeadEvent): Promise<void> {
  const url = process.env.LEAD_ALERT_SLACK_WEBHOOK
  if (!url) return
  const text = `🚀 *New ${e.source} lead*\n${summaryLines(e).join('\n')}`
  await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  })
}

/**
 * Handle a captured lead. Awaited by the caller (so it actually runs on
 * serverless before the function freezes) but each channel is isolated —
 * one failure never affects the others or the form response.
 */
export async function handleMarketingLead(e: MarketingLeadEvent): Promise<void> {
  const jobs: Promise<void>[] = [syncToSalesGhl(e)]
  if (e.alert) jobs.push(emailAlert(e), slackAlert(e))
  const results = await Promise.allSettled(jobs)
  for (const r of results) {
    if (r.status === 'rejected') console.error('[lead-handler] channel failed:', r.reason)
  }
}
