import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'

type Params = { params: Promise<{ workspaceId: string; agentId: string }> }

export async function GET(_req: NextRequest, { params }: Params) {
  const { workspaceId, agentId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access
  const rules = await db.routingRule.findMany({
    where: { agentId },
    orderBy: { priority: 'asc' },
  })
  return NextResponse.json({ rules })
}

export async function POST(req: NextRequest, { params }: Params) {
  const { workspaceId, agentId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access
  const body = await req.json()

  // Two request shapes are accepted:
  //
  //  A) Legacy single-clause: { ruleType, value, priority? }
  //     Writes ruleType + value directly. Evaluator uses the single-field path.
  //
  //  B) Compound: { conditions: { clauses: [{ ruleType, values[] }, ...] }, priority? }
  //     Writes conditions. For DB back-compat we still populate ruleType from
  //     the first clause (Prisma requires it — it's non-null). The evaluator
  //     prefers conditions when present and ignores the legacy fields.
  //
  // Priority of 999 is reserved for catch-all ALL rules so they sort last —
  // we mirror that when the compound rule's first clause is ALL.
  const conditions = body.conditions as
    | { clauses?: Array<{ ruleType: string; values?: string[] }> }
    | undefined

  const firstClauseType = conditions?.clauses?.[0]?.ruleType ?? body.ruleType
  const priority = body.priority ?? (firstClauseType === 'ALL' ? 999 : 10)

  const rule = await db.routingRule.create({
    data: {
      agentId,
      ruleType: firstClauseType,
      value: conditions ? null : (body.value ?? null),
      conditions: conditions ?? undefined,
      priority,
    },
  })
  return NextResponse.json({ rule }, { status: 201 })
}
