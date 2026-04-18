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
  return NextResponse.json({
    id: w.id,
    name: w.name,
    primaryColor: w.primaryColor,
    logoUrl: w.logoUrl,
    title: w.title,
    subtitle: w.subtitle,
    welcomeMessage: w.welcomeMessage,
    position: w.position,
    requireEmail: w.requireEmail,
    askForNameEmail: w.askForNameEmail,
    voiceEnabled: w.voiceEnabled,
  }, { headers })
}
