import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { auth } from '@/lib/auth'

type Params = { params: Promise<{ setId: string }> }

async function memberAccess(setId: string) {
  const session = await auth()
  if (!session?.user?.id) return null
  const set = await (db as any).retrievalEvalSet.findUnique({
    where: { id: setId },
    select: { workspaceId: true },
  })
  if (!set) return null
  const member = await db.workspaceMember.findUnique({
    where: { userId_workspaceId: { userId: session.user.id, workspaceId: set.workspaceId } },
    select: { role: true },
  })
  return member ? { session, role: member.role, workspaceId: set.workspaceId } : null
}

/**
 * GET → full set detail + queries + recent runs
 * POST  /queries (subroute) → add query
 * POST  /run     (subroute) → execute eval
 */
export async function GET(_req: NextRequest, { params }: Params) {
  const { setId } = await params
  const access = await memberAccess(setId)
  if (!access) return NextResponse.json({ error: 'forbidden' }, { status: 403 })

  const set = await (db as any).retrievalEvalSet.findUnique({
    where: { id: setId },
    include: {
      queries: {
        orderBy: { createdAt: 'asc' },
        include: { brand: { select: { id: true, name: true, slug: true } } },
      },
      runs: {
        orderBy: { startedAt: 'desc' },
        take: 10,
        select: {
          id: true, startedAt: true, completedAt: true, status: true,
          config: true, summary: true, rubricVersion: true,
        },
      },
    },
  })
  if (!set) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  return NextResponse.json({ set })
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { setId } = await params
  const access = await memberAccess(setId)
  if (!access) return NextResponse.json({ error: 'forbidden' }, { status: 403 })

  await (db as any).retrievalEvalSet.delete({ where: { id: setId } })
  return NextResponse.json({ ok: true })
}
