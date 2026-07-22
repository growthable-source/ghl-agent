import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import {
  copyCollectionToWorkspace,
  normalizeShareCode,
  shareErrorMessage,
  shareRedemptionError,
} from '@/lib/knowledge-sharing'

type Params = { params: Promise<{ code: string }> }

/**
 * Redeem a share code into one of the caller's workspaces.
 * Body: { targetWorkspaceId, name? }
 */
export async function POST(req: NextRequest, { params }: Params) {
  const { code: rawCode } = await params
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const code = normalizeShareCode(decodeURIComponent(rawCode))
  if (!code) return NextResponse.json({ error: 'That share code is not valid.' }, { status: 404 })

  let body: any = {}
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }
  const targetWorkspaceId = typeof body.targetWorkspaceId === 'string' ? body.targetWorkspaceId : ''
  if (!targetWorkspaceId) return NextResponse.json({ error: 'targetWorkspaceId required' }, { status: 400 })

  const member = await db.workspaceMember.findUnique({
    where: { userId_workspaceId: { userId: session.user.id, workspaceId: targetWorkspaceId } },
    select: { role: true },
  })
  if (!member) return NextResponse.json({ error: 'You are not a member of that workspace.' }, { status: 403 })
  if (member.role === 'viewer') {
    return NextResponse.json({ error: 'You only have view access to that workspace.' }, { status: 403 })
  }

  let share: any
  try {
    share = await db.knowledgeCollectionShare.findUnique({ where: { code } })
  } catch (err: any) {
    if (err?.code === 'P2021' || /relation .* does not exist/i.test(err?.message ?? '')) {
      return NextResponse.json({
        error: 'Collection sharing migration pending — run prisma/sql/2026-07-22-knowledge-collection-sharing.sql.',
        code: 'MIGRATION_PENDING',
      }, { status: 503 })
    }
    throw err
  }
  if (!share) return NextResponse.json({ error: 'That share link is not valid.' }, { status: 404 })

  const problem = shareRedemptionError(share)
  if (problem) {
    return NextResponse.json({ error: shareErrorMessage(problem), code: problem }, { status: 410 })
  }

  // Claim a use slot BEFORE copying so two concurrent redemptions of a
  // single-use link can't both win. The conditional update is the lock:
  // it only matches while useCount is still what we read.
  if (share.maxUses !== null) {
    const claimed = await db.knowledgeCollectionShare.updateMany({
      where: { id: share.id, useCount: share.useCount, revokedAt: null },
      data: { useCount: { increment: 1 } },
    })
    if (claimed.count === 0) {
      return NextResponse.json({
        error: shareErrorMessage('EXHAUSTED'),
        code: 'EXHAUSTED',
      }, { status: 410 })
    }
  } else {
    await db.knowledgeCollectionShare.update({
      where: { id: share.id },
      data: { useCount: { increment: 1 } },
    })
  }

  const result = await copyCollectionToWorkspace({
    sourceCollectionId: share.collectionId,
    targetWorkspaceId,
    nameOverride: typeof body.name === 'string' ? body.name : null,
  })

  if ('error' in result) {
    // Hand the use slot back — nothing was created.
    await db.knowledgeCollectionShare.update({
      where: { id: share.id },
      data: { useCount: { decrement: 1 } },
    }).catch(() => {})
    return NextResponse.json({ error: result.error }, { status: 400 })
  }

  await db.knowledgeCollectionShareImport.create({
    data: {
      shareId: share.id,
      targetWorkspaceId,
      createdCollectionId: result.collectionId,
      importedByUserId: session.user.id,
      entryCount: result.entryCount,
    },
  }).catch(() => {}) // the audit row is nice-to-have, never block the import

  return NextResponse.json({ imported: result, workspaceId: targetWorkspaceId }, { status: 201 })
}
