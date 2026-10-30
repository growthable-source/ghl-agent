/**
 * Workspace white-label domain — state + management.
 *
 *   GET    any member     → managers: { unlocked, domain, branding,
 *                           publicOrigin, canManage: true }
 *                           everyone else: { publicOrigin, canManage: false,
 *                           canEditBranding }
 *                           (publicOrigin is what every shareable
 *                           link/snippet should use)
 *   POST   manager        → { hostname }  add the domain
 *   PATCH  manager        → re-check DNS/verification now (changes nothing)
 *   DELETE manager        → remove the domain
 *   PUT    manager        → branding for pages served on the domain (tab
 *                           title, favicon, where the bare domain goes) and
 *                           the team sign-in page (logo, accent, heading,
 *                           message). Blank = fall back.
 *
 * "Manager" = the workspace owner or a platform admin
 * (lib/whitelabel/manager.ts), who must ALSO reach the workspace. Admins
 * ("directors") configure everything else but must not know white-label
 * exists, so they get a 404 on writes and no white-label fields on GET.
 *
 * Adding is refused until a platform admin has unlocked white-labelling
 * for the workspace (commercial deal is outside the product).
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'
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
import { logAdminActionAfter } from '@/lib/admin-auth'
import { whitelabelHidden, whitelabelManager, type WhitelabelManager } from '@/lib/whitelabel/manager'
import { brandingIsWhitelabel } from '@/lib/whitelabel/manage-policy'

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

async function snapshot(req: NextRequest, workspaceId: string, manager: WhitelabelManager | null) {
  const publicOrigin = await getWorkspacePublicOrigin(workspaceId, req.nextUrl.origin)
  if (!manager) {
    // canEditBranding: whether the workspace logo / widget "Powered by"
    // line are editable (false once white-label is unlocked). Lets those
    // controls hide themselves without revealing why.
    const ws = await db.workspace.findUnique({ where: { id: workspaceId }, select: { whitelabelUnlocked: true } })
    return { publicOrigin, canManage: false, canEditBranding: !brandingIsWhitelabel(!!ws?.whitelabelUnlocked) }
  }
  const state = await getWorkspaceDomainState(workspaceId)
  return { ...state, publicOrigin, canManage: true, canEditBranding: true }
}

/** Workspace reachable AND caller is the owner or a platform admin; else the error response. */
async function requireManager(workspaceId: string): Promise<WhitelabelManager | NextResponse> {
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access
  return (await whitelabelManager(workspaceId)) ?? whitelabelHidden()
}

/**
 * Platform admins land in the admin audit trail. Owner changes are only
 * logged server-side: the workspace audit log is readable by admins, and
 * a "white-label updated" row there would tell directors it exists.
 */
function logChange(manager: WhitelabelManager, action: string, workspaceId: string, meta?: Record<string, unknown>) {
  if (manager.kind === 'platform') {
    logAdminActionAfter({ admin: manager.admin, action, target: workspaceId, meta })
  } else {
    console.info('[whitelabel]', action, { workspaceId, ownerId: manager.userId, ...meta })
  }
}

export async function GET(req: NextRequest, { params }: Params) {
  const { workspaceId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access
  return NextResponse.json(await snapshot(req, workspaceId, await whitelabelManager(workspaceId)))
}

export async function POST(req: NextRequest, { params }: Params) {
  const { workspaceId } = await params
  const manager = await requireManager(workspaceId)
  if (manager instanceof NextResponse) return manager
  const body = (await req.json().catch(() => ({}))) as { hostname?: string }
  try {
    await addWorkspaceDomain(workspaceId, body.hostname ?? '')
    logChange(manager, 'whitelabel_domain_add', workspaceId, { hostname: body.hostname ?? '' })
    return NextResponse.json(await snapshot(req, workspaceId, manager))
  } catch (err) {
    return errorResponse(err)
  }
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const { workspaceId } = await params
  const manager = await requireManager(workspaceId)
  if (manager instanceof NextResponse) return manager
  try {
    await refreshWorkspaceDomain(workspaceId)
    return NextResponse.json(await snapshot(req, workspaceId, manager))
  } catch (err) {
    return errorResponse(err)
  }
}

export async function DELETE(req: NextRequest, { params }: Params) {
  const { workspaceId } = await params
  const manager = await requireManager(workspaceId)
  if (manager instanceof NextResponse) return manager
  try {
    await removeWorkspaceDomain(workspaceId)
    logChange(manager, 'whitelabel_domain_remove', workspaceId)
    return NextResponse.json(await snapshot(req, workspaceId, manager))
  } catch (err) {
    return errorResponse(err)
  }
}

export async function PUT(req: NextRequest, { params }: Params) {
  const { workspaceId } = await params
  const manager = await requireManager(workspaceId)
  if (manager instanceof NextResponse) return manager
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
  logChange(manager, 'whitelabel_branding_update', workspaceId, { ...parsed.value })
  return NextResponse.json(await snapshot(req, workspaceId, manager))
}
