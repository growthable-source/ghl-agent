import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { auth } from '@/lib/auth'

async function memberAccess(workspaceId: string) {
  const session = await auth()
  if (!session?.user?.id) return null
  const member = await db.workspaceMember.findUnique({
    where: { userId_workspaceId: { userId: session.user.id, workspaceId } },
    select: { role: true },
  })
  return member ? { session, role: member.role } : null
}

/**
 * GET ?workspaceId=...  → list eval sets in the workspace
 * POST { workspaceId, name, description?, knowledgeDomainId? }  → create
 */
export async function GET(req: NextRequest) {
  const workspaceId = req.nextUrl.searchParams.get('workspaceId')
  if (!workspaceId) return NextResponse.json({ error: 'workspaceId required' }, { status: 400 })
  const access = await memberAccess(workspaceId)
  if (!access) return NextResponse.json({ error: 'forbidden' }, { status: 403 })

  try {
    const sets = await (db as any).retrievalEvalSet.findMany({
      where: { workspaceId },
      orderBy: { createdAt: 'desc' },
      include: {
        _count: { select: { queries: true, runs: true } },
        runs: {
          orderBy: { startedAt: 'desc' },
          take: 1,
          select: { id: true, status: true, startedAt: true, completedAt: true, summary: true },
        },
      },
    })
    return NextResponse.json({
      sets: sets.map((s: any) => ({
        id: s.id,
        name: s.name,
        description: s.description,
        knowledgeDomainId: s.knowledgeDomainId,
        createdAt: s.createdAt.toISOString(),
        queryCount: s._count.queries,
        runCount: s._count.runs,
        lastRun: s.runs[0] ? {
          id: s.runs[0].id,
          status: s.runs[0].status,
          startedAt: s.runs[0].startedAt.toISOString(),
          completedAt: s.runs[0].completedAt?.toISOString() ?? null,
          summary: s.runs[0].summary ?? {},
        } : null,
      })),
    })
  } catch (err: any) {
    if (err?.code === 'P2021' || /relation .* does not exist/i.test(err?.message ?? '')) {
      return NextResponse.json({ sets: [], notMigrated: true })
    }
    throw err
  }
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const { workspaceId, name, description, knowledgeDomainId } = body
  if (!workspaceId || !name) return NextResponse.json({ error: 'workspaceId + name required' }, { status: 400 })
  const access = await memberAccess(workspaceId)
  if (!access) return NextResponse.json({ error: 'forbidden' }, { status: 403 })

  try {
    const set = await (db as any).retrievalEvalSet.create({
      data: {
        workspaceId,
        name: String(name).trim().slice(0, 120),
        description: typeof description === 'string' ? description.trim() : null,
        knowledgeDomainId: typeof knowledgeDomainId === 'string' ? knowledgeDomainId : null,
      },
    })
    return NextResponse.json({ set })
  } catch (err: any) {
    if (err?.code === 'P2002') {
      return NextResponse.json({ error: 'An eval set with that name already exists.' }, { status: 409 })
    }
    if (err?.code === 'P2021' || /relation .* does not exist/i.test(err?.message ?? '')) {
      return NextResponse.json({ error: 'Eval harness not migrated — run manual_retrieval_eval_harness.sql' }, { status: 503 })
    }
    throw err
  }
}
