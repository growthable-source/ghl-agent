import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'
import { isMissingColumn, migrationPendingResponse } from '@/lib/migration-error'

type Params = { params: Promise<{ workspaceId: string; agentId: string; experimentId: string }> }

/**
 * PATCH /experiments/:id
 * Body keys we accept:
 *   - status:  'approved' | 'running' | 'ended' | 'rejected'
 *              (running sets startedAt; ended sets endedAt)
 *   - hypothesis, variantBPrompt, variantAPrompt, metric, splitPercent
 *   - promote: true  → applies winning variant's prompt to the agent's
 *              instructions field and ends the experiment. Provide
 *              `winner: 'A' | 'B'` to disambiguate.
 */
export async function PATCH(req: NextRequest, { params }: Params) {
  const { workspaceId, agentId, experimentId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  const agent = await db.agent.findFirst({ where: { id: agentId, workspaceId }, select: { id: true, instructions: true } })
  if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 })

  let exp: any
  try {
    exp = await (db as any).agentExperiment.findFirst({ where: { id: experimentId, agentId } })
  } catch (err: any) {
    if (isMissingColumn(err)) return migrationPendingResponse('Experiments', 'manual_agent_experiments.sql')
    throw err
  }
  if (!exp) return NextResponse.json({ error: 'Experiment not found' }, { status: 404 })

  let body: any = {}
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }

  // Promote-and-end shortcut.
  if (body.promote === true) {
    const winner = body.winner === 'A' ? 'A' : 'B'
    const winningPrompt = winner === 'A' ? exp.variantAPrompt : exp.variantBPrompt
    try {
      if (winningPrompt) {
        const newInstructions = [agent.instructions, winningPrompt].filter(Boolean).join('\n\n')
        await db.agent.update({ where: { id: agentId }, data: { instructions: newInstructions } })
      }
      await (db as any).agentExperiment.update({
        where: { id: experimentId },
        data: { status: 'ended', endedAt: new Date() },
      })
      return NextResponse.json({ ok: true, promoted: winner })
    } catch (err: any) {
      if (isMissingColumn(err)) return migrationPendingResponse('Experiments', 'manual_agent_experiments.sql')
      return NextResponse.json({ error: err.message || 'Promote failed' }, { status: 500 })
    }
  }

  const data: Record<string, unknown> = {}
  for (const k of ['hypothesis', 'variantALabel', 'variantBLabel', 'variantAPrompt', 'variantBPrompt', 'metric', 'splitPercent']) {
    if (body[k] !== undefined) data[k] = body[k]
  }
  if (typeof body.status === 'string') {
    const s = body.status
    if (!['draft', 'approved', 'running', 'ended', 'rejected'].includes(s)) {
      return NextResponse.json({ error: `Invalid status: ${s}` }, { status: 400 })
    }
    data.status = s
    if (s === 'running' && !exp.startedAt) data.startedAt = new Date()
    if (s === 'ended' && !exp.endedAt) data.endedAt = new Date()
    if (s === 'approved' && !exp.approvedAt) data.approvedAt = new Date()
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: 'No valid fields' }, { status: 400 })
  }

  try {
    const updated = await (db as any).agentExperiment.update({ where: { id: experimentId }, data })
    return NextResponse.json({ experiment: updated })
  } catch (err: any) {
    if (isMissingColumn(err)) return migrationPendingResponse('Experiments', 'manual_agent_experiments.sql')
    return NextResponse.json({ error: err.message || 'Failed to update experiment' }, { status: 500 })
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { workspaceId, agentId, experimentId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  const agent = await db.agent.findFirst({ where: { id: agentId, workspaceId }, select: { id: true } })
  if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 })

  try {
    await (db as any).agentExperiment.delete({ where: { id: experimentId } })
    return NextResponse.json({ ok: true })
  } catch (err: any) {
    if (isMissingColumn(err)) return migrationPendingResponse('Experiments', 'manual_agent_experiments.sql')
    return NextResponse.json({ error: err.message || 'Failed to delete experiment' }, { status: 500 })
  }
}
