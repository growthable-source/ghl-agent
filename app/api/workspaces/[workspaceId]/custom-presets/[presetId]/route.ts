/**
 * DELETE one workspace custom preset. Idempotent — if the row doesn't
 * exist (already deleted) we still return 200. 404 only if the id matches
 * a row in a DIFFERENT workspace (cross-workspace leak guard).
 *
 * Auth: workspace member.
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'

type Params = { params: Promise<{ workspaceId: string; presetId: string }> }

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { workspaceId, presetId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  // Idempotent delete: scope to (id, workspaceId). deleteMany returns
  // a count rather than throwing on "no rows".
  await db.workspacePreset.deleteMany({
    where: { id: presetId, workspaceId },
  })

  return NextResponse.json({ ok: true })
}
