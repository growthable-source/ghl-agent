import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'

type Params = { params: Promise<{ workspaceId: string }> }

/**
 * POST /api/workspaces/:workspaceId/agents/wizard/create
 *
 * Takes a proposal produced by the wizard chat (see ../route.ts) and
 * actually creates the Agent row plus any detection rules / qualifying
 * questions the proposal includes. Returns { agentId } so the client can
 * redirect to the new agent's settings tab.
 */
export async function POST(req: NextRequest, { params }: Params) {
  const { workspaceId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  let body: any = {}
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }
  const p = body.proposal
  if (!p || !p.name || !p.systemPrompt) {
    return NextResponse.json({ error: 'proposal with name and systemPrompt required' }, { status: 400 })
  }

  // Reuse the agent-create location-resolution logic — find or create a
  // location FK target.
  let location = await db.location.findFirst({
    where: { workspaceId },
    select: { id: true },
    orderBy: { installedAt: 'desc' },
  })
  if (!location) {
    const placeholderId = `placeholder:${workspaceId}`
    location = await db.location.upsert({
      where: { id: placeholderId },
      create: {
        id: placeholderId,
        workspaceId,
        companyId: '', userId: '', userType: '', scope: '',
        accessToken: '', refreshToken: '', refreshTokenId: '',
        expiresAt: new Date(0),
        crmProvider: 'none',
      },
      update: {},
      select: { id: true },
    })
  }

  try {
    const agent = await db.agent.create({
      data: {
        workspaceId,
        locationId: location.id,
        name: p.name,
        systemPrompt: p.systemPrompt,
        instructions: p.instructions || null,
        enabledTools: Array.isArray(p.enabledTools) ? p.enabledTools : [],
        agentType: 'SIMPLE',
        formalityLevel: toneToFormality(p.personaTone),
      },
    })

    // Detection rules
    if (Array.isArray(p.detectionRules)) {
      for (let i = 0; i < p.detectionRules.length; i++) {
        const r = p.detectionRules[i]
        if (!r?.name || !r?.description || !r?.actionType) continue
        const params: Record<string, string> =
          r.actionType === 'add_tag' ? { tag: r.actionValue }
          : r.actionType === 'add_note' ? { note: r.actionValue }
          : r.actionType === 'add_to_workflow' ? { workflowName: r.actionValue }
          : {}
        await db.agentRule.create({
          data: {
            agentId: agent.id,
            name: r.name.slice(0, 80),
            conditionDescription: r.description,
            actionType: r.actionType,
            actionParams: params,
            targetFieldKey: '',
            targetValue: '',
            order: i,
          },
        }).catch(() => { /* skip individual failures so a bad rule doesn't kill creation */ })
      }
    }

    // Qualifying questions
    if (Array.isArray(p.qualifyingQuestions)) {
      for (let i = 0; i < p.qualifyingQuestions.length; i++) {
        const q = p.qualifyingQuestions[i]
        if (!q?.question || !q?.captureField) continue
        await db.qualifyingQuestion.create({
          data: {
            agentId: agent.id,
            question: q.question,
            fieldKey: String(q.captureField).toLowerCase().replace(/\s+/g, '_').slice(0, 80),
            order: i,
          },
        }).catch(() => {})
      }
    }

    return NextResponse.json({ agentId: agent.id }, { status: 201 })
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Failed to create agent' }, { status: 500 })
  }
}

function toneToFormality(tone?: string): 'CASUAL' | 'NEUTRAL' | 'FORMAL' {
  switch (tone) {
    case 'formal': return 'FORMAL'
    case 'professional': return 'FORMAL'
    case 'casual':
    case 'energetic':
    case 'friendly':
      return 'CASUAL'
    default: return 'NEUTRAL'
  }
}
