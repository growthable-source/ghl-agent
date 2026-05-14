import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { auth } from '@/lib/auth'
import { DOMAIN_TEMPLATES } from '@/lib/ingest/templates'

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
  const { workspaceId, name, description, templateId } = body
  if (!workspaceId || !name) return NextResponse.json({ error: 'workspaceId + name required' }, { status: 400 })
  const access = await getAccess(req, workspaceId)
  if (!access) return NextResponse.json({ error: 'forbidden' }, { status: 403 })

  // Resolve the template (defaults to "custom" = empty seeds). The
  // UI funnels users through a template picker — this is the seed
  // mechanism that makes new domains useful out of the gate.
  const template = DOMAIN_TEMPLATES.find(t => t.id === templateId)
    ?? DOMAIN_TEMPLATES.find(t => t.id === 'custom')!

  try {
    const domain = await (db as any).knowledgeDomain.create({
      data: {
        workspaceId,
        name: String(name).trim().slice(0, 120),
        description: typeof description === 'string' && description.trim()
          ? description.trim()
          : template.description,
        defaultIntentTags: template.intentTags,
      },
    })

    // Seed taxonomy rows from the template — best-effort, so a single
    // failure doesn't lose the whole domain. Each row carries the
    // current taxonomyVersion=1 baseline.
    if (template.taxonomy.length > 0) {
      try {
        await (db as any).taxonomy.createMany({
          data: template.taxonomy.map(t => ({
            knowledgeDomainId: domain.id,
            key: t.key,
            label: t.label,
            aliases: t.aliases ?? [],
            parentKey: t.parentKey ?? null,
            taxonomyVersion: 1,
          })),
          skipDuplicates: true,
        })
      } catch (err: any) {
        console.warn('[domain-create] taxonomy seed failed:', err?.message)
      }
    }

    return NextResponse.json({ domain, templateApplied: template.id })
  } catch (err: any) {
    if (err?.code === 'P2002') {
      return NextResponse.json({ error: 'A domain with that name already exists.' }, { status: 409 })
    }
    if (err?.code === 'P2021' || /relation .* does not exist/i.test(err?.message ?? '')) {
      return NextResponse.json({ error: 'The knowledge layer isn\'t set up on this database yet. Contact support if this persists.' }, { status: 503 })
    }
    throw err
  }
}
