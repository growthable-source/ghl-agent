import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'
import { isMissingColumn, migrationPendingResponse } from '@/lib/migration-error'

type Params = { params: Promise<{ workspaceId: string; agentId: string }> }

/**
 * GET /api/workspaces/:workspaceId/agents/:agentId/mcp-tools
 *
 * Returns all MCP servers attached to this agent's workspace, plus the
 * agent-specific tool attachments (whenToUse, keywords, requireApproval).
 * The dashboard uses this to render the Integrations tab.
 */
export async function GET(_req: NextRequest, { params }: Params) {
  const { workspaceId, agentId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  const agent = await db.agent.findFirst({ where: { id: agentId, workspaceId }, select: { id: true } })
  if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 })

  const [servers, attachments] = await Promise.all([
    db.mcpServer.findMany({
      where: { workspaceId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true, name: true, registrySlug: true, description: true, iconUrl: true,
        url: true, isActive: true, lastDiscoveredAt: true, discoveredTools: true,
      },
    }),
    db.agentMcpTool.findMany({ where: { agentId } }),
  ])

  return NextResponse.json({ servers, attachments })
}

/**
 * POST /api/workspaces/:workspaceId/agents/:agentId/mcp-tools
 * Body: { mcpServerId, toolName, enabled?, whenToUse?, mustIncludeKeywords?, requireApproval? }
 *
 * Upserts an attachment. Used to add a tool to an agent or update its rule.
 */
export async function POST(req: NextRequest, { params }: Params) {
  const { workspaceId, agentId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  const agent = await db.agent.findFirst({ where: { id: agentId, workspaceId }, select: { id: true } })
  if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 })

  let body: any = {}
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }
  const { mcpServerId, toolName } = body
  if (!mcpServerId || !toolName) {
    return NextResponse.json({ error: 'mcpServerId and toolName required' }, { status: 400 })
  }

  // Verify the server belongs to this workspace
  const server = await db.mcpServer.findFirst({
    where: { id: mcpServerId, workspaceId },
    select: { id: true },
  })
  if (!server) return NextResponse.json({ error: 'MCP server not found' }, { status: 404 })

  const data = {
    enabled: body.enabled ?? true,
    whenToUse: body.whenToUse ?? null,
    mustIncludeKeywords: Array.isArray(body.mustIncludeKeywords) ? body.mustIncludeKeywords : [],
    requireApproval: !!body.requireApproval,
  }

  try {
    const attachment = await db.agentMcpTool.upsert({
      where: { agentId_mcpServerId_toolName: { agentId, mcpServerId, toolName } },
      create: { agentId, mcpServerId, toolName, ...data },
      update: data,
    })
    return NextResponse.json({ attachment })
  } catch (err: any) {
    if (isMissingColumn(err)) return migrationPendingResponse('MCP connectors', 'manual_mcp_connectors.sql')
    return NextResponse.json({ error: err.message || 'Failed to save attachment' }, { status: 500 })
  }
}

/**
 * DELETE /api/workspaces/:workspaceId/agents/:agentId/mcp-tools?id=...
 * Removes a single attachment by id (detaches that one tool).
 */
export async function DELETE(req: NextRequest, { params }: Params) {
  const { workspaceId, agentId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  const id = new URL(req.url).searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id query param required' }, { status: 400 })

  try {
    const att = await db.agentMcpTool.findFirst({ where: { id, agentId } })
    if (!att) return NextResponse.json({ error: 'Attachment not found' }, { status: 404 })
    await db.agentMcpTool.delete({ where: { id } })
    return NextResponse.json({ success: true })
  } catch (err: any) {
    if (isMissingColumn(err)) return migrationPendingResponse('MCP connectors', 'manual_mcp_connectors.sql')
    return NextResponse.json({ error: err.message || 'Failed to delete attachment' }, { status: 500 })
  }
}
