import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'

type Params = { params: Promise<{ workspaceId: string; agentId: string }> }

/**
 * Detection rules — "IF the contact says X, THEN update field Y to value Z."
 * Companion to qualifying questions (which ASK for info); these listen
 * passively. Evaluated by the agent on every inbound message.
 */

export async function GET(_req: NextRequest, { params }: Params) {
  const { workspaceId, agentId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access
  const rules = await (db as any).agentRule.findMany({
    where: { agentId },
    orderBy: { order: 'asc' },
  })
  return NextResponse.json({ rules })
}

const VALID_ACTIONS = new Set([
  'update_contact_field',
  'update_contact_tags', 'remove_contact_tags',
  'add_to_workflow', 'remove_from_workflow',
  'opportunity_status', 'opportunity_value',
  'dnd_channel',
])

export async function POST(req: NextRequest, { params }: Params) {
  const { workspaceId, agentId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access
  const body = await req.json()

  if (!body.name?.trim()) return NextResponse.json({ error: 'name required' }, { status: 400 })
  if (!body.conditionDescription?.trim()) return NextResponse.json({ error: 'conditionDescription required' }, { status: 400 })

  const actionType = typeof body.actionType === 'string' && VALID_ACTIONS.has(body.actionType)
    ? body.actionType
    : 'update_contact_field'

  // update_contact_field still requires its old-shape validation — the
  // other action types use actionParams instead, and the rules executor
  // gracefully no-ops if params are missing (UI enforces required params).
  if (actionType === 'update_contact_field') {
    if (!body.targetFieldKey?.trim()) return NextResponse.json({ error: 'targetFieldKey required' }, { status: 400 })
    if (body.targetValue === undefined || body.targetValue === null) return NextResponse.json({ error: 'targetValue required' }, { status: 400 })
  }

  const rule = await (db as any).agentRule.create({
    data: {
      agentId,
      name: body.name.trim(),
      conditionDescription: body.conditionDescription.trim(),
      examples: Array.isArray(body.examples) ? body.examples.filter((e: any) => typeof e === 'string' && e.trim()) : [],
      actionType,
      actionParams: body.actionParams ?? null,
      // Legacy columns — only populated for update_contact_field; empty
      // string for other actions so the NOT NULL constraint stays happy.
      targetFieldKey: actionType === 'update_contact_field' ? String(body.targetFieldKey).trim() : '',
      targetValue:    actionType === 'update_contact_field' ? String(body.targetValue)    : '',
      overwrite: body.overwrite ?? false,
      isActive: body.isActive ?? true,
      order: body.order ?? 0,
    },
  })
  return NextResponse.json({ rule }, { status: 201 })
}
