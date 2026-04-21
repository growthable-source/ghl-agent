import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getAdminSession, logAdminAction } from '@/lib/admin-auth'
import { toCsv, csvResponse, ADMIN_EXPORT_ROW_CAP } from '@/lib/admin-csv'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const session = await getAdminSession()
  if (!session) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const q = (req.nextUrl.searchParams.get('q') ?? '').trim()
  const plan = (req.nextUrl.searchParams.get('plan') ?? '').trim()
  const where: any = {}
  if (q) {
    where.OR = [
      { name: { contains: q, mode: 'insensitive' } },
      { slug: { contains: q, mode: 'insensitive' } },
      { domain: { contains: q, mode: 'insensitive' } },
      { id: { contains: q } },
    ]
  }
  if (plan) where.plan = plan

  const rows_ = await db.workspace.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: ADMIN_EXPORT_ROW_CAP,
    select: {
      id: true, name: true, slug: true, domain: true,
      plan: true, billingPeriod: true,
      agentLimit: true, messageLimit: true, messageUsage: true,
      voiceMinuteLimit: true, voiceMinuteUsage: true, extraAgentCount: true,
      trialEndsAt: true, createdAt: true, updatedAt: true,
      isPaused: true, pausedAt: true,
      stripeCustomerId: true, stripeSubscriptionId: true, stripePriceId: true,
      stripeCurrentPeriodEnd: true,
      _count: { select: { members: true, agents: true } },
    },
  })

  const rows: Array<Array<string | number | null>> = [[
    'id', 'name', 'slug', 'domain',
    'plan', 'billingPeriod',
    'memberCount', 'agentCount',
    'agentLimit', 'messageLimit', 'messageUsage',
    'voiceMinuteLimit', 'voiceMinuteUsage', 'extraAgentCount',
    'trialEndsAt', 'createdAt', 'updatedAt',
    'isPaused', 'pausedAt',
    'stripeCustomerId', 'stripeSubscriptionId', 'stripePriceId', 'stripeCurrentPeriodEnd',
  ]]
  for (const w of rows_) {
    rows.push([
      w.id, w.name, w.slug, w.domain ?? '',
      w.plan, w.billingPeriod,
      w._count.members, w._count.agents,
      w.agentLimit, w.messageLimit, w.messageUsage,
      w.voiceMinuteLimit, w.voiceMinuteUsage, w.extraAgentCount,
      w.trialEndsAt?.toISOString() ?? '',
      w.createdAt.toISOString(), w.updatedAt.toISOString(),
      w.isPaused ? 'true' : 'false',
      w.pausedAt?.toISOString() ?? '',
      w.stripeCustomerId ?? '', w.stripeSubscriptionId ?? '',
      w.stripePriceId ?? '',
      w.stripeCurrentPeriodEnd?.toISOString() ?? '',
    ])
  }

  logAdminAction({
    admin: session,
    action: 'export_workspaces_csv',
    meta: { q, plan, rowCount: rows_.length },
  }).catch(() => {})

  const stamp = new Date().toISOString().slice(0, 10)
  return csvResponse(`voxility-workspaces-${stamp}.csv`, toCsv(rows))
}
