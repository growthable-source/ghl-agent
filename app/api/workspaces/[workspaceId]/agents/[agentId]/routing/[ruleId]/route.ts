import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'

// All three IDs from the URL — workspaceId is membership-gated, agentId
// and ruleId pin the write to the correct tenant lineage so cross-
// tenant writes (rule belongs to a different workspace's agent) can't
// slip through just because the caller is a member of SOME workspace.
type Params = { params: Promise<{ workspaceId: string; agentId: string; ruleId: string }> }

/**
 * Verifies the rule referenced by `ruleId` belongs to `agentId` AND that
 * `agentId` belongs to `workspaceId`. Returns the rule on success, a
 * 404 Response on any tenant mismatch (404 not 403 — we don't want to
 * confirm the rule's existence to a caller who has no business knowing).
 */
async function loadRuleInTenant(workspaceId: string, agentId: string, ruleId: string) {
  const rule = await db.routingRule.findUnique({
    where: { id: ruleId },
    select: {
      id: true,
      agentId: true,
      agent: { select: { workspaceId: true } },
    },
  })
  if (!rule || rule.agentId !== agentId || rule.agent.workspaceId !== workspaceId) {
    return null
  }
  return rule
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const { workspaceId, agentId, ruleId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  const owned = await loadRuleInTenant(workspaceId, agentId, ruleId)
  if (!owned) return NextResponse.json({ error: 'Rule not found' }, { status: 404 })

  let body: any
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  // If the caller sends `conditions`, we write the compound shape and clear
  // the legacy `value`. The required `ruleType` column is kept in sync with
  // the first resolvable clause so DB queries that still read ruleType (for
  // display, sorting, etc.) stay sensible. Accepts both the AND-only shape
  // ({ clauses }) and the AND/OR shape ({ groups: [{ clauses }] }).
  const conditions = body.conditions as
    | {
        groups?: Array<{ clauses: Array<{ ruleType: string; values?: string[]; negate?: boolean }> }>
        clauses?: Array<{ ruleType: string; values?: string[]; negate?: boolean }>
      }
    | null
    | undefined

  const data: any = {
    ...(body.priority !== undefined && { priority: body.priority }),
    // Per-channel scope. Empty array (or missing) keeps the rule
    // global; non-empty restricts to the listed channels. Mirrors the
    // POST endpoint contract.
    ...(Array.isArray(body.channels) && {
      channels: (body.channels as unknown[]).filter((c): c is string => typeof c === 'string'),
    }),
  }

  if (conditions !== undefined) {
    data.conditions = conditions
    const firstClause =
      conditions?.groups?.[0]?.clauses?.[0] ??
      conditions?.clauses?.[0]
    if (firstClause?.ruleType) {
      data.ruleType = firstClause.ruleType
    }
    data.value = null
  } else {
    if (body.ruleType !== undefined) data.ruleType = body.ruleType
    if (body.value !== undefined) data.value = body.value
  }

  try {
    const rule = await db.routingRule.update({
      where: { id: ruleId },
      data,
    })
    return NextResponse.json({ rule })
  } catch (err: any) {
    console.error('[routing] PATCH failed', { workspaceId, agentId, ruleId, err: err?.message })
    return NextResponse.json({ error: err?.message ?? 'Failed to update rule' }, { status: 500 })
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { workspaceId, agentId, ruleId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  const owned = await loadRuleInTenant(workspaceId, agentId, ruleId)
  if (!owned) return NextResponse.json({ error: 'Rule not found' }, { status: 404 })

  try {
    await db.routingRule.delete({ where: { id: ruleId } })
    return NextResponse.json({ success: true })
  } catch (err: any) {
    console.error('[routing] DELETE failed', { workspaceId, agentId, ruleId, err: err?.message })
    return NextResponse.json({ error: err?.message ?? 'Failed to delete rule' }, { status: 500 })
  }
}
