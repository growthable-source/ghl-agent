import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'
import { canCreateAgent } from '@/lib/plans'
import { isInternalWorkspace } from '@/lib/internal-workspace'
import { restoreAgent, type AgentSnapshot } from '@/lib/agent-clone'

type Params = { params: Promise<{ workspaceId: string; templateId: string }> }

/**
 * POST — install a template as a new agent in this workspace.
 *
 * Two code paths:
 *   - Legacy/official templates (config==null): create a bare agent from
 *     systemPrompt + suggestedTools, attach sampleQualifyingQuestions.
 *   - Workspace templates with a config snapshot: full restore via
 *     restoreAgent(), which copies every relation (persona, rules,
 *     knowledge, triggers, follow-ups, voice config, etc.).
 *
 * Workspace-scoped templates (workspaceId != null) are only installable
 * into their owning workspace — you can't leak a teammate's template
 * into another tenant even if you know the id.
 */
export async function POST(_req: NextRequest, { params }: Params) {
  const { workspaceId, templateId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  const template = await db.agentTemplate.findUnique({ where: { id: templateId } })
  if (!template) return NextResponse.json({ error: 'Template not found' }, { status: 404 })

  // Tenant guard: workspace-scoped templates only install into their
  // owning workspace. Official templates (workspaceId=null) install
  // anywhere.
  if (template.workspaceId && template.workspaceId !== workspaceId) {
    return NextResponse.json({ error: 'Template not found' }, { status: 404 })
  }

  // Check agent limit using the owner's effective plan (account-level).
  // Internal workspaces (any @voxility.ai member) bypass the gate entirely.
  const internal = await isInternalWorkspace(workspaceId)
  if (!internal) {
    try {
      const { getEffectivePlan } = await import('@/lib/effective-plan')
      const effective = await getEffectivePlan(workspaceId)
      const count = await db.agent.count({ where: { workspaceId } })
      if (!canCreateAgent(effective.plan, count, effective.extraAgentCount ?? 0)) {
        return NextResponse.json({ error: 'Agent limit reached', code: 'AGENT_LIMIT' }, { status: 403 })
      }
    } catch {}
  }

  const location = await db.location.findFirst({ where: { workspaceId }, select: { id: true } })

  // Rich-config path: workspace templates saved via /save-as-template
  // carry the full AgentSnapshot. Restore copies every relation. The
  // resulting agent is PAUSED so operators re-review before go-live.
  if (template.config && typeof template.config === 'object') {
    const snapshot = template.config as unknown as AgentSnapshot
    const newId = await restoreAgent({
      snapshot,
      workspaceId,
      locationId: location?.id ?? workspaceId,
      name: template.name,
    })
    await db.agentTemplate.update({ where: { id: templateId }, data: { installCount: { increment: 1 } } })
    const agent = await db.agent.findUnique({ where: { id: newId } })
    return NextResponse.json({ agent })
  }

  // Legacy / official path — minimal agent from the flat template fields.
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
