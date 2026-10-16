#!/usr/bin/env node
/**
 * Grant "unlimited" usage to every workspace a given user is a MEMBER of.
 *
 * Why a script and not the admin UI: the /admin workspace pages expose
 * pause / diagnostics / learnings only — there is no limit-editing
 * endpoint. Uncapping is a direct Workspace-row change, so it lives here
 * where it can be dry-run and audited by eye before it writes.
 *
 * ── What "unlimited" means here ──────────────────────────────────────
 * Enforcement is split across several fields, so we set all of them:
 *   - Agent creation gates on getEffectivePlan() → the workspace OWNER's
 *     best plan + aggregated extraAgentCount (NOT the agentLimit column,
 *     NOT the member's own row). So we set plan='scale' + a huge
 *     extraAgentCount on the workspace itself; that lifts the owner's
 *     effective plan for this workspace.
 *   - Voice gates on the workspace's own plan column + voiceMinuteLimit
 *     column (see lib/plans.effectiveVoiceMinuteLimit). Set both.
 *   - Messages are soft-limited/metered (checkMessageUsage always allows;
 *     it has no callers) — the messageLimit column only drives overage
 *     BILLING. Set it high so no overage is charged.
 * We mirror the existing comp recipe (app/api/admin/help-center/.../unlock):
 * plan + limits + clear trial fields.
 *
 * ── Owner-portfolio side effect (read this) ──────────────────────────
 * Because agent/widget/team gates read the workspace OWNER's portfolio,
 * flipping a workspace to 'scale' also lifts plan-gated features on the
 * OWNER's *other* workspaces (best-plan-wins across their portfolio).
 * For Growthable-internal owners that's fine. For anyone else it is not —
 * which is why this refuses to touch Stripe-billed workspaces by default.
 *
 * ── Safety ───────────────────────────────────────────────────────────
 *   - DRY RUN by default: prints the plan, writes nothing.
 *   - --commit                actually writes.
 *   - --include-billed        also touch workspaces with a Stripe
 *                             subscription (DANGER: real customers). Off
 *                             by default; such workspaces are skipped and
 *                             listed loudly.
 *   - --email=<addr>          target user (default dan@growthable.io).
 *
 * Requires DATABASE_URL in the environment (load .env.local first):
 *   env $(grep -v '^#' .env.local | xargs) node scripts/grant-unlimited.mjs
 *   env $(grep -v '^#' .env.local | xargs) node scripts/grant-unlimited.mjs --commit
 */

import { PrismaClient } from '@prisma/client'

const arg = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=')
const has = (name) => process.argv.includes(`--${name}`)

const EMAIL = (arg('email') || 'dan@growthable.io').trim().toLowerCase()
const COMMIT = has('commit')
const INCLUDE_BILLED = has('include-billed')

// Effectively-unlimited integer caps. Large enough to never be reached,
// small enough to be nowhere near INT4 overflow (2.1B).
const UNLIMITED = 1_000_000
const TOP_PLAN = 'scale'

function bail(msg) {
  console.error(`\n${msg}\n`)
  process.exit(1)
}

async function main() {
  if (!process.env.DATABASE_URL) {
    bail(
      'DATABASE_URL is not set. Load .env.local first, e.g.:\n' +
      "  env $(grep -v '^#' .env.local | xargs) node scripts/grant-unlimited.mjs",
    )
  }

  const db = new PrismaClient()
  try {
    const user = await db.user.findUnique({
      where: { email: EMAIL },
      select: { id: true, email: true, name: true },
    })
    if (!user) {
      bail(
        `No User row for ${EMAIL}. They must sign in to the app at least once ` +
        `before they have workspace memberships to uncap. (Super-admin access ` +
        `is a separate thing — see /admin/admins.)`,
      )
    }

    const memberships = await db.workspaceMember.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'asc' },
      select: {
        role: true,
        workspace: {
          select: {
            id: true, name: true, plan: true, stripeSubscriptionId: true,
            agentLimit: true, extraAgentCount: true, messageLimit: true,
            voiceMinuteLimit: true, trialEndsAt: true,
          },
        },
      },
    })

    console.log(`\n${COMMIT ? '⚙  COMMIT' : '🔎 DRY RUN'} — grant unlimited usage`)
    console.log(`User: ${user.name || '(no name)'} <${user.email}>  id=${user.id}`)
    console.log(`Member of ${memberships.length} workspace(s).\n`)

    if (memberships.length === 0) {
      console.log('Nothing to do — user is not a member of any workspace.\n')
      return
    }

    // Resolve each workspace's owner for context (who the gates key off).
    const rows = []
    for (const m of memberships) {
      const w = m.workspace
      if (!w) continue
      const owner = await db.workspaceMember.findFirst({
        where: { workspaceId: w.id, role: 'owner' },
        orderBy: { createdAt: 'asc' },
        select: { user: { select: { email: true, name: true } } },
      })
      const billed = !!w.stripeSubscriptionId
      const skip = billed && !INCLUDE_BILLED
      rows.push({ w, danRole: m.role, owner: owner?.user, billed, skip })
    }

    for (const r of rows) {
      const { w, danRole, owner, billed, skip } = r
      const ownerLabel = owner ? `${owner.email}${owner.name ? ` (${owner.name})` : ''}` : '(no owner row)'
      console.log(`• ${w.name || '(unnamed)'}  [${w.id}]`)
      console.log(`    Dan's role: ${danRole}   owner: ${ownerLabel}`)
      console.log(`    plan=${w.plan}  agentLimit=${w.agentLimit}  extraAgents=${w.extraAgentCount}  msgLimit=${w.messageLimit}  voiceMin=${w.voiceMinuteLimit}  trialEndsAt=${w.trialEndsAt ? w.trialEndsAt.toISOString() : 'null'}`)
      console.log(`    stripeSubscription=${billed ? 'YES' : 'no'}`)
      if (skip) {
        console.log('    ⏭  SKIP — Stripe-billed (real customer). Re-run with --include-billed to override (dangerous).')
      } else {
        console.log(`    → set plan=${TOP_PLAN}, agentLimit=${UNLIMITED}, extraAgents=${UNLIMITED}, msgLimit=${UNLIMITED}, voiceMin=${UNLIMITED}, trialEndsAt=null`)
      }
      console.log('')
    }

    const toApply = rows.filter((r) => !r.skip)
    const skipped = rows.filter((r) => r.skip)

    if (skipped.length) {
      console.log(`⚠  Skipping ${skipped.length} Stripe-billed workspace(s) (see ⏭ above).`)
    }

    if (!COMMIT) {
      console.log(`\nDRY RUN complete — nothing written. ${toApply.length} workspace(s) would change.`)
      console.log('Re-run with --commit to apply.\n')
      return
    }

    if (toApply.length === 0) {
      console.log('\nNothing to write.\n')
      return
    }

    let n = 0
    for (const r of toApply) {
      await db.workspace.update({
        where: { id: r.w.id },
        data: {
          plan: TOP_PLAN,
          agentLimit: UNLIMITED,
          extraAgentCount: UNLIMITED,
          messageLimit: UNLIMITED,
          voiceMinuteLimit: UNLIMITED,
          trialEndsAt: null,
          planSelectedDuringTrial: null,
        },
      })
      n++
      console.log(`✓ Uncapped ${r.w.name || r.w.id}`)
    }
    console.log(`\nDone — ${n} workspace(s) set to unlimited.\n`)
  } finally {
    await db.$disconnect()
  }
}

main().catch((err) => {
  console.error('\nFailed:', err?.message || err)
  process.exit(1)
})
