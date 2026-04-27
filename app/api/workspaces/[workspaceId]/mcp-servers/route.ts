import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'
import { encryptSecret } from '@/lib/secrets'
import { MCP_REGISTRY } from '@/lib/mcp-registry'
import { isMissingColumn, migrationPendingResponse } from '@/lib/migration-error'

type Params = { params: Promise<{ workspaceId: string }> }

export async function GET(_req: NextRequest, { params }: Params) {
  const { workspaceId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  try {
    const servers = await db.mcpServer.findMany({
      where: { workspaceId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true, workspaceId: true, name: true, registrySlug: true,
        description: true, iconUrl: true, transport: true, url: true,
        authType: true, headers: true, isActive: true,
        lastDiscoveredAt: true, discoveredTools: true,
        createdAt: true, updatedAt: true,
        // Never return authSecretEnc
      },
    })
    return NextResponse.json({ servers, registry: MCP_REGISTRY })
  } catch {
    return NextResponse.json({ servers: [], registry: MCP_REGISTRY, notMigrated: true })
  }
}

export async function POST(req: NextRequest, { params }: Params) {
  const { workspaceId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  let body: any = {}
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }

  // If a registrySlug is supplied, hydrate defaults from the curated registry
  let defaults: any = {}
  if (body.registrySlug) {
    const entry = MCP_REGISTRY.find(r => r.slug === body.registrySlug)
    if (entry) {
      defaults = {
        name: entry.name,
        description: entry.description,
        iconUrl: entry.iconUrl,
        transport: 'http',
        url: entry.defaultUrl,
        authType: entry.authType,
      }
    }
  }

  const name = String(body.name || defaults.name || '').trim()
  const url = String(body.url || defaults.url || '').trim()
  if (!name) return NextResponse.json({ error: 'name required' }, { status: 400 })
  if (!url) return NextResponse.json({ error: 'url required' }, { status: 400 })

  let authSecretEnc: string | null = null
  if (body.authSecret && typeof body.authSecret === 'string') {
    try { authSecretEnc = encryptSecret(body.authSecret) }
    catch (e: any) {
      return NextResponse.json({ error: e.message || 'Encryption failed' }, { status: 500 })
    }
  }

  try {
    const server = await db.mcpServer.create({
      data: {
        workspaceId,
        name,
        registrySlug: body.registrySlug || null,
        description: body.description ?? defaults.description ?? null,
        iconUrl: body.iconUrl ?? defaults.iconUrl ?? null,
        transport: body.transport || defaults.transport || 'http',
        url,
        authType: body.authType || defaults.authType || 'bearer',
        authSecretEnc,
        headers: body.headers ?? null,
        isActive: body.isActive ?? true,
      },
    })
    const { authSecretEnc: _, ...safe } = server
    return NextResponse.json({ server: safe })
  } catch (err: any) {
    if (isMissingColumn(err)) return migrationPendingResponse('MCP connectors', 'manual_mcp_connectors.sql')
    return NextResponse.json({ error: err.message || 'Failed to create MCP server' }, { status: 500 })
  }
}
