import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'
import { generateShareCode } from '@/lib/knowledge-sharing'

type Params = { params: Promise<{ workspaceId: string; collectionId: string }> }

/**
 * Share links for a knowledge collection.
 *
 * GET    — every share link ever minted for this collection, newest
 *          first, with where each one has been redeemed.
 * POST   — mint a new link. Body: { note?, maxUses?, expiresInDays? }
 * DELETE — revoke one. Body: { shareId }
 *
 * Redeeming happens elsewhere (/api/knowledge-shares/[code]) because
 * the redeemer is by definition outside this workspace.
 */

function migrationPending(err: any): boolean {
  return err?.code === 'P2021'
    || err?.code === 'P2022'
    || /relation .* does not exist/i.test(err?.message ?? '')
}

const MIGRATION_RESPONSE = NextResponse.json({
  error: 'Collection sharing migration pending — run prisma/sql/2026-07-22-knowledge-collection-sharing.sql.',
  code: 'MIGRATION_PENDING',
}, { status: 503 })

async function requireCollection(workspaceId: string, collectionId: string) {
  return db.knowledgeCollection.findFirst({
    where: { id: collectionId, workspaceId },
    select: { id: true, name: true },
  })
}

export async function GET(_req: NextRequest, { params }: Params) {
  const { workspaceId, collectionId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  const collection = await requireCollection(workspaceId, collectionId)
  if (!collection) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  try {
    const shares = await db.knowledgeCollectionShare.findMany({
      where: { collectionId },
      orderBy: { createdAt: 'desc' },
      include: {
        imports: {
          orderBy: { createdAt: 'desc' },
          select: { id: true, targetWorkspaceId: true, entryCount: true, createdAt: true },
        },
      },
    })

    // Resolve the destination workspace names in one hit so the sharer
    // sees "Acme Dental" instead of a cuid.
    const targetIds = [...new Set(shares.flatMap(s => s.imports.map(i => i.targetWorkspaceId)))]
    const targets = targetIds.length
      ? await db.workspace.findMany({ where: { id: { in: targetIds } }, select: { id: true, name: true } })
      : []
    const nameById = new Map(targets.map(w => [w.id, w.name]))

    return NextResponse.json({
      shares: shares.map(s => ({
        id: s.id,
        code: s.code,
        note: s.note,
        maxUses: s.maxUses,
        useCount: s.useCount,
        expiresAt: s.expiresAt?.toISOString() ?? null,
        revokedAt: s.revokedAt?.toISOString() ?? null,
        createdAt: s.createdAt.toISOString(),
        imports: s.imports.map(i => ({
          id: i.id,
          workspaceId: i.targetWorkspaceId,
          workspaceName: nameById.get(i.targetWorkspaceId) ?? 'Another workspace',
          entryCount: i.entryCount,
          createdAt: i.createdAt.toISOString(),
        })),
      })),
    })
  } catch (err: any) {
    if (migrationPending(err)) return NextResponse.json({ shares: [], notMigrated: true })
    throw err
  }
}

export async function POST(req: NextRequest, { params }: Params) {
  const { workspaceId, collectionId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  // Handing your knowledge to another account is an owner/admin call.
  if (!['owner', 'admin'].includes(access.role)) {
    return NextResponse.json({ error: 'Only workspace owners and admins can share collections.' }, { status: 403 })
  }

  const collection = await requireCollection(workspaceId, collectionId)
  if (!collection) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  let body: any = {}
  try { body = await req.json() } catch { body = {} }

  const note = typeof body.note === 'string' && body.note.trim() ? body.note.trim().slice(0, 200) : null

  let maxUses: number | null = null
  if (body.maxUses !== undefined && body.maxUses !== null && body.maxUses !== '') {
    const n = Number(body.maxUses)
    if (!Number.isFinite(n) || n < 1) {
      return NextResponse.json({ error: 'maxUses must be 1 or more' }, { status: 400 })
    }
    maxUses = Math.trunc(n)
  }

  let expiresAt: Date | null = null
  if (body.expiresInDays !== undefined && body.expiresInDays !== null && body.expiresInDays !== '') {
    const d = Number(body.expiresInDays)
    if (!Number.isFinite(d) || d < 1 || d > 365) {
      return NextResponse.json({ error: 'expiresInDays must be between 1 and 365' }, { status: 400 })
    }
    expiresAt = new Date(Date.now() + Math.trunc(d) * 24 * 60 * 60 * 1000)
  }

  // Codes are 12 chars from a 32-symbol alphabet; a collision is
  // vanishingly unlikely, but retry rather than 500 if one happens.
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const share = await db.knowledgeCollectionShare.create({
        data: {
          collectionId,
          workspaceId,
          code: generateShareCode(),
          createdByUserId: access.session.user!.id!,
          note,
          maxUses,
          expiresAt,
        },
      })
      return NextResponse.json({
        share: {
          id: share.id,
          code: share.code,
          note: share.note,
          maxUses: share.maxUses,
          useCount: share.useCount,
          expiresAt: share.expiresAt?.toISOString() ?? null,
          revokedAt: null,
          createdAt: share.createdAt.toISOString(),
          imports: [],
        },
      }, { status: 201 })
    } catch (err: any) {
      if (err?.code === 'P2002') continue
      if (migrationPending(err)) return MIGRATION_RESPONSE
      throw err
    }
  }
  return NextResponse.json({ error: 'Could not allocate a share code. Try again.' }, { status: 500 })
}

export async function DELETE(req: NextRequest, { params }: Params) {
  const { workspaceId, collectionId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access
  if (!['owner', 'admin'].includes(access.role)) {
    return NextResponse.json({ error: 'Only workspace owners and admins can revoke share links.' }, { status: 403 })
  }

  let body: any = {}
  try { body = await req.json() } catch { body = {} }
  const shareId = typeof body.shareId === 'string' ? body.shareId : ''
  if (!shareId) return NextResponse.json({ error: 'shareId required' }, { status: 400 })

  try {
    const existing = await db.knowledgeCollectionShare.findFirst({
      where: { id: shareId, collectionId, workspaceId },
      select: { id: true },
    })
    if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    await db.knowledgeCollectionShare.update({
      where: { id: shareId },
      data: { revokedAt: new Date() },
    })
    return NextResponse.json({ success: true })
  } catch (err: any) {
    if (migrationPending(err)) return MIGRATION_RESPONSE
    throw err
  }
}
