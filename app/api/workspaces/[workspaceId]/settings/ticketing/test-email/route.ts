import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'
import { can } from '@/lib/permissions'
import { sendTicketingEmail } from '@/lib/ticketing-send'

type Params = { params: Promise<{ workspaceId: string }> }

/**
 * POST { to?: string }
 *
 * Pre-flight: send a tiny "this is a test from Voxility" email
 * through the same path real ticket replies use. Lets the operator
 * verify their From identity + Resend domain setup BEFORE a customer
 * is waiting on the other end.
 *
 * - `to` defaults to the operator's own email address — sending to
 *   yourself is the safest pre-flight.
 * - Skips the signature so the test arrives as a clean one-liner.
 * - The returned reason is humanised by the shared helper (e.g.
 *   "Your sender domain `growthable.io` isn't verified in Resend…")
 *   so the settings page can render it inline without further
 *   parsing.
 */
export async function POST(req: NextRequest, { params }: Params) {
  const { workspaceId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access
  if (!can(access.role, 'workspace.settings')) {
    return NextResponse.json({ error: 'Owners and admins only.' }, { status: 403 })
  }

  const body = await req.json().catch(() => ({}))
  // Pull the caller's email from the session (User row) so the
  // default "to" is them. They can override via the body for testing
  // sends to a teammate.
  const me = await db.user.findUnique({
    where: { id: access.session.user!.id },
    select: { email: true },
  })
  const toRaw = typeof body.to === 'string' && body.to.trim() ? body.to.trim() : (me?.email ?? '')
  if (!toRaw || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(toRaw)) {
    return NextResponse.json({ error: 'A valid `to` email is required.' }, { status: 400 })
  }

  const result = await sendTicketingEmail({
    workspaceId,
    to: toRaw,
    subject: 'Voxility ticketing — test email',
    text: 'This is a test from your Voxility ticketing setup. If you\'re reading this, your sender configuration is working.',
    includeSignature: false,
  })

  return NextResponse.json({
    ok: result.ok,
    reason: result.reason,
    to: toRaw,
  })
}
