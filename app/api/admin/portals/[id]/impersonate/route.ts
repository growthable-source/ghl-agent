import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAdminRole, logAdminActionAfter } from '@/lib/admin-auth'
import { signPortalAdminToken, setPortalCookie } from '@/lib/portal-auth'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ id: string }> }

/**
 * GET /api/admin/portals/:id/impersonate
 *
 * Opens the portal AS AN ADMIN — mints a short-lived (2h) portal session
 * scoped to the portal's full brand catalog and redirects to /portal.
 * No PortalUser account required; the portal sidebar shows "Admin
 * preview" so it's obvious which hat you're wearing. Signing out of the
 * portal ends the preview.
 *
 * NOTE: this is an API route answering with a 302 — link with a plain
 * <a>, not next/link.
 */
export async function GET(req: NextRequest, { params }: Ctx) {
  const session = await requireAdminRole('admin')
  if (!session) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  const portal = await db.portal.findUnique({
    where: { id },
    select: { id: true, name: true, isActive: true },
  })
  if (!portal) return NextResponse.json({ error: 'Portal not found' }, { status: 404 })
  if (!portal.isActive) {
    return NextResponse.json({ error: 'Portal is inactive — activate it before previewing' }, { status: 409 })
  }

  const token = await signPortalAdminToken(portal.id, session.email)
  await setPortalCookie(token)
  logAdminActionAfter({ admin: session, action: 'impersonate_portal', target: portal.id, meta: { portalName: portal.name } })

  return NextResponse.redirect(new URL('/portal', req.url))
}
