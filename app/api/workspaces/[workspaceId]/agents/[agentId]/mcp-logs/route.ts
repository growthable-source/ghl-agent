import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'

type Params = { params: Promise<{ workspaceId: string; agentId: string }> }

/**
 * GET /api/workspaces/:workspaceId/agents/:agentId/mcp-logs
 *
 * Returns the most recent MessageLog rows for this agent that include at
 * least one MCP tool call (anything in actionsPerformed starting with
 * "mcp:"). Used by the Integrations → Logs sub-tab.
 */
export async function GET(_req: NextRequest, { params }: Params) {
  const { workspaceId, agentId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  const agent = await db.agent.findFirst({ where: { id: agentId, workspaceId }, select: { id: true } })
  if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 })

  // Postgres array contains-any using `has` would require knowing tool names
  // up front. Since we just want "any mcp: prefixed entry", use raw SQL.
  let rows: any[]
  try {
    rows = await (db as any).$queryRaw`
      SELECT id, "createdAt", "actionsPerformed", "contactId"
      FROM "MessageLog"
      WHERE "agentId" = ${agentId}
        AND EXISTS (
          SELECT 1 FROM unnest("actionsPerformed") AS a WHERE a LIKE 'mcp:%'
        )
      ORDER BY "createdAt" DESC
      LIMIT 50
    `
  } catch {
    return NextResponse.json({ logs: [] })
  }

  return NextResponse.json({
    logs: rows.map(r => ({
      id: r.id,
      createdAt: r.createdAt,
      // Contacts live in the CRM, not our DB — show the id so the operator
      // can pivot to it if needed. Hydrating names would require a CRM call
      // per row.
      contactName: r.contactId ? r.contactId.slice(0, 12) : null,
      actionsPerformed: r.actionsPerformed,
    })),
  })
}
