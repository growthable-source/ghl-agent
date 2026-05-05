/**
 * GET /api/workspaces/[workspaceId]/ad-accounts
 *
 * Lists every connected ad account for the workspace — both Meta and
 * Google. Used by the Integrations page to render the Advertising
 * section. Tokens are deliberately NEVER returned to the client; only
 * what the operator needs to identify and manage the account.
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'

export const dynamic = 'force-dynamic'

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ workspaceId: string }> },
) {
  const { workspaceId } = await ctx.params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  const [meta, google] = await Promise.all([
    db.metaAdAccount.findMany({
      where: { workspaceId },
      select: {
        id: true,
        accountName: true,
        metaAccountId: true,
        isActive: true,
        autoPilotEnabled: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { createdAt: 'desc' },
    }),
    db.googleAdAccount.findMany({
      where: { workspaceId },
      select: {
        id: true,
        accountName: true,
        googleCustomerId: true,
        isActive: true,
        autoPilotEnabled: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { createdAt: 'desc' },
    }),
  ])

  return NextResponse.json({ meta, google })
}
