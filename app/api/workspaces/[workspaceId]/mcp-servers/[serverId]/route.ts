import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'
import { encryptSecret } from '@/lib/secrets'
import { isMissingColumn, migrationPendingResponse } from '@/lib/migration-error'

type Params = { params: Promise<{ workspaceId: string; serverId: string }> }

export async function GET(_req: NextRequest, { params }: Params) {
  const { workspaceId, serverId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  const server = await db.mcpServer.findFirst({
    where: { id: serverId, workspaceId },
    select: {
      id: true, workspaceId: true, name: true, registrySlug: true,
      description: true, iconUrl: true, transport: true, url: true,
      authType: true, headers: true, isActive: true,
      lastDiscoveredAt: true, discoveredTools: true,
      createdAt: true, updatedAt: true,
      authSecretEnc: true,
    },
  })
  if (!server) return NextResponse.json({ error: 'MCP server not found' }, { status: 404 })
  const { authSecretEnc, ...safe } = server
  return NextResponse.json({ server: { ...safe, hasAuthSecret: !!authSecretEnc } })
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const { workspaceId, serverId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  let body: any = {}
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }

  const allowed = ['name', 'description', 'iconUrl', 'transport', 'url', 'authType', 'headers', 'isActive']
  const data: Record<string, unknown> = {}
  for (const key of allowed) if (body[key] !== undefined) data[key] = body[key]

  if (typeof body.authSecret === 'string') {
    if (body.authSecret === '') {
      data.authSecretEnc = null
    } else {
      try { data.authSecretEnc = encryptSecret(body.authSecret) }
      catch (e: any) { return NextResponse.json({ error: e.message }, { status: 500 }) }
    }
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: 'No valid fields' }, { status: 400 })
  }

  try {
    const server = await db.mcpServer.update({ where: { id: serverId }, data })
    const { authSecretEnc, ...safe } = server
    return NextResponse.json({ server: safe })
  } catch (err: any) {
    if (isMissingColumn(err)) return migrationPendingResponse('MCP connectors', 'manual_mcp_connectors.sql')
    return NextResponse.json({ error: err.message || 'Failed to update MCP server' }, { status: 500 })
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { workspaceId, serverId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  try {
    await db.mcpServer.delete({ where: { id: serverId } })
    return NextResponse.json({ success: true })
  } catch (err: any) {
    if (isMissingColumn(err)) return migrationPendingResponse('MCP connectors', 'manual_mcp_connectors.sql')
    return NextResponse.json({ error: err.message || 'Failed to delete MCP server' }, { status: 500 })
  }
}
