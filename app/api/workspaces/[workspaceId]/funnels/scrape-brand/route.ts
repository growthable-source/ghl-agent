/**
 * GET /api/workspaces/[workspaceId]/funnels/scrape-brand?url=https://...
 *
 * Wizard hits this when the operator pastes a reference URL on the
 * Brand step. Returns extracted colors + logo candidates + copy
 * samples for the wizard to pre-fill its fields.
 *
 * Workspace-scoped (not campaign-scoped) so the wizard can call it
 * before a Campaign exists.
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'
import { scrapeBrandFromUrl } from '@/lib/brand-scrape'

export const dynamic = 'force-dynamic'
export const maxDuration = 15

export async function GET(req: NextRequest, ctx: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await ctx.params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  const url = new URL(req.url).searchParams.get('url')
  if (!url) return NextResponse.json({ error: '`url` query param required' }, { status: 400 })

  const result = await scrapeBrandFromUrl(url)
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 })
  return NextResponse.json(result)
}
