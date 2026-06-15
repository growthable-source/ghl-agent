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
  // these to decide what to offer a queued visitor. Ticketing must also
  // be active for the leave-email→ticket option to actually create one.
  let queue = { enabled: false, gameEnabled: false, emailTicketEnabled: false, message: null as string | null }
  try {
    const { getLiveChatSettings } = await import('@/lib/livechat-settings')
    const { getTicketingStatus } = await import('@/lib/ticketing-access')
    const s = await getLiveChatSettings(w.workspaceId)
    const ticketing = await getTicketingStatus(w.workspaceId)
    queue = {
      enabled: s.queueEnabled,
      gameEnabled: s.queueEnabled && s.queueGameEnabled,
      emailTicketEnabled: s.queueEnabled && s.queueEmailTicketEnabled && ticketing.active,
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
