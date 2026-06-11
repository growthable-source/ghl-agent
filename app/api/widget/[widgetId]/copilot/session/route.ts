/**
 * POST /api/widget/[widgetId]/copilot/session
 *
 * Visitor-facing Co-Pilot session create. Auth is the widget's
 * publicKey + allowed-origin check (same validateWidgetRequest every
 * widget API uses) — NOT NextAuth. The session is created in
 * 'widget' mode: business-expert persona, knowledge scoped to the
 * widget's agent's domains, query_knowledge as the only tool (no
 * internal workspace-state access).
 *
 * Plan gate: the WORKSPACE must have copilot (Scale tier or
 * allowlist). Visitors of a non-entitled workspace simply don't see
 * the button (config flag) — this is the server-side backstop.
 *
 * Body: { cookieId?, locale? } — cookieId resolves the WidgetVisitor
 * (created earlier by the chat embed) so the post-session ticket has
 * a contact email when the visitor shared one.
 */

import { NextRequest, NextResponse } from 'next/server'
import { validateWidgetRequest, widgetCorsHeaders } from '@/lib/widget-auth'
import { db } from '@/lib/db'
import { canUseCopilot } from '@/lib/plans'
import {
  createWidgetSession,
  CopilotNotConfiguredError,
  CopilotTokenMintError,
} from '@/lib/copilot/session-service'

type Params = { params: Promise<{ widgetId: string }> }

export async function OPTIONS(req: NextRequest) {
  return new NextResponse(null, { status: 204, headers: widgetCorsHeaders(req.headers.get('origin')) })
}

export async function POST(req: NextRequest, { params }: Params) {
  const { widgetId } = await params
  const headers = widgetCorsHeaders(req.headers.get('origin'))
  const v = await validateWidgetRequest(req, widgetId)
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: v.status, headers })

  const workspace = await db.workspace.findUnique({
    where: { id: v.widget.workspaceId },
    select: { plan: true },
  })
  if (!workspace || !canUseCopilot(workspace.plan, v.widget.workspaceId)) {
    return NextResponse.json(
      { error: 'Live help is not available right now.', code: 'COPILOT_PLAN_GATE' },
      { status: 402, headers },
    )
  }

  const body = (await req.json().catch(() => ({}))) as { cookieId?: string; locale?: string }

  // Resolve the visitor (may be null for a brand-new browser — the
  // ticket path then degrades to no_contact_email).
  let visitorId: string | null = null
  if (typeof body.cookieId === 'string' && body.cookieId) {
    const visitor = await db.widgetVisitor.findFirst({
      where: { widgetId, cookieId: body.cookieId },
      select: { id: true },
    })
    visitorId = visitor?.id ?? null
  }

  try {
    const result = await createWidgetSession({
      workspaceId: v.widget.workspaceId,
      widgetId,
      businessTitle: v.widget.title || v.widget.name,
      agentId: v.widget.defaultAgentId || v.widget.voiceAgentId || null,
      visitorId,
      locale: body.locale,
    })
    return NextResponse.json(result, { headers })
  } catch (err) {
    if (err instanceof CopilotNotConfiguredError) {
      return NextResponse.json(
        { error: 'Live help is not configured.', code: 'COPILOT_NOT_CONFIGURED' },
        { status: 503, headers },
      )
    }
    if (err instanceof CopilotTokenMintError) {
      return NextResponse.json(
        { error: 'Could not start a live session right now.', code: 'COPILOT_TOKEN_MINT_FAILED' },
        { status: 502, headers },
      )
    }
    throw err
  }
}
