import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { widgetCorsHeaders } from '@/lib/widget-auth'

/**
 * GET /api/leadconnector-embed/resolve?locationId=...
 *
 * Called by the app-embed script (public/leadconnector-app-embed.js) that
 * the marketplace app injects into CRM dashboards via the Custom JS
 * module. The registered JS file is one URL for every install, so it
 * can't carry a widget id — this endpoint answers "which widget serves
 * this location?" from the AgencyConnection ↔ AgencyLocation mapping.
 *
 * Public by design: it only reveals a widget id + publicKey, both of
 * which already ship verbatim in every embed snippet. Returns
 * { widget: null } when the location is unknown, toggled off, or its
 * widget is paused — the script then simply doesn't render anything,
 * which is the per-location kill switch working from the inside too.
 */
export async function OPTIONS(req: NextRequest) {
  return new NextResponse(null, { status: 204, headers: widgetCorsHeaders(req.headers.get('origin')) })
}

export async function GET(req: NextRequest) {
  const headers = widgetCorsHeaders(req.headers.get('origin'))
  const locationId = req.nextUrl.searchParams.get('locationId')?.trim()
  if (!locationId) {
    return NextResponse.json({ error: 'locationId required' }, { status: 400, headers })
  }

  try {
    const row = await db.agencyLocation.findFirst({
      where: {
        locationId,
        removedAt: null,
        widgetEnabled: true,
        connection: { widget: { isActive: true } },
      },
      orderBy: { connection: { createdAt: 'asc' } },
      select: {
        connection: { select: { widget: { select: { id: true, publicKey: true } } } },
      },
    })
    if (!row) return NextResponse.json({ widget: null }, { headers })
    return NextResponse.json({
      widget: { id: row.connection.widget.id, publicKey: row.connection.widget.publicKey },
    }, { headers })
  } catch {
    // Un-migrated DB or transient failure — fail closed here (no widget)
    // rather than 500ing inside customer dashboards.
    return NextResponse.json({ widget: null }, { headers })
  }
}
