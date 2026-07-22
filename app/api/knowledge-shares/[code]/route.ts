import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import {
  normalizeShareCode,
  shareErrorMessage,
  shareRedemptionError,
} from '@/lib/knowledge-sharing'

type Params = { params: Promise<{ code: string }> }

/**
 * Preview a shared knowledge collection before importing it.
 *
 * Deliberately NOT public: you must be signed in. The response says
 * what you'd be getting (name, description, item count, a few sample
 * titles) and lists the workspaces you could import it into — it never
 * returns the full entry bodies, so a leaked code alone doesn't leak
 * the knowledge without a deliberate import.
 */
export async function GET(_req: NextRequest, { params }: Params) {
  const { code: rawCode } = await params
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const code = normalizeShareCode(decodeURIComponent(rawCode))
  if (!code) return NextResponse.json({ error: 'That share code is not valid.' }, { status: 404 })

  let share: any
  try {
    share = await db.knowledgeCollectionShare.findUnique({
      where: { code },
      include: {
        collection: {
          include: {
            entries: { select: { id: true, title: true, tokenEstimate: true }, orderBy: { createdAt: 'asc' } },
            _count: { select: { dataSources: true } },
            workspace: { select: { id: true, name: true } },
          },
        },
      },
    })
  } catch (err: any) {
    if (err?.code === 'P2021' || /relation .* does not exist/i.test(err?.message ?? '')) {
      return NextResponse.json({
        error: 'Collection sharing migration pending — run prisma/sql/2026-07-22-knowledge-collection-sharing.sql.',
        code: 'MIGRATION_PENDING',
      }, { status: 503 })
    }
    throw err
  }

  if (!share || !share.collection) {
    return NextResponse.json({ error: 'That share link is not valid.' }, { status: 404 })
  }

  const problem = shareRedemptionError(share)
  if (problem) {
    return NextResponse.json({ error: shareErrorMessage(problem), code: problem }, { status: 410 })
  }

  const memberships = await db.workspaceMember.findMany({
    where: { userId: session.user.id },
    select: { role: true, workspace: { select: { id: true, name: true, icon: true } } },
    orderBy: { createdAt: 'desc' },
  })

  const c = share.collection
  return NextResponse.json({
    share: {
      code: share.code,
      note: share.note,
      expiresAt: share.expiresAt?.toISOString() ?? null,
      usesRemaining: share.maxUses === null ? null : Math.max(0, share.maxUses - share.useCount),
    },
    collection: {
      name: c.name,
      description: c.description,
      icon: c.icon,
      color: c.color,
      entryCount: c.entries.length,
      tokenEstimate: c.entries.reduce((s: number, e: any) => s + (e.tokenEstimate || 0), 0),
      sampleTitles: c.entries.slice(0, 8).map((e: any) => e.title),
      skippedDataSourceCount: c._count.dataSources,
      sharedByWorkspaceName: c.workspace?.name ?? 'Another workspace',
    },
    workspaces: memberships
      .filter(m => m.role !== 'viewer')
      .map(m => ({ id: m.workspace.id, name: m.workspace.name, icon: m.workspace.icon, role: m.role })),
  })
}
