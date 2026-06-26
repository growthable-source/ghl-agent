/**
 * Branded email template wrapper.
 *
 * Until now every transactional email rolled its own HTML — the same
 * "rounded white card on #f4f4f5" idiom copy-pasted across five files,
 * each with its own escapeHtml, its own accent variable, its own
 * button styling. This made consistent branding (header bar with the
 * Xovera wordmark, severity badge for warning/error mails, a single
 * CTA button shape, a uniform footer with manage-notifications link)
 * impossible without touching all five places.
 *
 * Cross-client design choices:
 *
 * - **No external images.** Gmail strips SVG and clobbers tracking
 *   pixels on a per-account basis; some corporate Outlook installs
 *   block all external images by default. We render the brand as a
 *   solid-colour header bar with a CSS-styled wordmark instead. Same
 *   look on every client, no asset hosting headache, no concerns about
 *   the 1MB PNGs in /branding ever loading slowly.
 *
 * - **Inline styles + table layout.** Every styled element uses
 *   inline `style="..."` and the layout is `<table role="presentation">`
 *   because half the email-client universe still strips <style> blocks
 *   and ignores CSS class selectors. This is the same approach the
 *   existing helpers were already using; we just unify it.
 *
 * - **Severity colour bar at the top of the card.** Warning/error
 *   emails get an obvious visual cue without forcing the recipient
 *   to read the subject line — the same way our in-app
 *   needs-attention banners do.
 *
 * - **CTA button is a styled <a>** with `display:inline-block` and
 *   ~12px vertical padding, large enough to thumb-tap on mobile.
 */

const BRAND = {
  name: 'Xovera',
  /** Primary accent — same #fa4d2e used everywhere in the app. */
  accent: '#fa4d2e',
  /** Hero bar gradient — softer than a flat block; reads as branded
   *  not as an in-app banner. */
  heroGradient: 'linear-gradient(135deg, #fa4d2e 0%, #f97316 100%)',
}

export type EmailSeverity = 'info' | 'warning' | 'error' | 'success'

interface SeverityStyle {
  badgeLabel: string | null
  badgeBg: string
  badgeFg: string
  topBar: string
  buttonBg: string
}

const SEVERITY: Record<EmailSeverity, SeverityStyle> = {
  info: {
    badgeLabel: null,
    badgeBg: 'transparent',
    badgeFg: 'transparent',
    topBar: BRAND.accent,
    buttonBg: BRAND.accent,
  },
  warning: {
    badgeLabel: 'Action needed',
    badgeBg: '#fef3c7',
    badgeFg: '#92400e',
    topBar: '#f59e0b',
    buttonBg: '#f59e0b',
  },
  error: {
    badgeLabel: 'Attention required',
    badgeBg: '#fee2e2',
    badgeFg: '#b91c1c',
    topBar: '#ef4444',
    buttonBg: '#ef4444',
  },
  success: {
    badgeLabel: 'Done',
    badgeBg: '#dcfce7',
    badgeFg: '#15803d',
    topBar: '#22c55e',
    buttonBg: '#22c55e',
  },
}

export interface BrandedEmail {
  /** Subject-line equivalent — appears as the h1 inside the card. */
  title: string
  /** Optional preheader — the snippet email clients show next to the subject. */
  preheader?: string
  /** Optional intro paragraph above the body — short hook for context. */
  intro?: string
  /** Pre-rendered HTML for the body content. Must already be HTML-safe. */
  bodyHtml: string
  /** Severity drives the top bar colour, optional badge, and button colour. Defaults to info. */
  severity?: EmailSeverity
  /** Optional CTA. Renders below the body. */
  cta?: { label: string; url: string }
  /** Optional footer text — overrides the default "Sent by Xovera" line. */
  footer?: string
  /** When set, included as a "Manage notifications" link in the footer. */
  manageNotificationsUrl?: string
}

export interface RenderedEmail {
  html: string
  text: string
}

/**
 * Render a complete email (html + text fallback) from a BrandedEmail
 * spec. Callers should populate bodyHtml using `escapeHtml()` for any
 * untrusted strings.
 */
