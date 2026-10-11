/**
 * Workspace white-label domain — state + management.
 *
 *   GET    any member   → { unlocked, domain, publicOrigin }  (publicOrigin
 *                         is what every shareable link/snippet should use)
 *   POST   admin+       → { hostname }  add the domain
 *   PATCH  admin+       → re-check DNS/verification now
 *   DELETE admin+       → remove the domain
 *
 * Adding is refused until a platform admin has unlocked white-labelling
 * for the workspace (commercial deal is outside the product).
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'
import { requireWorkspaceRole } from '@/lib/require-workspace-role'
import {
  addWorkspaceDomain,
  DomainError,
  getWorkspaceDomainState,
  getWorkspacePublicOrigin,
  refreshWorkspaceDomain,
  removeWorkspaceDomain,
} from '@/lib/domains/workspace-domain'
import { VercelError, VercelNotConfiguredError } from '@/lib/domains/vercel'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ workspaceId: string }> }

function errorResponse(err: unknown): NextResponse {
  if (err instanceof DomainError) {
    const status = err.code === 'locked' ? 403 : err.code === 'not_found' ? 404 : err.code === 'vercel' ? 502 : 400
    return NextResponse.json({ error: err.message, code: err.code }, { status })
  }
  if (err instanceof VercelNotConfiguredError) {
    return NextResponse.json({ error: err.message, code: 'not_configured' }, { status: 503 })
  }
  if (err instanceof VercelError) {
    return NextResponse.json({ error: err.message, code: 'vercel' }, { status: 502 })
  }
  throw err
}

async function snapshot(req: NextRequest, workspaceId: string) {
  const state = await getWorkspaceDomainState(workspaceId)
  const publicOrigin = await getWorkspacePublicOrigin(workspaceId, req.nextUrl.origin)
  return { ...state, publicOrigin }
}

export async function GET(req: NextRequest, { params }: Params) {
  const { workspaceId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access
  return NextResponse.json(await snapshot(req, workspaceId))
}

export async function POST(req: NextRequest, { params }: Params) {
  const { workspaceId } = await params
  const access = await requireWorkspaceRole(workspaceId, 'admin')
  if (access instanceof NextResponse) return access
  const body = (await req.json().catch(() => ({}))) as { hostname?: string }
  try {
    await addWorkspaceDomain(workspaceId, body.hostname ?? '')
    return NextResponse.json(await snapshot(req, workspaceId))
  } catch (err) {
    return errorResponse(err)
  }
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const { workspaceId } = await params
  const access = await requireWorkspaceRole(workspaceId, 'admin')
  if (access instanceof NextResponse) return access
  try {
    await refreshWorkspaceDomain(workspaceId)
    return NextResponse.json(await snapshot(req, workspaceId))
  } catch (err) {
    return errorResponse(err)
  }
}

export async function DELETE(req: NextRequest, { params }: Params) {
  const { workspaceId } = await params
  const access = await requireWorkspaceRole(workspaceId, 'admin')
  if (access instanceof NextResponse) return access
  try {
    await removeWorkspaceDomain(workspaceId)
    return NextResponse.json(await snapshot(req, workspaceId))
  } catch (err) {
    return errorResponse(err)
  }
}
