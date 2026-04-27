import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'
import { buildWorkspaceDigest } from '@/lib/digest-builder'
import { sendDigestEmail } from '@/lib/digest-email'

type Params = { params: Promise<{ workspaceId: string }> }

/**
 * POST /test-send
 *
 * Sends the current week's digest to the calling user, ignoring opt-in
 * and the cron's recent-send guard. Used by the "Send me a test" button
 * on the digest page so operators can preview what the email looks like
 * without waiting until Monday.
 */
export async function POST(_req: NextRequest, { params }: Params) {
  const { workspaceId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  const userId = access.session.user!.id!
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { email: true, name: true },
  })
  if (!user?.email) {
    return NextResponse.json({ error: 'Your account has no email on file.' }, { status: 400 })
  }

  const workspace = await db.workspace.findUnique({
    where: { id: workspaceId },
    select: { name: true },
  })

  const payload = await buildWorkspaceDigest(workspaceId)
  const result = await sendDigestEmail({
    to: user.email,
    recipientName: user.name,
    workspaceId,
    workspaceName: workspace?.name || 'your workspace',
    payload,
  })

  if (!result.ok) {
    return NextResponse.json({ error: result.reason || 'Send failed' }, { status: 500 })
  }
  return NextResponse.json({ ok: true, sentTo: user.email })
}
