import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { auth } from '@/lib/auth'

/**
 * Admin endpoints for KnowledgeDomain CRUD. Scoped per workspace via
 * `?workspaceId=...`. Auth: any signed-in member of the workspace —
 * Phase 2 admin gating is a follow-up (per the brief's deferrals).
 */
async function getAccess(req: NextRequest, workspaceId: string) {
  const session = await auth()
  if (!session?.user?.id) return null
  const member = await db.workspaceMember.findUnique({
    where: { userId_workspaceId: { userId: session.user.id, workspaceId } },
    select: { role: true },
  })
  return member ? { session, role: member.role } : null
}

export async function GET(req: NextRequest) {
  const workspaceId = req.nextUrl.searchParams.get('workspaceId')
  if (!workspaceId) return NextResponse.json({ error: 'workspaceId required' }, { status: 400 })
  const access = await getAccess(req, workspaceId)
  if (!access) return NextResponse.json({ error: 'forbidden' }, { status: 403 })

  try {
    const domains = await (db as any).knowledgeDomain.findMany({
      where: { workspaceId },
      orderBy: { name: 'asc' },
      include: {
        _count: { select: { taxonomies: true, sources: true, chunks: true } },
      },
    })
    return NextResponse.json({
      domains: domains.map((d: any) => ({
        id: d.id,
        name: d.name,
        description: d.description,
        defaultIntentTags: d.defaultIntentTags,
        createdAt: d.createdAt.toISOString(),
        taxonomyCount: d._count.taxonomies,
        sourceCount: d._count.sources,
        chunkCount: d._count.chunks,
      })),
    })
  } catch (err: any) {
    if (err?.code === 'P2021' || /relation .* does not exist/i.test(err?.message ?? '')) {
      return NextResponse.json({ domains: [], notMigrated: true })
    }
    throw err
  }
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const { workspaceId, name, description, defaultIntentTags } = body
  if (!workspaceId || !name) return NextResponse.json({ error: 'workspaceId + name required' }, { status: 400 })
  const access = await getAccess(req, workspaceId)
  if (!access) return NextResponse.json({ error: 'forbidden' }, { status: 403 })

  try {
    const domain = await (db as any).knowledgeDomain.create({
      data: {
        workspaceId,
        name: String(name).trim().slice(0, 120),
        description: typeof description === 'string' ? description.trim() : null,
        defaultIntentTags: Array.isArray(defaultIntentTags)
          ? defaultIntentTags.filter((t: unknown) => typeof t === 'string').slice(0, 20)
          : [],
      },
    })
    return NextResponse.json({ domain })
  } catch (err: any) {
    if (err?.code === 'P2002') {
      return NextResponse.json({ error: 'A domain with that name already exists.' }, { status: 409 })
    }
    if (err?.code === 'P2021' || /relation .* does not exist/i.test(err?.message ?? '')) {
      return NextResponse.json({ error: 'Migration pending — run manual_phase2_knowledge_pipeline.sql' }, { status: 503 })
    }
    throw err
  }
}
