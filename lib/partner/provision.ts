/**
 * Partner provisioning — turn "this help-centre customer wants a chat
 * widget" into a working account, in one API call.
 *
 * Creates, in order: User → Workspace (+ native Location) → Agent
 * (attached to the shared canonical corpus) → ChatWidget. Any stage can
 * fail, so PartnerInstall records what already exists and a retry picks
 * up where the last attempt stopped rather than minting a second
 * workspace for the same person.
 *
 * The user is created passwordless. The partner asserting the email is
 * the proof of ownership — the same trust model as the demo-bundle
 * checkout in lib/demo-purchase/fulfill.ts, where the Stripe receipt
 * email plays that role.
 */

import { createHash, randomBytes } from 'node:crypto'
import { db } from '@/lib/db'
import { provisionWorkspace } from '@/lib/provision-workspace'
import { generatePublicKey } from '@/lib/widget-auth'
import { defaultAgentName } from '@/lib/random-name'
import { applyPreset } from '@/lib/agent/presets'
import { globalCollectionsReady } from '@/lib/knowledge/migration-state'
import { partnerPortalSlug } from './portal-slug'

export const PARTNER_PROVIDER_HELP_CENTER = 'help_center'

export interface ProvisionPartnerInput {
  provider: string
  externalId: string
  email: string
  businessName: string
  /** The customer's help-centre URL. Seeds the widget's allowedDomains
   *  so the embed can't be lifted onto an unrelated site. */
  helpCenterUrl?: string | null
  widget?: {
    name?: string
    primaryColor?: string
    title?: string
    subtitle?: string
    welcomeMessage?: string
  }
  metadata?: Record<string, unknown> | null
}

export interface ProvisionedPartnerInstall {
  installId: string
  workspaceId: string
  agentId: string
  widgetId: string
  widgetPublicKey: string
  trialEndsAt: Date | null
  /** The customer's client portal (CSAT, per-subaccount toggle, AI query
   *  analysis, weekly report emails). Null only when the portal stage
   *  failed non-fatally — the widget still works without it. */
  portalSlug: string | null
  /** False when the install already existed — the caller retried. */
  created: boolean
}

export class ProvisionError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message)
    this.name = 'ProvisionError'
  }
}

/**
 * Trial length for partner-provisioned workspaces. Hardcoded at 7 by
 * operator decision (2026-08-08): the trial story is "a week with the
 * full portal", the invite link and the first weekly report email are
 * both cut to the same 7 days, and an env knob would let the three
 * quietly drift apart.
 */
export function partnerTrialDays(): number {
  return 7
}

/**
 * The shared canonical corpus every provisioned agent reads.
 *
 * Resolved by globalKey rather than a hardcoded cuid so the corpus can
 * be rebuilt or renamed without a redeploy.
 */
export async function resolveCanonicalCollectionId(): Promise<string> {
  const key = (process.env.CANONICAL_KNOWLEDGE_COLLECTION_KEY || '').trim()
  if (!key) {
    throw new ProvisionError(503, 'not_configured',
      'CANONICAL_KNOWLEDGE_COLLECTION_KEY is not set — provisioned agents would have no knowledge.')
  }
  if (!(await globalCollectionsReady())) {
    throw new ProvisionError(503, 'migration_pending',
      'The shared-corpus SQL (2026-08-07-global-knowledge-collections.sql) has not been applied yet.')
  }
  const collection = await db.knowledgeCollection.findUnique({
    where: { globalKey: key },
    select: { id: true, isGlobal: true },
  })
  // Hard-fail rather than provisioning an untrained agent. A widget that
  // greets visitors and then can't answer anything is worse for the
  // customer — and for the upsell — than a failed provision the partner
  // can retry.
  if (!collection) {
    throw new ProvisionError(503, 'not_configured',
      `No knowledge collection carries globalKey "${key}".`)
  }
  if (!collection.isGlobal) {
    throw new ProvisionError(503, 'not_configured',
      `Collection "${key}" is not flagged isGlobal, so agents in other workspaces cannot read it.`)
  }
  return collection.id
}

