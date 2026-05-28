/**
 * Workspace-defined ("custom") agent presets — CRUD list + create.
 *
 * GET returns every WorkspacePreset row for this workspace, parsed into
 * the same shape the AgentToolRulesEditor consumes for the hardcoded
 * registry (id/name/description/autonomyMode/tools).
 *
 * POST captures a snapshot of the caller-supplied autonomy mode + tool
 * deltas as a new WorkspacePreset row. Validates that:
 *   - name is 1..80 chars (description optional, max 280)
 *   - autonomyMode is in the enum
 *   - every delta.toolName exists in AGENT_TOOLS (no rogue tools)
 *   - every delta.onFailure is in the 4-value enum (when set)
 *
 * Apply happens via the existing apply-preset endpoint (extended with
 * applyPresetWithWorkspaceLookup) — this endpoint is just storage.
 *
 * Auth: workspace member (any role).
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'
import { AGENT_TOOLS } from '@/lib/agent/tool-catalog'
import type { PresetToolDelta } from '@/lib/agent/presets'

type Params = { params: Promise<{ workspaceId: string }> }

const VALID_ON_FAILURE = new Set(['default', 'transfer_to_human', 'canned_message', 'silent_skip'])
const VALID_AUTONOMY = new Set(['guided', 'autonomous'])

const NAME_MAX = 80
const DESCRIPTION_MAX = 280

export async function GET(_req: NextRequest, { params }: Params) {
  const { workspaceId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  const rows = await db.workspacePreset.findMany({
    where: { workspaceId },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      name: true,
      description: true,
      autonomyMode: true,
      toolDeltas: true,
      createdById: true,
      createdAt: true,
    },
  })

  return NextResponse.json({
    presets: rows.map(r => ({
      id: r.id,
      name: r.name,
      description: r.description,
      autonomyMode: (r.autonomyMode === 'autonomous' ? 'autonomous' : 'guided') as 'guided' | 'autonomous',
      tools: Array.isArray(r.toolDeltas) ? (r.toolDeltas as unknown as PresetToolDelta[]) : [],
      createdAt: r.createdAt.toISOString(),
      createdById: r.createdById,
    })),
  })
}

interface CreateBody {
  name?: unknown
  description?: unknown
  autonomyMode?: unknown
  tools?: unknown
}

export async function POST(req: NextRequest, { params }: Params) {
  const { workspaceId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  const body = (await req.json().catch(() => ({}))) as CreateBody

  // Name
  if (typeof body.name !== 'string') {
    return NextResponse.json({ error: 'missing_name' }, { status: 400 })
  }
  const name = body.name.trim()
  if (name.length === 0 || name.length > NAME_MAX) {
    return NextResponse.json({ error: 'invalid_name' }, { status: 400 })
  }

  // Description (optional)
  let description: string | null = null
  if (typeof body.description === 'string') {
    const trimmed = body.description.trim()
    if (trimmed.length > DESCRIPTION_MAX) {
      return NextResponse.json({ error: 'invalid_description' }, { status: 400 })
    }
    description = trimmed.length === 0 ? null : trimmed
  }

  // Autonomy mode
  const autonomyMode = typeof body.autonomyMode === 'string' && VALID_AUTONOMY.has(body.autonomyMode)
    ? body.autonomyMode
    : 'guided'

  // Tool deltas — validate each against AGENT_TOOLS + onFailure enum.
  const knownTools = new Set(AGENT_TOOLS.map(t => t.name))
  const tools: PresetToolDelta[] = []
  if (Array.isArray(body.tools)) {
    for (const raw of body.tools) {
      if (!raw || typeof raw !== 'object') continue
      const delta = raw as Record<string, unknown>
      if (typeof delta.toolName !== 'string' || !knownTools.has(delta.toolName)) {
        return NextResponse.json({ error: 'unknown_tool', toolName: delta.toolName }, { status: 400 })
      }
      const out: PresetToolDelta = { toolName: delta.toolName }
      if (typeof delta.enabled === 'boolean') out.enabled = delta.enabled
      if (typeof delta.useWhen === 'string' && delta.useWhen.length > 0) out.useWhen = delta.useWhen
      if (typeof delta.onFailure === 'string') {
        if (!VALID_ON_FAILURE.has(delta.onFailure)) {
          return NextResponse.json({ error: 'invalid_onFailure', value: delta.onFailure }, { status: 400 })
        }
        out.onFailure = delta.onFailure as PresetToolDelta['onFailure']
      }
      if (typeof delta.onFailureMessage === 'string') out.onFailureMessage = delta.onFailureMessage
      tools.push(out)
    }
  }

  const created = await db.workspacePreset.create({
    data: {
      workspaceId,
      name,
      description,
      autonomyMode,
      toolDeltas: tools as unknown as object,
      createdById: access.session.user?.id ?? null,
    },
    select: {
      id: true,
      name: true,
      description: true,
      autonomyMode: true,
      toolDeltas: true,
      createdById: true,
      createdAt: true,
    },
  })

  return NextResponse.json({
    preset: {
      id: created.id,
      name: created.name,
      description: created.description,
      autonomyMode: (created.autonomyMode === 'autonomous' ? 'autonomous' : 'guided') as 'guided' | 'autonomous',
      tools: Array.isArray(created.toolDeltas) ? (created.toolDeltas as unknown as PresetToolDelta[]) : [],
      createdAt: created.createdAt.toISOString(),
      createdById: created.createdById,
    },
  })
}
