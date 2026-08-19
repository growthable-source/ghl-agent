import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAdminRole, logAdminActionAfter } from '@/lib/admin-auth'
import { sendEmail } from '@/lib/email-send'
import { portalUrl } from '@/lib/partner/embed'
import { onboardingHtml, onboardingSubject, onboardingText, type OnboardingLinks } from '@/lib/partner/onboarding-email'

type Params = { params: Promise<{ installId: string }> }

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const MAX_RECIPIENTS = 20

// The GKB dashboard origin — one source of truth with the "Help center
// admin" link (both derive from the sync-push URL's origin).
function dashboardOrigin(): string | null {
  const url = process.env.HELP_CENTER_SYNC_URL
  if (!url) return null
  try { return new URL(url).origin } catch { return null }
}

/**
 * POST — send the Growthable onboarding email (help centre / widget /
 * portal, each as a labelled button) to one or more recipients.
 *
 * Body: { recipients: string[] | "a@x.com, b@y.com" }
 *
 * Sent individually (one email per address) so recipients don't see
 * each other. Links are resolved SERVER-SIDE from the install — the
 * client supplies only who to send to. Admin+, audit-logged.
 */
export async function POST(req: NextRequest, { params }: Params) {
  const session = await requireAdminRole('admin')
  if (!session) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { installId } = await params
  const install = await db.partnerInstall.findUnique({
    where: { id: installId },
    select: { id: true, businessName: true, externalEmail: true, metadata: true, widgetId: true },
  })
  if (!install) return NextResponse.json({ error: 'Install not found' }, { status: 404 })

  const body = await req.json().catch(() => ({}))
  const raw: string[] = Array.isArray(body.recipients)
    ? body.recipients
    : String(body.recipients ?? '').split(/[,\n]/)
  const recipients = [...new Set(raw.map(r => r.trim().toLowerCase()).filter(Boolean))]
  if (recipients.length === 0) {
    return NextResponse.json({ error: 'Add at least one recipient email.' }, { status: 400 })
  }
  if (recipients.length > MAX_RECIPIENTS) {
    return NextResponse.json({ error: `Too many recipients (max ${MAX_RECIPIENTS}).` }, { status: 400 })
  }
  const invalid = recipients.filter(r => !EMAIL_RE.test(r))
  if (invalid.length > 0) {
    return NextResponse.json({ error: `Not a valid email: ${invalid.join(', ')}` }, { status: 400 })
  }

  // Resolve the customer's links from the install.
  const meta = (install.metadata ?? {}) as { helpCenterUrl?: string }
  let portal: string | null = null
  if (install.widgetId) {
    const widget = await db.chatWidget.findUnique({
      where: { id: install.widgetId },
      select: { brandId: true },
    }).catch(() => null)
    if (widget?.brandId) {
      const link = await db.portalBrand.findFirst({
        where: { brandId: widget.brandId },
        select: { portal: { select: { slug: true, isActive: true } } },
      }).catch(() => null)
      if (link?.portal?.isActive) portal = portalUrl(link.portal.slug)
    }
  }

  const links: OnboardingLinks = {
    businessName: install.businessName,
    helpCentreUrl: meta.helpCenterUrl ?? null,
    dashboardOrigin: dashboardOrigin(),
    portalUrl: portal,
  }

  const subject = onboardingSubject(install.businessName)
  const html = onboardingHtml(links)
  const text = onboardingText(links)
  const from = process.env.ONBOARDING_FROM_EMAIL || undefined // else lib/email-send default

  const sent: string[] = []
  const failed: Array<{ email: string; reason: string }> = []
  for (const to of recipients) {
    try {
      const id = await sendEmail({ to, subject, html, text, from, context: 'Onboarding' })
      if (id === null) failed.push({ email: to, reason: 'Email sending is not configured (RESEND_API_KEY).' })
      else sent.push(to)
    } catch (err) {
      failed.push({ email: to, reason: err instanceof Error ? err.message : String(err) })
    }
  }

  logAdminActionAfter({
    admin: session,
    action: 'send_help_center_onboarding_email',
    target: install.id,
    meta: { businessName: install.businessName, sent, failed: failed.map(f => f.email) },
  })

  if (sent.length === 0) {
    return NextResponse.json({ error: failed[0]?.reason ?? 'Nothing sent.', failed }, { status: 502 })
  }
  return NextResponse.json({ ok: true, sent, failed })
}
