import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'
import { canInviteCrossDomain, canAddTeamMember, isTrialExpired } from '@/lib/plans'

type Params = { params: Promise<{ workspaceId: string }> }

/**
 * GET /api/workspaces/:id/invites — list pending invites
 */
export async function GET(_req: NextRequest, { params }: Params) {
  const { workspaceId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  const invites = await db.workspaceInvite.findMany({
    where: { workspaceId, acceptedAt: null },
    orderBy: { createdAt: 'desc' },
  })

  return NextResponse.json({ invites })
}

/**
 * POST /api/workspaces/:id/invites — invite users by email
 * Body: { emails: string[], role?: string }
 *
 * Same-domain invites are always free.
 * Cross-domain invites are flagged for future paywall but currently allowed.
 */
export async function POST(req: NextRequest, { params }: Params) {
  const { workspaceId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  const body = await req.json()
  const rawEmails: string[] = Array.isArray(body.emails) ? body.emails : []
  const role = body.role === 'admin' ? 'admin' : 'member'

  // Validate & dedupe emails
  const emails = [...new Set(
    rawEmails
      .map(e => e.trim().toLowerCase())
      .filter(e => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e))
  )].slice(0, 20) // max 20 at a time

  if (emails.length === 0) {
    return NextResponse.json({ error: 'No valid emails provided' }, { status: 400 })
  }

  // Get workspace for plan checks
  const workspace = await db.workspace.findUnique({
    where: { id: workspaceId },
    select: { domain: true, plan: true, trialEndsAt: true },
  })

  // ─── Feature gating: team member limit & cross-domain ───
  if (workspace?.plan === 'trial' && isTrialExpired(workspace.trialEndsAt)) {
    return NextResponse.json({
      error: 'Your trial has expired. Please upgrade to invite team members.',
      code: 'TRIAL_EXPIRED',
    }, { status: 403 })
  }

  const currentMemberCount = await db.workspaceMember.count({ where: { workspaceId } })
  if (!canAddTeamMember(workspace?.plan || 'trial', currentMemberCount)) {
    return NextResponse.json({
      error: 'Team member limit reached. Upgrade your plan to add more members.',
      code: 'MEMBER_LIMIT',
    }, { status: 403 })
  }

  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // 7 days
  const results: { email: string; status: string; crossDomain: boolean }[] = []

  for (const email of emails) {
    const emailDomain = email.split('@')[1]
    const crossDomain = workspace?.domain ? emailDomain !== workspace.domain : false

    // Check cross-domain invite permission
    if (crossDomain && !canInviteCrossDomain(workspace?.plan || 'trial')) {
      results.push({ email, status: 'cross_domain_not_allowed', crossDomain })
      continue
    }

    // Check if already a member
    const existingUser = await db.user.findUnique({ where: { email }, select: { id: true } })
    if (existingUser) {
      const existingMember = await db.workspaceMember.findUnique({
        where: { userId_workspaceId: { userId: existingUser.id, workspaceId } },
      })
      if (existingMember) {
        results.push({ email, status: 'already_member', crossDomain })
        continue
      }
    }

    // Upsert invite (don't duplicate)
    try {
      await db.workspaceInvite.upsert({
        where: { workspaceId_email: { workspaceId, email } },
        create: {
          workspaceId,
          email,
          role,
          invitedBy: access.session.user.id,
          expiresAt,
        },
        update: {
          role,
          invitedBy: access.session.user.id,
          expiresAt,
          acceptedAt: null, // re-open if previously expired
        },
      })
      results.push({ email, status: 'invited', crossDomain })
    } catch {
      results.push({ email, status: 'error', crossDomain })
    }
  }

  // TODO: Send invite emails via Resend/SES

  return NextResponse.json({ results })
}
