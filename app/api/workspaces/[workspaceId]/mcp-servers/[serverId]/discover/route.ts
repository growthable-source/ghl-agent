import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'
import { discoverTools } from '@/lib/mcp-client'

type Params = { params: Promise<{ workspaceId: string; serverId: string }> }

/**
 * POST /api/workspaces/:workspaceId/mcp-servers/:serverId/discover
 *
 * Calls the MCP server's `tools/list` and caches the result on the server
 * row (`discoveredTools` + `lastDiscoveredAt`). Returns the tool list.
 */
export async function POST(_req: NextRequest, { params }: Params) {
  const { workspaceId, serverId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  const server = await db.mcpServer.findFirst({
    where: { id: serverId, workspaceId },
  })
  if (!server) return NextResponse.json({ error: 'MCP server not found' }, { status: 404 })

  const ac = new AbortController()
  const timeout = setTimeout(() => ac.abort(), 10000)
  try {
    const tools = await discoverTools({
      url: server.url,
      authType: server.authType as any,
      authSecretEnc: server.authSecretEnc,
      headers: (server.headers as Record<string, string>) || null,
    }, ac.signal)
    await db.mcpServer.update({
      where: { id: serverId },
      data: { discoveredTools: tools as any, lastDiscoveredAt: new Date() },
    })
    return NextResponse.json({ tools })
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Discovery failed' }, { status: 502 })
  } finally {
    clearTimeout(timeout)
  }
}
