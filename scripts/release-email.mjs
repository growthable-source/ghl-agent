/**
 * Growthable release-email builder + sender.
 *
 * Renders a content JSON file into the Growthable house email template
 * (dark-navy hero, emerald accent — the marketing sibling of
 * lib/email-render.ts) and sends it either as a one-off sample or as a
 * Resend Broadcast to the distribution list.
 *
 * Usage:
 *   node scripts/release-email.mjs --content scripts/release-emails/2026-07-10.json --sample ryan@growthable.io
 *   node scripts/release-email.mjs --content scripts/release-emails/2026-07-10.json --broadcast
 *
 * Content JSON shape:
 *   {
 *     "subject":   "New in Growthable: …",
 *     "preheader": "One-line inbox preview text",
 *     "title":     "Headline inside the card",
 *     "intro":     "Short hook paragraph (plain text)",
 *     "videoUrl":  "https://… or null",
 *     "sections":  [{ "emoji": "📚", "title": "…", "body": "HTML-safe string, <strong>/<em> allowed" }],
 *     "outro":     "Optional closing HTML-safe line"
 *   }
 *
 * Modes:
 *   --sample <email>  Send the rendered email to one address. Works with the
 *                     send-only RESEND_API_KEY. Subject is prefixed [SAMPLE].
 *   --broadcast       Sync MarketingLead emails into the 'Growthable updates'
 *                     Resend Audience, create a Broadcast (with Resend's
 *                     managed unsubscribe link in the footer), and send it.
 *                     Requires a FULL-ACCESS key in RESEND_FULL_API_KEY —
 *                     the send-only key cannot manage audiences/broadcasts.
 *
 * Env (read from ghl-agent/.env.local or the process env):
 *   RESEND_API_KEY        send-only key — enough for --sample
 *   RESEND_FULL_API_KEY   full-access key — required for --broadcast
 *   RESEND_AUDIENCE_ID    optional; skips the find-or-create-audience step
 *   RELEASE_EMAIL_FROM    optional; defaults to Growthable <updates@notifications.voxility.ai>
 *   POSTGRES_PRISMA_URL / POSTGRES_URL / DATABASE_URL   for the MarketingLead sync
 */

import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

// ── args ─────────────────────────────────────────────────────────────
const args = process.argv.slice(2)
const flag = name => {
  const i = args.indexOf(`--${name}`)
  return i === -1 ? null : (args[i + 1]?.startsWith('--') ? true : args[i + 1] ?? true)
}
const contentPath = flag('content')
const sampleTo = flag('sample')
const broadcast = args.includes('--broadcast')

if (!contentPath || (!sampleTo && !broadcast)) {
  console.error('Usage: node scripts/release-email.mjs --content <file.json> (--sample <email> | --broadcast)')
  process.exit(1)
}

// ── env ──────────────────────────────────────────────────────────────
function loadEnv() {
  const envPath = join(ROOT, '.env.local')
  if (!existsSync(envPath)) return
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=["']?([^"'\n]*)["']?$/)
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2]
  }
}
loadEnv()

const FROM = process.env.RELEASE_EMAIL_FROM || 'Growthable <updates@notifications.voxility.ai>'
const AUDIENCE_NAME = 'Growthable updates'

// ── template (Growthable house style) ────────────────────────────────
const ACCENT = '#34d399'
const HERO = '#03101d'

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

function render(content, { unsubscribeFooter = false } = {}) {
  const sections = (content.sections || []).map(s => `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 18px;">
      <tr>
        <td style="vertical-align:top;width:34px;font-size:20px;line-height:1.4;">${esc(s.emoji || '•')}</td>
        <td style="vertical-align:top;">
          <p style="margin:0 0 4px;font-size:15px;font-weight:600;color:#111827;">${esc(s.title)}</p>
          <p style="margin:0;font-size:14px;line-height:1.6;color:#4b5563;">${s.body}</p>
        </td>
      </tr>
    </table>`).join('\n')

  const video = content.videoUrl
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 24px;">
        <tr><td style="border:1px solid #e5e7eb;border-radius:12px;padding:20px 24px;background:#fafafa;" align="center">
          <a href="${esc(content.videoUrl)}" style="text-decoration:none;">
            <span style="display:inline-block;width:52px;height:52px;border-radius:999px;background:${ACCENT};color:#ffffff;font-size:22px;line-height:52px;text-align:center;">&#9654;</span>
            <p style="margin:12px 0 2px;font-size:15px;font-weight:600;color:#111827;">Watch the walkthrough</p>
            <p style="margin:0;font-size:12px;color:#6b7280;">See everything below in action.</p>
          </a>
        </td></tr>
      </table>`
    : ''

  const unsub = unsubscribeFooter
    ? ` · <a href="{{{RESEND_UNSUBSCRIBE_URL}}}" style="color:#9ca3af;text-decoration:underline;">Unsubscribe</a>`
    : ''

  const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><title>${esc(content.subject)}</title></head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#111827;">
  <div style="display:none;font-size:1px;color:#fafafa;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">${esc(content.preheader || '')}&#8204;&#8204;&#8204;&#8204;&#8204;</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f4f4f5;padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;background:#ffffff;border-radius:14px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.06);">
        <tr><td style="background:${HERO};padding:18px 28px;">
          <span style="font-size:18px;font-weight:700;color:#ffffff;letter-spacing:-0.3px;">Growthable</span>
        </td></tr>
        <tr><td style="height:4px;background:${ACCENT};line-height:4px;font-size:0;">&nbsp;</td></tr>
        <tr><td style="padding:28px 32px 24px;">
          <h1 style="margin:0 0 12px;font-size:22px;line-height:1.3;font-weight:600;color:#111827;">${esc(content.title)}</h1>
          <p style="margin:0 0 20px;font-size:15px;line-height:1.6;color:#4b5563;">${esc(content.intro || '')}</p>
          ${video}
          ${sections}
          ${content.outro ? `<p style="margin:6px 0 0;font-size:14px;line-height:1.6;color:#4b5563;">${content.outro}</p>` : ''}
        </td></tr>
        <tr><td style="padding:14px 32px 18px;border-top:1px solid #e5e7eb;color:#9ca3af;font-size:11px;line-height:1.5;">
          Sent by Growthable${unsub}
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`

  const text = [
    '[Growthable] ' + content.title,
    '',
    content.intro || '',
    content.videoUrl ? `\nWatch the walkthrough: ${content.videoUrl}\n` : '',
    ...(content.sections || []).map(s => `${(s.title || '').toUpperCase()}\n${s.body.replace(/<[^>]+>/g, '')}\n`),
    content.outro ? content.outro.replace(/<[^>]+>/g, '') : '',
    '',
    'Sent by Growthable',
  ].join('\n')

  return { html, text }
}

