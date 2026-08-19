/**
 * The help-center onboarding email — a Growthable-branded welcome that
 * hands the customer every link they need as a labelled button, so an
 * operator (Dan) doesn't hand-write the same "here's your help centre,
 * here's your widget, here's your portal" email every time.
 *
 * Growthable-branded, not Xovera: the recipient is a Growthable
 * customer; Xovera is just the engine behind their widget. Email
 * constraints as elsewhere — inline styles, table layout, system-font
 * fallbacks, no external assets.
 */

const INK = '#25313d'
const HEADING = '#34475b'
const ACCENT = '#f03e6a'
const PAPER = '#fbfaf8'
const RULE = '#e4e2dc'
const FAINT = '#8b949e'
const SANS = "-apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"

export interface OnboardingLinks {
  businessName: string
  /** The customer's live help centre (public). */
  helpCentreUrl: string | null
  /** GKB dashboard origin, e.g. https://whitelabelghl.growthable.io */
  dashboardOrigin: string | null
  /** Portal login URL (stats, transcripts, tickets), if a portal exists. */
  portalUrl: string | null
}

function esc(v: string): string {
  return v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

export function onboardingSubject(businessName: string): string {
  return `${businessName}: your help centre is ready — here's everything in one place`
}

interface Section {
  eyebrow: string
  title: string
  body: string
  buttons: Array<{ label: string; url: string }>
}

function buildSections(links: OnboardingLinks): Section[] {
  const d = links.dashboardOrigin?.replace(/\/+$/, '') ?? null
  const sections: Section[] = []

  sections.push({
    eyebrow: 'Your help centre',
    title: 'Write articles and manage your team',
    body: 'Your help centre is live and already stocked with articles. From your dashboard you can add your own articles, hide any you don\'t want shown, and invite the people on your team who answer clients.',
    buttons: [
      ...(links.helpCentreUrl ? [{ label: 'View your live help centre', url: links.helpCentreUrl }] : []),
      ...(d ? [
        { label: 'Add & edit articles', url: `${d}/dashboard/articles` },
        { label: 'Show / hide articles', url: `${d}/dashboard/articles` },
        { label: 'Invite your team', url: `${d}/dashboard/team` },
      ] : []),
    ],
  })

  if (d) {
    sections.push({
      eyebrow: 'Your AI chat widget',
      title: 'Customise it and grab the install code',
      body: 'The AI chat widget is already on your help centre — nothing to paste there. On this page you can change its look and welcome message, and copy the embed snippet to drop into your HighLevel agency (or anywhere else you want it). The page walks you through where the code goes.',
      buttons: [{ label: 'Configure widget & get install code', url: `${d}/dashboard/ai-agent` }],
    })
  }

  if (links.portalUrl) {
    sections.push({
      eyebrow: 'Your admin portal',
      title: 'Stats, transcripts and tickets',
      body: 'Log in to your portal as the admin to see how the AI is performing across your clients, download conversation transcripts, and check any support tickets that came in.',
      buttons: [{ label: 'Open your portal', url: links.portalUrl }],
    })
  }

  return sections
}

export function onboardingText(links: OnboardingLinks): string {
  const lines = [`Hi — your ${links.businessName} help centre is ready. Here's everything in one place:`, '']
  for (const s of buildSections(links)) {
    lines.push(`## ${s.title}`, s.body)
    for (const b of s.buttons) lines.push(`- ${b.label}: ${b.url}`)
    lines.push('')
  }
  lines.push('Any questions, just reply to this email.', '', 'The Growthable team')
  return lines.join('\n')
}

export function onboardingHtml(links: OnboardingLinks): string {
  const sectionsHtml = buildSections(links).map(s => `
<tr><td style="padding:26px 32px 0 32px;">
  <span style="font-family:${SANS};font-size:11px;letter-spacing:0.14em;text-transform:uppercase;color:${ACCENT};">${esc(s.eyebrow)}</span>
  <h2 style="margin:8px 0 0 0;font-family:${SANS};font-size:19px;line-height:1.25;font-weight:800;letter-spacing:-0.02em;color:${HEADING};">${esc(s.title)}</h2>
  <p style="margin:8px 0 0 0;font-family:${SANS};font-size:14px;line-height:1.6;color:${INK};">${esc(s.body)}</p>
  <div style="margin-top:14px;">
    ${s.buttons.map(b => `<a href="${esc(b.url)}" style="display:inline-block;margin:0 8px 8px 0;background:${ACCENT};color:#ffffff;font-family:${SANS};font-size:13px;font-weight:600;text-decoration:none;padding:10px 18px;border-radius:8px;">${esc(b.label)}</a>`).join('')}
  </div>
</td></tr>`).join('')

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>${esc(onboardingSubject(links.businessName))}</title></head>
<body style="margin:0;padding:0;background:${PAPER};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">Your help centre, chat widget, and portal — every link in one place.</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${PAPER};padding:32px 16px;">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:1px solid ${RULE};border-radius:12px;">
<tr><td style="padding:28px 32px 0 32px;">
  <span style="font-family:${SANS};font-size:19px;font-weight:800;letter-spacing:-0.02em;color:${HEADING};">Growthable</span>
</td></tr>
<tr><td style="padding:14px 32px 0 32px;">
  <h1 style="margin:0;font-family:${SANS};font-size:25px;line-height:1.15;font-weight:800;letter-spacing:-0.025em;color:${HEADING};">Welcome — ${esc(links.businessName)} is all set up.</h1>
  <p style="margin:10px 0 0 0;font-family:${SANS};font-size:14px;line-height:1.6;color:${INK};">Everything you need is below. Each button takes you straight to the right place.</p>
</td></tr>
${sectionsHtml}
<tr><td style="padding:26px 32px 28px 32px;border-top:1px solid ${RULE};margin-top:24px;">
  <p style="margin:24px 0 0 0;font-family:${SANS};font-size:12px;line-height:1.6;color:${FAINT};">Any questions, just reply to this email and a human will help. — The Growthable team</p>
</td></tr>
</table>
</td></tr>
</table>
</body></html>`
}
