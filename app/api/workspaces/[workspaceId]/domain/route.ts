/**
 * Workspace white-label domain — state + management.
 *
 *   GET    any member     → { unlocked, domain, branding, publicOrigin,
 *                           canManage }  (publicOrigin is what every
 *                           shareable link/snippet should use)
 *   POST   super admin    → { hostname }  add the domain
 *   PATCH  admin+         → re-check DNS/verification now (changes nothing)
 *   DELETE super admin    → remove the domain
 *   PUT    super admin    → branding for pages served on the domain (tab
 *                           title, favicon, where the bare domain goes) and
 *                           the team sign-in page (logo, accent, heading,
 *                           message). Blank = fall back.
 *
 * "Super admin" = a platform admin (lib/whitelabel/super-admin.ts), who
 * must ALSO reach the workspace (support session or membership). Workspace
 * owners/admins configure everything else but not white-label.
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
import { parseBrandSettings } from '@/lib/domains/brand-metadata'
import { db } from '@/lib/db'
import { logAdminActionAfter, type AdminSession } from '@/lib/admin-auth'
import { WHITELABEL_FORBIDDEN_MESSAGE, whitelabelManager } from '@/lib/whitelabel/super-admin'

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
  return { ...state, publicOrigin, canManage: !!(await whitelabelManager()) }
}

/** Workspace reachable AND caller is a platform admin; else the error response. */
async function requireManager(workspaceId: string): Promise<AdminSession | NextResponse> {
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access
  const admin = await whitelabelManager()
  if (!admin) return NextResponse.json({ error: WHITELABEL_FORBIDDEN_MESSAGE, code: 'forbidden' }, { status: 403 })
  return admin
}

export async function GET(req: NextRequest, { params }: Params) {
  const { workspaceId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access
  return NextResponse.json(await snapshot(req, workspaceId))
}

export async function POST(req: NextRequest, { params }: Params) {
  const { workspaceId } = await params
  const admin = await requireManager(workspaceId)
  if (admin instanceof NextResponse) return admin
  const body = (await req.json().catch(() => ({}))) as { hostname?: string }
  try {
    await addWorkspaceDomain(workspaceId, body.hostname ?? '')
    logAdminActionAfter({ admin, action: 'whitelabel_domain_add', target: workspaceId, meta: { hostname: body.hostname ?? '' } })
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
  const admin = await requireManager(workspaceId)
  if (admin instanceof NextResponse) return admin
  try {
    await removeWorkspaceDomain(workspaceId)
    logAdminActionAfter({ admin, action: 'whitelabel_domain_remove', target: workspaceId })
    return NextResponse.json(await snapshot(req, workspaceId))
  } catch (err) {
    return errorResponse(err)
  }
}

export async function PUT(req: NextRequest, { params }: Params) {
  const { workspaceId } = await params
  const admin = await requireManager(workspaceId)
  if (admin instanceof NextResponse) return admin
  const parsed = parseBrandSettings(await req.json().catch(() => ({})))
  if (!parsed.ok) return NextResponse.json({ error: parsed.error, code: 'invalid' }, { status: 400 })
  // Saved whether or not the workspace is unlocked yet — it only takes
  // effect on branded pages once white-labelling is unlocked.
  await db.workspace.update({
    where: { id: workspaceId },
    data: {
      whitelabelBrandName: parsed.value.brandName,
      whitelabelFaviconUrl: parsed.value.faviconUrl,
      whitelabelRootUrl: parsed.value.rootUrl,
      whitelabelLogoUrl: parsed.value.logoUrl,
      whitelabelAccentColor: parsed.value.accentColor,
      whitelabelButtonTextColor: parsed.value.buttonTextColor,
      whitelabelLoginHeading: parsed.value.loginHeading,
      whitelabelLoginMessage: parsed.value.loginMessage,
    },
  })
  logAdminActionAfter({ admin, action: 'whitelabel_branding_update', target: workspaceId, meta: { ...parsed.value } })
  return NextResponse.json(await snapshot(req, workspaceId))
}
