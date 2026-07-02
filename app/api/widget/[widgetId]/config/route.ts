import { NextRequest, NextResponse } from 'next/server'
import { validateWidgetRequest, widgetCorsHeaders } from '@/lib/widget-auth'

type Params = { params: Promise<{ widgetId: string }> }

export async function OPTIONS(req: NextRequest) {
  return new NextResponse(null, {
    status: 204,
    headers: widgetCorsHeaders(req.headers.get('origin')),
  })
}

/**
 * GET /api/widget/:widgetId/config?pk=<publicKey>
 * Public — widget.js calls this on load to get appearance + behavior.
 */
export async function GET(req: NextRequest, { params }: Params) {
  const { widgetId } = await params
  const v = await validateWidgetRequest(req, widgetId)
  const headers = widgetCorsHeaders(req.headers.get('origin'))
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: v.status, headers })

  const w = v.widget

  // ── Per-location kill switch (opt-in, fail-open) ────────────────────
  // Only embeds that carry data-location-id send this param. A location
  // explicitly toggled off returns {disabled:true} and the embed renders
  // nothing. Every other path — no param, no AgencyLocation row, no
  // agency connection, DB error — falls through to the normal config
  // response, so pre-existing embeds are untouched.
  const embedLocationId = req.nextUrl.searchParams.get('locationId')
  if (embedLocationId) {
    try {
      const { db } = await import('@/lib/db')
      const row = await db.agencyLocation.findFirst({
        where: {
          locationId: embedLocationId,
          removedAt: null,
          connection: { workspaceId: w.workspaceId },
        },
        select: { widgetEnabled: true },
      })
      if (row && !row.widgetEnabled) {
        return NextResponse.json({ disabled: true }, { headers })
      }
    } catch {
      /* fail open — widget renders as normal */
    }
  }

  // Render merge fields on the welcome message. Widget visitors are usually
  // anonymous at config-load time, so contact-scoped tokens resolve to their
  // fallbacks — e.g. `Welcome back {{contact.first_name|friend}}` becomes
  // `Welcome back friend`. If the widget later identifies a returning
  // visitor we can re-render client-side.
  const { renderMergeFields } = await import('@/lib/merge-fields')
  const renderedWelcome = w.welcomeMessage
    ? renderMergeFields(w.welcomeMessage, { contact: null, agent: null, timezone: null })
    : w.welcomeMessage

  // Live screen-share help (Co-Pilot) — workspace plan gate. The
  // embed only renders the button when this is true; the session
  // endpoint re-checks server-side.
  let liveHelpEnabled = false
  try {
    const { db } = await import('@/lib/db')
    const { canUseCopilot } = await import('@/lib/plans')
    const workspace = await db.workspace.findUnique({
      where: { id: w.workspaceId },
      select: { plan: true },
    })
    liveHelpEnabled = !!workspace && canUseCopilot(workspace.plan, w.workspaceId)
  } catch {
    liveHelpEnabled = false
  }

  // Queue / while-you-wait settings (workspace-global). The widget uses
  // these to decide what to offer a *waiting* visitor. A visitor waits in
  // two situations: (a) the capacity queue is on and the team is at its
  // concurrent cap, or (b) nobody is online at all — in which case we show
  // the wait experience regardless of the `queueEnabled` toggle. The
  // game / leave-email options are therefore gated on their OWN switches,
  // not on `queueEnabled`, so they appear in either waiting situation.
  // Ticketing must also be active for the leave-email→ticket option to
  // actually create one.
  let queue = { enabled: false, gameEnabled: false, emailTicketEnabled: false, message: null as string | null }
  try {
    const { getLiveChatSettings } = await import('@/lib/livechat-settings')
    const { getTicketingStatus } = await import('@/lib/ticketing-access')
    const s = await getLiveChatSettings(w.workspaceId)
    const ticketing = await getTicketingStatus(w.workspaceId)
    queue = {
      enabled: s.queueEnabled,
      gameEnabled: s.queueGameEnabled,
      emailTicketEnabled: s.queueEmailTicketEnabled && ticketing.active,
      message: s.queueMessage,
    }
  } catch {
    /* defaults = queue off */
  }

  return NextResponse.json({
    id: w.id,
    name: w.name,
    type: w.type,
    embedMode: w.embedMode,
    slug: w.slug,
    primaryColor: w.primaryColor,
    logoUrl: w.logoUrl,
    title: w.title,
    subtitle: w.subtitle,
    welcomeMessage: renderedWelcome,
    position: w.position,
    buttonLabel: w.buttonLabel,
    buttonShape: w.buttonShape,
    buttonSize: w.buttonSize,
    buttonIcon: w.buttonIcon,
    buttonTextColor: w.buttonTextColor,
    requireEmail: w.requireEmail,
    askForNameEmail: w.askForNameEmail,
    voiceEnabled: w.voiceEnabled || w.type === 'click_to_call',
    liveHelpEnabled,
    queue,
  }, { headers })
}