/** Hostname of the customer's help centre, for the widget origin allowlist. */
function hostnameOf(url: string | null | undefined): string | null {
  if (!url) return null
  try {
    const parsed = new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`)
    return parsed.hostname || null
  } catch {
    return null
  }
}

function supportPrompt(businessName: string): string {
  return [
    `You are the support assistant for ${businessName}.`,
    '',
    'Visitors reach you from the help centre, usually after failing to find an answer by searching. Answer their question directly from the knowledge you have been given.',
    '',
    'How to behave:',
    '- Answer in your own words, warmly and briefly. Two or three sentences beats a wall of text.',
    '- If the knowledge does not cover their question, say so plainly and hand off to a human. Never guess at account-specific facts, prices, dates, or policies.',
    '- Anything about their specific account, a payment, or something that has gone wrong for them goes to a human, even if you think you know the answer.',
    '- Never invent a feature, a limit, or a URL.',
  ].join('\n')
}

/**
 * The client portal half of an install: Brand (which the report queries
 * join through — a widget with no brandId yields an empty portal and no
 * report email), Portal, catalog link, and the customer's invite.
 *
 * Every step is find-or-create on deterministic keys, so this runs
 * safely on retries AND on the early-return path for installs
 * provisioned before portals existed — calling POST /installs again
 * backfills their portal.
 *
 * Failures are contained: a portal that could not be built must not
 * fail a widget that already works. The install records the reason and
 * the next retry resumes.
 *
 * Deliberately NOT provisioned: Portal.customDomain. White-label DNS is
 * a paid feature, and domain wiring is manual operator work either way —
 * a 7-day trial should never be waiting on a CNAME.
 */
async function ensurePortalStage(input: {
  workspaceId: string
  widgetId: string
  externalId: string
  email: string
  businessName: string
}): Promise<string | null> {
  const { workspaceId, widgetId, externalId, email, businessName } = input
  try {
    // ── Brand, attached to the widget. The portal's whole data path
    // (stats, CSAT, report emails) resolves conversations via
    // chatWidget.brandId, so this link is load-bearing, not cosmetic.
    const widget = await db.chatWidget.findUnique({
      where: { id: widgetId },
      select: { brandId: true },
    })
    let brandId = widget?.brandId ?? null
    if (!brandId) {
      const brand = await db.brand.create({
        data: {
          workspaceId,
          name: businessName,
          slug: partnerPortalSlug(businessName, externalId),
        },
        select: { id: true },
      })
      brandId = brand.id
      await db.chatWidget.update({ where: { id: widgetId }, data: { brandId } })
    }

    // ── Portal. Slug is deterministic per install, so a retry finds the
    // half-built portal instead of minting a sibling.
    const slug = partnerPortalSlug(businessName, externalId)
    let portal = await db.portal.findUnique({ where: { slug }, select: { id: true, slug: true } })
    if (!portal) {
      portal = await db.portal.create({
        // reportFrequency stays at its 'weekly' default on purpose: the
        // first report then lands ~day 7, which is the end of the trial —
        // a summary of everything the widget just did, arriving exactly
        // when the customer decides whether to pay.
        data: { name: businessName, slug },
        select: { id: true, slug: true },
      })
    }

    await db.portalBrand.create({ data: { portalId: portal.id, brandId } }).catch((err: unknown) => {
      if ((err as { code?: string })?.code !== 'P2002') throw err
    })

    // ── Invite. Skipped once the customer has accepted (a PortalUser
    // exists); re-provisioning before that rotates the token, which is
    // also how an expired invite gets refreshed.
    const existingUser = await db.portalUser.findUnique({
      where: { portalId_email: { portalId: portal.id, email } },
      select: { id: true },
    })
    if (!existingUser) {
      const rawToken = randomBytes(32).toString('base64url')
      const tokenHash = createHash('sha256').update(rawToken).digest('hex')
      await db.portalInvite.upsert({
        where: { portalId_email: { portalId: portal.id, email } },
        create: {
          portalId: portal.id, email, tokenHash, brandIds: [brandId],
          // No SuperAdmin minted this — the partner API did.
          invitedBy: null,
          expiresAt: new Date(Date.now() + partnerTrialDays() * 86_400_000),
        },
        update: {
          tokenHash, brandIds: [brandId], invitedBy: null, acceptedAt: null,
          expiresAt: new Date(Date.now() + partnerTrialDays() * 86_400_000),
        },
      })

      const baseUrl = (process.env.NEXTAUTH_URL || process.env.NEXT_PUBLIC_APP_URL || 'https://xovera.io').replace(/\/$/, '')
      const { sendPortalInviteEmail } = await import('@/lib/portal-email')
      await sendPortalInviteEmail({
        to: email,
        portalName: businessName,
        inviteUrl: `${baseUrl}/portal/invite/${rawToken}`,
      }).catch((err: unknown) => {
        // The invite row exists, so a re-provision re-sends. Email being
        // down must not fail the install.
        console.warn('[partner] portal invite email failed:', err instanceof Error ? err.message : err)
      })
    }

    return portal.slug
  } catch (err: unknown) {
    console.error('[partner] portal stage failed:', err instanceof Error ? err.message : err)
    return null
  }
}

/**
 * Provision (or return) a partner install. Idempotent on
 * (provider, externalId).
 */
export async function provisionPartnerInstall(
  input: ProvisionPartnerInput,
): Promise<ProvisionedPartnerInstall> {
  const email = input.email.trim().toLowerCase()
  const businessName = input.businessName.trim().slice(0, 120)

  // Resolve the corpus BEFORE creating anything. A misconfigured corpus
  // is the one failure that would otherwise leave a permanently useless
  // account behind.
  const canonicalCollectionId = await resolveCanonicalCollectionId()

  // Claim the (provider, externalId) slot. Two concurrent calls race on
  // the unique constraint; the loser reads the winner's row.
  let install
  try {
    // Fold helpCenterUrl into the stored metadata: it used to be
    // consumed transiently (allowedDomains hostname) and thrown away,
    // which left the admin unlock flow unable to know where the
    // customer's help center lives without asking.
    const metadata = {
      ...((input.metadata as Record<string, unknown> | null) ?? {}),
      ...(input.helpCenterUrl ? { helpCenterUrl: input.helpCenterUrl } : {}),
    }
    install = await db.partnerInstall.create({
      data: {
        provider: input.provider,
        externalId: input.externalId,
        externalEmail: email,
        businessName,
        status: 'provisioning',
        metadata: (Object.keys(metadata).length > 0 ? metadata : undefined) as never,
      },
    })
  } catch (err: unknown) {
    if ((err as { code?: string })?.code !== 'P2002') throw err
    const existing = await db.partnerInstall.findUnique({
      where: { provider_externalId: { provider: input.provider, externalId: input.externalId } },
    })
    if (!existing) throw err
    install = existing
  }

  // Already finished — hand back what we built last time. This is the
  // common path for a partner retrying after a network timeout.
  if (install.status !== 'provisioning' && install.workspaceId && install.agentId && install.widgetId) {
    const widget = await db.chatWidget.findUnique({
      where: { id: install.widgetId },
      select: { id: true, publicKey: true },
    })
    const workspace = await db.workspace.findUnique({
      where: { id: install.workspaceId },
      select: { trialEndsAt: true },
    })
    if (widget) {
      // Runs on the retry path too: installs provisioned before portals
      // existed gain one the next time the partner calls POST.
      const portalSlug = await ensurePortalStage({
        workspaceId: install.workspaceId,
        widgetId: widget.id,
        externalId: input.externalId,
        email,
        businessName: install.businessName || businessName,
      })
      return {
        installId: install.id,
        workspaceId: install.workspaceId,
        agentId: install.agentId,
        widgetId: widget.id,
        widgetPublicKey: widget.publicKey,
        trialEndsAt: workspace?.trialEndsAt ?? null,
        portalSlug,
        created: false,
      }
    }
    // Widget was deleted out from under us — fall through and rebuild it.
  }

  try {
    // ── User. Passwordless; emailVerified is set because the partner
    // vouched for the address. Upsert so a customer who already has a
    // Xovera login keeps it.
    const user = install.userId
      ? await db.user.findUnique({ where: { id: install.userId }, select: { id: true } })
        ?? await upsertUser(email, businessName)
      : await upsertUser(email, businessName)

    // ── Workspace (+ native Location, which Agent.locationId requires).
    let workspaceId = install.workspaceId
    let trialEndsAt: Date | null = null
    if (workspaceId) {
      const existing = await db.workspace.findUnique({
        where: { id: workspaceId }, select: { id: true, trialEndsAt: true },
      })
      if (existing) trialEndsAt = existing.trialEndsAt
      else workspaceId = null
    }
    if (!workspaceId) {
      trialEndsAt = new Date(Date.now() + partnerTrialDays() * 24 * 60 * 60 * 1000)
      const ws = await provisionWorkspace({
        name: businessName,
        ownerUserId: user.id,
        icon: '💬',
        installSource: input.provider,
        plan: 'trial',
        trialEndsAt,
      })
      if (!ws.locationReady) {
        // An agent cannot exist without a Location, so pressing on would
        // produce a workspace the customer can never use.
        throw new ProvisionError(500, 'location_failed',
          'Workspace created but its native CRM location could not be provisioned.')
      }
      workspaceId = ws.id
      await db.partnerInstall.update({
        where: { id: install.id },
        data: { userId: user.id, workspaceId },
      })
    }

    // ── Agent, scoped to the shared corpus. knowledgeScopeAll MUST be
    // false: true means "everything in my workspace", which is nothing
    // here and would leave the agent unable to answer anything.
    let agentId = install.agentId
    if (agentId && !(await db.agent.findUnique({ where: { id: agentId }, select: { id: true } }))) {
      agentId = null
    }
    if (!agentId) {
      const agent = await db.agent.create({
        data: {
          workspaceId,
          locationId: `native:${workspaceId}`,
          name: defaultAgentName(`${businessName} support`),
          systemPrompt: supportPrompt(businessName),
          agentType: 'SIMPLE',
          knowledgeScopeAll: false,
          presetId: 'help_center',
        },
        select: { id: true },
      })
      agentId = agent.id
      await db.agentCollection.create({
        data: { agentId, collectionId: canonicalCollectionId },
      }).catch((err: unknown) => {
        // Already attached (retry) is fine; anything else is not — an
        // agent with no knowledge is the failure this whole flow exists
        // to avoid.
        if ((err as { code?: string })?.code !== 'P2002') throw err
      })
      // Best-effort, matching the agents route: tool config is a
      // refinement, not a precondition for answering.
      await applyPreset(agentId, 'help_center').catch(() => {})
      await db.partnerInstall.update({ where: { id: install.id }, data: { agentId } })
    }

    // ── Widget.
    let widgetId = install.widgetId
    let publicKey: string | null = null
    if (widgetId) {
      const existing = await db.chatWidget.findUnique({
        where: { id: widgetId }, select: { id: true, publicKey: true },
      })
      if (existing) publicKey = existing.publicKey
      else widgetId = null
    }
    if (!widgetId) {
      const host = hostnameOf(input.helpCenterUrl)
      const widget = await db.chatWidget.create({
        data: {
          workspaceId,
          name: input.widget?.name?.trim().slice(0, 80) || `${businessName} help centre`,
          publicKey: generatePublicKey(),
          defaultAgentId: agentId,
          type: 'chat',
          // Empty allowedDomains means "any origin". Seed it from the
          // help-centre host when we know it so a leaked publicKey can't
          // be embedded elsewhere.
          allowedDomains: host ? [host] : [],
          ...(input.widget?.primaryColor ? { primaryColor: input.widget.primaryColor } : {}),
          ...(input.widget?.title ? { title: input.widget.title.slice(0, 120) } : {}),
          ...(input.widget?.subtitle ? { subtitle: input.widget.subtitle.slice(0, 200) } : {}),
          ...(input.widget?.welcomeMessage
            ? { welcomeMessage: input.widget.welcomeMessage.slice(0, 500) }
            : { welcomeMessage: 'Hi! Ask me anything — I can search the help centre for you.' }),
        },
        select: { id: true, publicKey: true },
      })
      widgetId = widget.id
      publicKey = widget.publicKey
    }

    // ── Client portal. The trial includes it in full (CSAT, per-brand
    // AI toggle, query analysis, the weekly report email) — everything
    // except white-label DNS, which stays paid + manual.
    const portalSlug = await ensurePortalStage({
      workspaceId, widgetId, externalId: input.externalId, email, businessName,
    })

    await db.partnerInstall.update({
      where: { id: install.id },
      data: { widgetId, status: 'ready', failureReason: null },
    })

    return {
      installId: install.id,
      workspaceId,
      agentId,
      widgetId,
      widgetPublicKey: publicKey!,
      trialEndsAt,
      portalSlug,
      created: true,
    }
  } catch (err: unknown) {
    // Record why, but leave status at 'provisioning' so a retry resumes
    // instead of being treated as a finished install.
    const message = err instanceof Error ? err.message : String(err)
    await db.partnerInstall.update({
      where: { id: install.id },
      data: { failureReason: message.slice(0, 500) },
    }).catch(() => {})
    throw err
  }
}

async function upsertUser(email: string, businessName: string) {
  return db.user.upsert({
    where: { email },
    create: {
      email,
      name: businessName,
      // The partner authenticated this person before calling us; there
      // is no separate verification step for them to complete.
      emailVerified: new Date(),
    },
    update: {},
    select: { id: true },
  })
}
