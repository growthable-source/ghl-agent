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

  // Three request shapes are accepted:
  //
  //  A) Legacy single-clause: { ruleType, value, priority? }
  //     Writes ruleType + value directly. Evaluator uses the single-field path.
  //
  //  B) Compound AND: { conditions: { clauses: [{ ruleType, values[], negate? }, ...] } }
  //     Writes conditions. Every clause must match (AND).
  //
  //  C) Compound AND/OR: { conditions: { groups: [{ clauses: [...] }, ...] } }
  //     Each group is an AND; groups are OR'd together.
  //
  // For DB back-compat we still populate ruleType from the first resolvable
  // clause (Prisma requires it — non-null). Evaluator prefers groups > clauses
  // > legacy single-field.
  //
  // Priority of 999 is reserved for catch-all ALL rules so they sort last —
  // we mirror that when every resolvable clause is ALL.
  const conditions = body.conditions as
    | {
        groups?: Array<{ clauses: Array<{ ruleType: string; values?: string[]; negate?: boolean }> }>
        clauses?: Array<{ ruleType: string; values?: string[]; negate?: boolean }>
      }
    | undefined

  const firstClause =
    conditions?.groups?.[0]?.clauses?.[0] ??
    conditions?.clauses?.[0]
  const firstClauseType = firstClause?.ruleType ?? body.ruleType

  // Detect "pure ALL" compounds (single clause, ruleType=ALL, no negate) so
  // they still sort last like legacy ALL rules. Anything more specific gets
  // the normal priority.
  const allClauseTypes = [
    ...(conditions?.groups?.flatMap(g => g.clauses.map(c => c.ruleType)) ?? []),
    ...(conditions?.clauses?.map(c => c.ruleType) ?? []),
  ]
  const isPureAll = allClauseTypes.length > 0 && allClauseTypes.every(t => t === 'ALL')
  const priority = body.priority ?? ((firstClauseType === 'ALL' && isPureAll) ? 999 : 10)

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
