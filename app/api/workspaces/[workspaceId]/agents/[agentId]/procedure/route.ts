import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'

type Params = { params: Promise<{ workspaceId: string; agentId: string }> }

/**
 * Procedure steps for a procedural agent.
 *
 * GET  → { steps } ordered by `order`.
 * PUT  → replace-all. Body: { steps: [{ title, instruction, question?,
 *        collectFieldKey?, rules? }] }. Re-numbers `order` by array index.
 *
 * Replace-all keeps the client simple (it owns the ordered array and the
 * drag-reorder) and the server stateless. Wrapped so a pre-migration deploy
 * (missing table) degrades to an empty list rather than 500-ing.
 */

async function assertAgentInWorkspace(agentId: string, workspaceId: string): Promise<boolean> {
  const agent = await db.agent.findFirst({ where: { id: agentId, workspaceId }, select: { id: true } })
  return !!agent
}

export async function GET(_req: NextRequest, { params }: Params) {
  const { workspaceId, agentId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  try {
    if (!(await assertAgentInWorkspace(agentId, workspaceId))) {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 })
    }
    const steps = await db.procedureStep.findMany({
      where: { agentId },
      orderBy: { order: 'asc' },
    })
    return NextResponse.json({ steps })
  } catch (err: any) {
    if (err?.code === 'P2021' || err?.code === 'P2022' || /does not exist/i.test(err?.message ?? '')) {
      return NextResponse.json({ steps: [], migrationPending: true })
    }
    throw err
  }
}

interface IncomingStep {
  title?: unknown
  instruction?: unknown
  question?: unknown
  collectFieldKey?: unknown
  rules?: unknown
}

export async function PUT(req: NextRequest, { params }: Params) {
  const { workspaceId, agentId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  let body: any = {}
  try { body = await req.json() } catch {}
  const incoming: IncomingStep[] = Array.isArray(body?.steps) ? body.steps : []

  // Normalize: title + instruction are required per step; the rest optional.
  const clean = incoming
    .map((s, i) => ({
      order: i,
      title: typeof s.title === 'string' ? s.title.trim() : '',
      instruction: typeof s.instruction === 'string' ? s.instruction.trim() : '',
      question: typeof s.question === 'string' && s.question.trim() ? s.question.trim() : null,
      collectFieldKey: typeof s.collectFieldKey === 'string' && s.collectFieldKey.trim() ? s.collectFieldKey.trim() : null,
      rules: Array.isArray(s.rules) ? s.rules : [],
    }))
    .filter(s => s.title && s.instruction)

  try {
    if (!(await assertAgentInWorkspace(agentId, workspaceId))) {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 })
    }
    await db.$transaction(async (tx) => {
      await tx.procedureStep.deleteMany({ where: { agentId } })
      if (clean.length) {
        await tx.procedureStep.createMany({
          data: clean.map(s => ({ agentId, ...s })),
        })
      }
    })
    const steps = await db.procedureStep.findMany({ where: { agentId }, orderBy: { order: 'asc' } })
    return NextResponse.json({ ok: true, steps })
  } catch (err: any) {
    if (err?.code === 'P2021' || err?.code === 'P2022' || /does not exist/i.test(err?.message ?? '')) {
      return NextResponse.json({ error: 'Migration pending — run prisma/migrations/20260618160000_procedural_agents/migration.sql' }, { status: 503 })
    }
    throw err
  }
}
