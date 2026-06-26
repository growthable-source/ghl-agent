import { NextRequest, NextResponse } from 'next/server'
import { randomBytes } from 'crypto'
import { db } from '@/lib/db'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'
import { canInviteCrossDomain, canAddTeamMember, recommendPlanForLimit, PLAN_FEATURES } from '@/lib/plans'
import { isInternalWorkspace } from '@/lib/internal-workspace'
import { can, isValidRole, assignableRoles, type WorkspaceRole } from '@/lib/permissions'
import { sendWorkspaceInviteEmail } from '@/lib/workspace-invite-email'

function newInviteToken(): string {
  // 24-byte URL-safe random — opaque, single-use. Stored as the
  // primary `token` column on the invite; rotated on resend so old
  // links die.
  return randomBytes(24).toString('base64url')
}

type Params = { params: Promise<{ workspaceId: string }> }

/**
 * GET /api/workspaces/:id/invites — list pending invites
 */
export async function GET(_req: NextRequest, { params }: Params) {
  const { workspaceId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access
  if (!can(access.role, 'members.invite')) {
    return NextResponse.json({ error: 'You do not have permission to view invites.' }, { status: 403 })
  }

  // Don't leak the raw token in the list response — it's only needed
  // when reconstructing the accept URL for resend / clipboard-copy,
  // and an exposed token in the response body is a token-stealing
  // hazard if any operator-side error log gets shared. The resend
  // endpoint returns the rotated token in its specific response.
  const invites = await db.workspaceInvite.findMany({
    where: { workspaceId, acceptedAt: null },
    select: {
      id: true, email: true, role: true, invitedBy: true,
      acceptedAt: true, expiresAt: true, createdAt: true,
    },
    orderBy: { createdAt: 'desc' },
  })

  // Hydrate inviter display info. One query per workspace, not per
  // invite, so the page stays snappy on big teams.
  const inviterIds = Array.from(new Set(invites.map(i => i.invitedBy).filter(Boolean)))
  const inviters = inviterIds.length
    ? await db.user.findMany({
        where: { id: { in: inviterIds } },
        select: { id: true, name: true, email: true },
      })
    : []
  const inviterById = new Map(inviters.map(u => [u.id, u]))

  const now = Date.now()
  return NextResponse.json({
    invites: invites.map(i => ({
      ...i,
      expired: i.expiresAt.getTime() < now,
      inviter: inviterById.get(i.invitedBy) ?? null,
    })),
  })
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
  if (!can(access.role, 'members.invite')) {
    return NextResponse.json({ error: 'You do not have permission to invite teammates.' }, { status: 403 })
  }

  const body = await req.json()
  const rawEmails: string[] = Array.isArray(body.emails) ? body.emails : []
  // Constrain the assignable role to what the current actor can mint —
  // admins can't mint other admins or owners. Falls back to member if
  // an unsupported role is requested.
  const allowed = assignableRoles(access.role as WorkspaceRole)
  const requestedRole = typeof body.role === 'string' ? body.role : 'member'
  const role: WorkspaceRole = (isValidRole(requestedRole) && allowed.includes(requestedRole as WorkspaceRole))
    ? requestedRole as WorkspaceRole
    : 'member'

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
  let workspace: { domain: string | null; plan: string; trialEndsAt: Date | null } | null = null
  try {
    workspace = await db.workspace.findUnique({
      where: { id: workspaceId },
      select: { domain: true, plan: true, trialEndsAt: true },
    })
  } catch {
    // trialEndsAt may not exist yet — fall back to domain-only query
    const ws = await db.workspace.findUnique({
      where: { id: workspaceId },
      select: { domain: true, plan: true },
    })
    if (ws) workspace = { ...ws, trialEndsAt: null }
  }

  // ─── Feature gating: team member limit & cross-domain ───
  // Plan + trial state are account-level — see lib/effective-plan.ts.
  const internal = await isInternalWorkspace(workspaceId)
  const { getEffectivePlan } = await import('@/lib/effective-plan')
  const effective = await getEffectivePlan(workspaceId).catch(() => null)

  if (!internal && effective?.trialExpired) {
    const recommendedPlan = recommendPlanForLimit('trial', 'TRIAL_EXPIRED')
    const recommendedFeatures = recommendedPlan ? PLAN_FEATURES[recommendedPlan] : null
    return NextResponse.json({
      error: 'Your trial has expired.',
      code: 'TRIAL_EXPIRED',
      currentPlan: effective.plan,
      recommendedPlan,
      recommendedPlanLabel: recommendedFeatures?.label ?? null,
      recommendedPlanPrice: recommendedFeatures?.monthlyPrice ?? null,
      benefit: 'Invite teammates again',
    }, { status: 403 })
  }

  const currentMemberCount = await db.workspaceMember.count({ where: { workspaceId } })
  const planNow = effective?.plan || 'free'
  if (!internal && !canAddTeamMember(planNow, currentMemberCount)) {
    const recommendedPlan = recommendPlanForLimit(planNow, 'MEMBER_LIMIT')
    const recommendedFeatures = recommendedPlan ? PLAN_FEATURES[recommendedPlan] : null
    return NextResponse.json({
      error: 'Team member limit reached.',
      code: 'MEMBER_LIMIT',
      currentPlan: planNow,
      currentCount: currentMemberCount,
      recommendedPlan,
      recommendedPlanLabel: recommendedFeatures?.label ?? null,
      recommendedPlanPrice: recommendedFeatures?.monthlyPrice ?? null,
      recommendedPlanCapacity: recommendedFeatures?.teamMembers === Infinity ? null : recommendedFeatures?.teamMembers ?? null,
      benefit: recommendedFeatures
        ? (recommendedFeatures.teamMembers === Infinity ? 'Unlimited team seats' : `${recommendedFeatures.teamMembers} team seats`)
        : null,
    }, { status: 403 })
  }

  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // 7 days
  const results: { email: string; status: string; crossDomain: boolean }[] = []

  for (const email of emails) {
    const emailDomain = email.split('@')[1]
    const crossDomain = workspace?.domain ? emailDomain !== workspace.domain : false

    // Check cross-domain invite permission — internal workspaces skip this
    if (crossDomain && !internal && !canInviteCrossDomain(workspace?.plan || 'trial')) {
      results.push({ email, status: 'cross_domain_not_allowed', crossDomain })
      continue
    }

    // Check if already a member
    const existingUser = await db.user.findUnique({ where: { email }, select: { id: true } })
    if (existingUser) {
      const existingMember = await db.workspaceMember.findUnique({
        where: { userId_workspaceId: { userId: existingUser.id, workspaceId } },
        select: { id: true },
      })
      if (existingMember) {
        results.push({ email, status: 'already_member', crossDomain })
        continue
      }
    }

    // Upsert invite (don't duplicate). New invites get a fresh token;
    // re-issuing an existing pending invite ALSO rotates the token so
    // any old links stop working — limits the blast radius of a leaked
    // link from a prior email forward.
    const token = newInviteToken()
    let saved: { token: string; role: string } | null = null
    try {
      saved = await db.workspaceInvite.upsert({
        where: { workspaceId_email: { workspaceId, email } },
        create: {
          workspaceId,
          email,
          role,
          invitedBy: access.session.user.id,
          expiresAt,
          token,
        },
        update: {
          role,
          invitedBy: access.session.user.id,
          expiresAt,
          acceptedAt: null,
          token,
        },
        select: { token: true, role: true },
      })
      results.push({ email, status: 'invited', crossDomain })
    } catch {
      results.push({ email, status: 'error', crossDomain })
    }

    // Fire the email best-effort — a Resend hiccup must not break the
    // operator's bulk-invite. The link is also visible in the members
    // page so the operator can copy it manually if email fails.
    if (saved) {
      try {
        const inviter = await db.user.findUnique({
          where: { id: access.session.user.id },
          select: { name: true, email: true },
        }).catch(() => null)
        const ws = await db.workspace.findUnique({
          where: { id: workspaceId },
          select: { name: true },
        })
        const base = process.env.NEXT_PUBLIC_APP_URL || ''
        await sendWorkspaceInviteEmail({
          to: email,
          workspaceName: ws?.name || 'a Xovera workspace',
          inviterName: inviter?.name ?? inviter?.email ?? null,
          role: saved.role,
          inviteUrl: `${base}/invite/${saved.token}`,
        })
      } catch (err: any) {
        console.warn('[invites] email failed for', email, err?.message)
      }
    }
  }

  return NextResponse.json({ results })
}
