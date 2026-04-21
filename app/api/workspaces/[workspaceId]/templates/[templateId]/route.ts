import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'

type Params = { params: Promise<{ workspaceId: string; templateId: string }> }

/**
 * DELETE /api/workspaces/:ws/templates/:templateId
 *
 * Removes a workspace-scoped template. Official templates (workspaceId=null)
 * cannot be deleted through this endpoint — returns 403.
 */
export async function DELETE(_req: NextRequest, { params }: Params) {
  const { workspaceId, templateId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  const template = await db.agentTemplate.findUnique({ where: { id: templateId } })
  if (!template) return NextResponse.json({ error: 'Template not found' }, { status: 404 })

  // Tenant + ownership check: only delete workspace's own templates.
  if (!template.workspaceId || template.workspaceId !== workspaceId) {
    return NextResponse.json({ error: 'Cannot delete this template' }, { status: 403 })
  }

  await db.agentTemplate.delete({ where: { id: templateId } })
  return NextResponse.json({ ok: true })
}
