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
  // Only embeds that carry data-location-id send this param. The check
  // is scoped to THIS widget's agency connection (one widget ↔ one
  // agency): a location toggled off for this widget returns
  // {disabled:true} and the embed renders nothing, without affecting any
  // other widget serving the same location. Every other path — no param,
  // no connection on this widget, no AgencyLocation row, DB error —
  // falls through to the normal config response, so pre-existing embeds
  // are untouched.
  const embedLocationId = req.nextUrl.searchParams.get('locationId')
  if (embedLocationId) {
    try {
      const { db } = await import('@/lib/db')
      const row = await db.agencyLocation.findFirst({
        where: {
          locationId: embedLocationId,
          removedAt: null,
          connection: { widgetId: w.id },
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

  // ── Launcher options ────────────────────────────────────────────────
  // Up to 2 validated entries. chat/voice entries must point at an
  // ACTIVE agent in the widget's workspace (stale ids drop out silently);
  // copilot entries require the live-help plan gate to have passed.
  let launcher: { kind: string; label: string; agentId: string | null }[] = []
  try {
    const raw = (w as { launcherAgents?: unknown }).launcherAgents
    if (Array.isArray(raw) && raw.length > 0) {
      const { db } = await import('@/lib/db')
      const wanted = raw
        .filter((e: any) => e && typeof e === 'object' && typeof e.label === 'string' && e.label.trim())
        .slice(0, 2)
      const agentIds = wanted
        .filter((e: any) => (e.kind === 'chat' || e.kind === 'voice') && typeof e.agentId === 'string')
        .map((e: any) => e.agentId as string)
      const agents = agentIds.length
        ? await db.agent.findMany({
            where: { id: { in: agentIds }, workspaceId: w.workspaceId, isActive: true },
            select: { id: true },
          })
        : []
      const validAgent = new Set(agents.map(a => a.id))
      launcher = wanted
        .filter((e: any) =>
          e.kind === 'copilot'
            ? liveHelpEnabled
            : (e.kind === 'chat' || e.kind === 'voice') && validAgent.has(e.agentId))
        .map((e: any) => ({ kind: e.kind, label: String(e.label).slice(0, 60), agentId: e.agentId ?? null }))
    }
  } catch {
    launcher = [] // fail open to the classic launcher
  }

  return NextResponse.json({
    id: w.id,
    name: w.name,
    type: w.type,
    embedMode: w.embedMode,
    slug: w.slug,
    primaryColor: w.primaryColor,
    logoUrl: w.logoUrl,
    // Launcher bubble icon — missing columns (pre-migration) degrade to
    // the classic chat glyph.
    launcherIcon: (w as { launcherIcon?: string }).launcherIcon ?? 'chat',
    launcherLetter: (w as { launcherLetter?: string | null }).launcherLetter ?? null,
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
    // Host-page auto-identity gate (marketplace-app injected JS). Missing
    // column (pre-migration) reads as undefined → treated as enabled.
    autoIdentify: (w as { autoIdentify?: boolean }).autoIdentify !== false,
    launcher,
  }, { headers })
}
