import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAdminRole, logAdminActionAfter } from '@/lib/admin-auth'
import { createBuilderToken } from '@/lib/partner/builder-token'
import { builderUrl } from '@/lib/partner/embed'

type Params = { params: Promise<{ installId: string }> }

/**
 * POST — mint a single-use widget-builder link for a Help Center
 * install, exactly like the partner's builder-link endpoint but
 * admin-authenticated. Lets staff open the customer's embedded widget
 * builder (appearance, welcome message, active toggle) straight from
 * Admin → Help Center without asking the partner API for a link.
 *
 * The token signs the install's own user into the embedded builder, so
 * treat the minted URL like the impersonation link it is: single-use,
 * 10-minute TTL, audit-logged.
 */
export async function POST(_req: NextRequest, { params }: Params) {
  const session = await requireAdminRole('admin')
  if (!session) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { installId } = await params
  const install = await db.partnerInstall.findUnique({
    where: { id: installId },
    select: { id: true, businessName: true, userId: true, workspaceId: true, widgetId: true },
  })
  if (!install) return NextResponse.json({ error: 'Install not found' }, { status: 404 })
  if (!install.userId || !install.workspaceId || !install.widgetId) {
    return NextResponse.json({ error: 'Install has no provisioned widget yet — unlock/provision it first.' }, { status: 409 })
  }

  const token = await createBuilderToken(install.userId, install.workspaceId, install.widgetId)

  logAdminActionAfter({
    admin: session,
    action: 'mint_help_center_builder_link',
    target: install.id,
    meta: { businessName: install.businessName, workspaceId: install.workspaceId },
  })

  return NextResponse.json({ builderUrl: builderUrl(token) })
}