// ── resend helpers ───────────────────────────────────────────────────
async function resend(key, method, path, body) {
  const res = await fetch(`https://api.resend.com${path}`, {
    method,
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(`Resend ${method} ${path} → ${res.status}: ${data.message || JSON.stringify(data).slice(0, 200)}`)
  return data
}

// ── main ─────────────────────────────────────────────────────────────
const content = JSON.parse(readFileSync(contentPath, 'utf8'))

if (sampleTo) {
  const key = process.env.RESEND_API_KEY || process.env.RESEND_FULL_API_KEY
  if (!key) { console.error('RESEND_API_KEY not set.'); process.exit(1) }
  const { html, text } = render(content)
  const data = await resend(key, 'POST', '/emails', {
    from: FROM,
    to: [sampleTo],
    subject: `[SAMPLE] ${content.subject}`,
    html,
    text,
  })
  console.log(`Sample sent to ${sampleTo} — message id ${data.id}`)
}

if (broadcast) {
  const key = process.env.RESEND_FULL_API_KEY
  if (!key) {
    console.error(
      'RESEND_FULL_API_KEY not set. Broadcasts need a FULL-ACCESS key (the regular\n' +
      'RESEND_API_KEY is send-only). Create one at https://resend.com/api-keys and\n' +
      'add RESEND_FULL_API_KEY=... to ghl-agent/.env.local.',
    )
    process.exit(1)
  }

  // 1. Find or create the audience.
  let audienceId = process.env.RESEND_AUDIENCE_ID
  if (!audienceId) {
    const audiences = await resend(key, 'GET', '/audiences')
    audienceId = (audiences.data || []).find(a => a.name === AUDIENCE_NAME)?.id
    if (!audienceId) {
      const created = await resend(key, 'POST', '/audiences', { name: AUDIENCE_NAME })
      audienceId = created.id
      console.log(`Created Resend audience "${AUDIENCE_NAME}" (${audienceId})`)
    }
  }

  // 2. Sync MarketingLead emails into the audience. Resend rejects
  //    duplicates per audience, so re-syncing is idempotent noise we ignore.
  const dbUrl = process.env.POSTGRES_PRISMA_URL || process.env.POSTGRES_URL || process.env.DATABASE_URL
  if (!dbUrl) { console.error('No database URL in env — cannot sync MarketingLead.'); process.exit(1) }
  const { default: pg } = await import('pg')
  const pool = new pg.Pool({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } })
  let leads = []
  try {
    const res = await pool.query('SELECT email FROM "MarketingLead" ORDER BY "createdAt" ASC')
    leads = res.rows.map(r => r.email).filter(Boolean)
  } catch (err) {
    console.error(`MarketingLead query failed (table missing in this database?): ${err.message}`)
    process.exit(1)
  } finally {
    await pool.end()
  }
  console.log(`${leads.length} leads in MarketingLead — syncing to audience…`)
  let added = 0
  for (const email of leads) {
    try {
      await resend(key, 'POST', `/audiences/${audienceId}/contacts`, { email, unsubscribed: false })
      added++
    } catch { /* already in audience */ }
  }
  console.log(`Audience sync done (${added} new contacts).`)

  // 3. Create + send the broadcast, unsubscribe link included.
  const { html, text } = render(content, { unsubscribeFooter: true })
  const created = await resend(key, 'POST', '/broadcasts', {
    audience_id: audienceId,
    from: FROM,
    subject: content.subject,
    html,
    text,
    name: content.subject,
  })
  await resend(key, 'POST', `/broadcasts/${created.id}/send`, {})
  console.log(`Broadcast sent to audience ${audienceId} — broadcast id ${created.id}`)
}
