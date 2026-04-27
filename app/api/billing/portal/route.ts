import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { stripe } from '@/lib/stripe'

/**
 * POST /api/billing/portal
 * Creates a Stripe Billing Portal session for managing subscription.
 *
 * Body: { workspaceId }
 */
export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { workspaceId } = await req.json()
  if (!workspaceId) {
    return NextResponse.json({ error: 'Missing workspaceId' }, { status: 400 })
  }

  const member = await db.workspaceMember.findUnique({
    where: { userId_workspaceId: { userId: session.user.id, workspaceId } },
    select: { role: true },
  })
  if (!member || (member.role !== 'owner' && member.role !== 'admin')) {
    return NextResponse.json({ error: 'Only owners and admins can manage billing' }, { status: 403 })
  }

  const workspace = await db.workspace.findUnique({ where: { id: workspaceId } })
  if (!workspace?.stripeCustomerId) {
    return NextResponse.json({ error: 'No billing account found' }, { status: 404 })
  }

  const baseUrl = process.env.NEXTAUTH_URL || process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'

  const portalSession = await stripe.billingPortal.sessions.create({
    customer: workspace.stripeCustomerId,
    return_url: `${baseUrl}/dashboard/${workspaceId}/settings`,
  })

  return NextResponse.json({ url: portalSession.url })
}