export function renderBrandedEmail(email: BrandedEmail): RenderedEmail {
  const sev = SEVERITY[email.severity || 'info']
  const safeTitle = escapeHtml(email.title)
  const safeIntro = email.intro ? escapeHtml(email.intro) : null
  const safePreheader = email.preheader ? escapeHtml(email.preheader) : ''
  const safeFooter = email.footer ? escapeHtml(email.footer) : `Sent by ${BRAND.name}`

  const manageLink = email.manageNotificationsUrl
    ? ` · <a href="${escapeAttr(email.manageNotificationsUrl)}" style="color:#9ca3af;text-decoration:underline;">Manage notifications</a>`
    : ''

  const badge = sev.badgeLabel
    ? `<span style="display:inline-block;padding:3px 9px;background:${sev.badgeBg};color:${sev.badgeFg};border-radius:999px;font-size:11px;font-weight:600;letter-spacing:0.5px;text-transform:uppercase;">${sev.badgeLabel}</span>`
    : ''

  const cta = email.cta
    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0 8px;">
         <tr><td style="border-radius:8px;background:${sev.buttonBg};">
           <a href="${escapeAttr(email.cta.url)}"
              style="display:inline-block;padding:12px 22px;background:${sev.buttonBg};color:#ffffff;
                     text-decoration:none;border-radius:8px;font-size:14px;font-weight:600;
                     font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
             ${escapeHtml(email.cta.label)}
           </a>
         </td></tr>
       </table>`
    : ''

  // Preheader sits hidden at the top of the body — clients show it
  // next to the subject line in inbox previews. zero-width spaces pad
  // it so clients don't fall back to grabbing the visible h1 instead.
  const preheaderEl = safePreheader
    ? `<div style="display:none;font-size:1px;color:#fafafa;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">${safePreheader}‌‌‌‌‌</div>`
    : ''

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${safeTitle}</title>
</head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#111827;">
  ${preheaderEl}
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f4f4f5;padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
             style="max-width:560px;background:#ffffff;border-radius:14px;overflow:hidden;
                    box-shadow:0 1px 3px rgba(0,0,0,0.06);">

        <!-- Hero header bar with the Xovera wordmark. CSS only — no
             external image, so every client renders it consistently. -->
        <tr><td style="background:${BRAND.heroGradient};padding:18px 28px;">
          <span style="font-size:18px;font-weight:700;color:#ffffff;letter-spacing:-0.3px;
                       font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
            ${BRAND.name}
          </span>
        </td></tr>

        <!-- Severity colour bar — thin strip directly under the brand bar. -->
        <tr><td style="height:4px;background:${sev.topBar};line-height:4px;font-size:0;">&nbsp;</td></tr>

        <!-- Body card. -->
        <tr><td style="padding:28px 32px 24px;">
          ${badge ? `<div style="margin:0 0 12px;">${badge}</div>` : ''}
          <h1 style="margin:0 0 12px;font-size:22px;line-height:1.3;font-weight:600;color:#111827;">
            ${safeTitle}
          </h1>
          ${safeIntro ? `<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#4b5563;">${safeIntro}</p>` : ''}
          <div style="font-size:14px;line-height:1.65;color:#374151;">
            ${email.bodyHtml}
          </div>
          ${cta}
        </td></tr>

        <!-- Footer. -->
        <tr><td style="padding:14px 32px 18px;border-top:1px solid #e5e7eb;color:#9ca3af;font-size:11px;line-height:1.5;">
          ${safeFooter}${manageLink}
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`

  // Plaintext alternative — clients that prefer it (some legacy
  // configs, accessibility tools) get a usable version. Strip the body
  // HTML to its tags-removed form; callers can pass a richer plaintext
  // via the future `text` override if this proves insufficient.
  const text = [
    `[${BRAND.name}]`,
    email.title,
    '',
    email.intro || null,
    htmlToPlain(email.bodyHtml),
    email.cta ? `\n${email.cta.label}: ${email.cta.url}` : null,
    '',
    `— ${BRAND.name}`,
  ].filter(Boolean).join('\n')

  return { html, text }
}

/** HTML-escape an untrusted string for use in element content. */
export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[ch]!))
}

/** HTML-escape for use inside an attribute value. Same as escapeHtml plus url-friendly. */
export function escapeAttr(s: string): string {
  return escapeHtml(s)
}

/**
 * Quick paragraph builder — most senders compose multiple <p> tags.
 * Each item becomes one paragraph with safe escaping. Pass pre-built
 * HTML strings to keep links etc. (then it's the caller's job to
 * escape correctly).
 */
export function paragraphs(parts: Array<string | { html: string }>): string {
  return parts
    .map(p =>
      typeof p === 'string'
        ? `<p style="margin:0 0 12px;font-size:14px;line-height:1.65;color:#374151;">${escapeHtml(p)}</p>`
        : `<p style="margin:0 0 12px;font-size:14px;line-height:1.65;color:#374151;">${p.html}</p>`,
    )
    .join('')
}

/**
 * Minimal HTML→plaintext converter for the text/plain alternative.
 * Strips tags, decodes the handful of named entities we emit. Good
 * enough for the templates we generate; not a general-purpose parser.
 */
function htmlToPlain(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
