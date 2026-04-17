import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'
import { canCreateAgent } from '@/lib/plans'

type Params = { params: Promise<{ workspaceId: string; templateId: string }> }

/**
 * POST — install a template as a new agent in this workspace.
 */
export async function POST(_req: NextRequest, { params }: Params) {
  const { workspaceId, templateId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  const template = await db.agentTemplate.findUnique({ where: { id: templateId } })
  if (!template) return NextResponse.json({ error: 'Template not found' }, { status: 404 })

  // Check agent limit (graceful fallback for pre-migration)
  try {
    const workspace = await db.workspace.findUnique({
      where: { id: workspaceId },
      select: { plan: true, extraAgentCount: true },
    })
    if (workspace) {
      const count = await db.agent.count({ where: { workspaceId } })
      if (!canCreateAgent(workspace.plan, count, workspace.extraAgentCount ?? 0)) {
        return NextResponse.json({ error: 'Agent limit reached', code: 'AGENT_LIMIT' }, { status: 403 })
      }
    }
  } catch {}

  const location = await db.location.findFirst({ where: { workspaceId }, select: { id: true } })

  const agent = await db.agent.create({
    data: {
      workspaceId,
      locationId: location?.id ?? workspaceId,
      name: template.name,
      systemPrompt: template.systemPrompt,
      enabledTools: template.suggestedTools,
    },
  })

  // Attach sample qualifying questions if present
  if (template.sampleQualifyingQuestions && Array.isArray(template.sampleQualifyingQuestions)) {
    try {
      for (const [i, q] of (template.sampleQualifyingQuestions as any[]).entries()) {
        await db.qualifyingQuestion.create({
          data: {
            agentId: agent.id,
            question: q.question,
            fieldKey: q.fieldKey,
            order: i,
            required: q.required !== false,
          },
        })
      }
    } catch {}
  }

  // Bump template install count
  await db.agentTemplate.update({
    where: { id: templateId },
    data: { installCount: { increment: 1 } },
  })

  return NextResponse.json({ agent })
}
