/**
 * White-label email sending domain (lib/domains/sending-domain.ts).
 *
 *   GET    manager → { sendingDomain: view | null }
 *   POST   manager → { domain }  register it on our Resend account
 *   PATCH  manager → re-check verification now
 *   DELETE manager → remove it (emails fall back to our sender)
 *
 * "Manager" = the workspace owner or a platform admin
 * (lib/whitelabel/manager.ts). Everyone else gets a plain 404 — admins
 * ("directors") must not learn white-label exists.
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'
import {
  addSendingDomain,
  getSendingDomain,
  refreshSendingDomain,
  removeSendingDomain,
  SendingDomainError,
} from '@/lib/domains/sending-domain'
import { ResendError, ResendNotConfiguredError } from '@/lib/domains/resend-domains'
import { logAdminActionAfter } from '@/lib/admin-auth'
import { whitelabelHidden, whitelabelManager, type WhitelabelManager } from '@/lib/whitelabel/manager'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ workspaceId: string }> }

function errorResponse(err: unknown): NextResponse {
  if (err instanceof SendingDomainError) {
    const status = err.code === 'locked' ? 403 : err.code === 'not_found' ? 404 : err.code === 'resend' ? 502 : 400
    return NextResponse.json({ error: err.message, code: err.code }, { status })
  }
  if (err instanceof ResendNotConfiguredError) {
    return NextResponse.json({ error: err.message, code: 'not_configured' }, { status: 503 })
  }
  if (err instanceof ResendError) {
    return NextResponse.json({ error: err.message, code: 'resend' }, { status: 502 })
  }
  throw err
}

async function requireManager(workspaceId: string): Promise<WhitelabelManager | NextResponse> {
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access
  return (await whitelabelManager(workspaceId)) ?? whitelabelHidden()
}

/** Same rule as the domain route: never into the admin-readable workspace audit log. */
function logChange(manager: WhitelabelManager, action: string, workspaceId: string, meta?: Record<string, unknown>) {
  if (manager.kind === 'platform') {
    logAdminActionAfter({ admin: manager.admin, action, target: workspaceId, meta })
  } else {
    console.info('[whitelabel]', action, { workspaceId, ownerId: manager.userId, ...meta })
  }
}

async function snapshot(workspaceId: string) {
  return { sendingDomain: await getSendingDomain(workspaceId) }
}

export async function GET(_req: NextRequest, { params }: Params) {
  const { workspaceId } = await params
  const manager = await requireManager(workspaceId)
  if (manager instanceof NextResponse) return manager
  return NextResponse.json(await snapshot(workspaceId))
}

export async function POST(req: NextRequest, { params }: Params) {
  const { workspaceId } = await params
  const manager = await requireManager(workspaceId)
  if (manager instanceof NextResponse) return manager
  const body = (await req.json().catch(() => ({}))) as { domain?: string }
  try {
    await addSendingDomain(workspaceId, body.domain ?? '')
    logChange(manager, 'whitelabel_sending_domain_add', workspaceId, { domain: body.domain ?? '' })
    return NextResponse.json(await snapshot(workspaceId))
  } catch (err) {
    return errorResponse(err)
  }
}

export async function PATCH(_req: NextRequest, { params }: Params) {
  const { workspaceId } = await params
  const manager = await requireManager(workspaceId)
  if (manager instanceof NextResponse) return manager
  try {
    await refreshSendingDomain(workspaceId)
    return NextResponse.json(await snapshot(workspaceId))
  } catch (err) {
    return errorResponse(err)
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { workspaceId } = await params
  const manager = await requireManager(workspaceId)
  if (manager instanceof NextResponse) return manager
  try {
    await removeSendingDomain(workspaceId)
    logChange(manager, 'whitelabel_sending_domain_remove', workspaceId)
    return NextResponse.json(await snapshot(workspaceId))
  } catch (err) {
    return errorResponse(err)
  }
}
