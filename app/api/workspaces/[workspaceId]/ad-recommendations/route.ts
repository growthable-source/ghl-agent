/**
 * GET  /api/workspaces/[workspaceId]/ad-recommendations
 *      List recommendations across all accounts in the workspace.
 *
 * POST /api/workspaces/[workspaceId]/ad-recommendations
 *      Body: { provider: 'meta' | 'google', accountId: string, daysBack?: number }
 *      Generate fresh recommendations for one ad account. Persists each
 *      one to AdRecommendation and returns the new rows.
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'
import { generateAccountRecommendations, persistRecommendations } from '@/lib/ad-recommendations'
import Anthropic from '@anthropic-ai/sdk'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ workspaceId: string }> },
) {
  const { workspaceId } = await ctx.params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  const url = new URL(req.url)
  const status = url.searchParams.get('status') ?? 'pending'

  // Find all account IDs for the workspace.
  const [meta, google] = await Promise.all([
    db.metaAdAccount.findMany({ where: { workspaceId }, select: { id: true } }),
    db.googleAdAccount.findMany({ where: { workspaceId }, select: { id: true } }),
  ])
  const metaIds = meta.map((a) => a.id)
  const googleIds = google.map((a) => a.id)

  const recs = await db.adRecommendation.findMany({
    where: {
      OR: [
        ...(metaIds.length > 0 ? [{ metaAccountId: { in: metaIds } }] : []),
        ...(googleIds.length > 0 ? [{ googleAccountId: { in: googleIds } }] : []),
      ],
      ...(status !== 'all' ? { status } : {}),
    },
    orderBy: [{ priority: 'asc' }, { createdAt: 'desc' }],
    take: 100,
  })
  return NextResponse.json({ recommendations: recs })
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ workspaceId: string }> },
) {
  const { workspaceId } = await ctx.params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  const body = (await req.json().catch(() => null)) as
    | { provider?: 'meta' | 'google'; accountId?: string; daysBack?: number }
    | null
  if (!body || !body.provider || !body.accountId) {
    return NextResponse.json({ error: 'provider and accountId required' }, { status: 400 })
  }
  if (body.provider !== 'meta' && body.provider !== 'google') {
    return NextResponse.json({ error: `unknown provider "${body.provider}"` }, { status: 400 })
  }

  // Verify the account belongs to this workspace before we burn tokens.
  const owns = body.provider === 'meta'
    ? await db.metaAdAccount.findFirst({ where: { id: body.accountId, workspaceId }, select: { id: true } })
    : await db.googleAdAccount.findFirst({ where: { id: body.accountId, workspaceId }, select: { id: true } })
  if (!owns) {
    return NextResponse.json({ error: 'account_not_in_workspace' }, { status: 404 })
  }

  try {
    const drafts = await generateAccountRecommendations({
      provider: body.provider,
      accountId: body.accountId,
      daysBack: body.daysBack,
    })
    const inserted = await persistRecommendations({
      provider: body.provider,
      accountId: body.accountId,
      drafts,
    })
    return NextResponse.json({ generated: inserted, drafts })
  } catch (err) {
    if (err instanceof Anthropic.RateLimitError) {
      return NextResponse.json({ error: 'rate_limited', detail: err.message }, { status: 429 })
    }
    if (err instanceof Anthropic.APIError) {
      return NextResponse.json({ error: 'anthropic_error', detail: err.message }, { status: 502 })
    }
    const msg = err instanceof Error ? err.message : 'recommendation_failed'
    console.error('[ad-recommendations] generate failed:', msg)
    return NextResponse.json({ error: 'recommendation_failed', detail: msg }, { status: 500 })
  }
}
