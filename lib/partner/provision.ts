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

import { db } from '@/lib/db'
import { provisionWorkspace } from '@/lib/provision-workspace'
import { generatePublicKey } from '@/lib/widget-auth'
import { defaultAgentName } from '@/lib/random-name'
import { applyPreset } from '@/lib/agent/presets'
import { globalCollectionsReady } from '@/lib/knowledge/migration-state'

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
  /** False when the install already existed — the caller retried. */
  created: boolean
}

export class ProvisionError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message)
    this.name = 'ProvisionError'
  }
}

/** Trial length for partner-provisioned workspaces. */
export function partnerTrialDays(): number {
  const raw = Number(process.env.PARTNER_TRIAL_DAYS)
  return Number.isFinite(raw) && raw > 0 && raw <= 365 ? Math.floor(raw) : 14
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
    install = await db.partnerInstall.create({
      data: {
        provider: input.provider,
        externalId: input.externalId,
        externalEmail: email,
        businessName,
        status: 'provisioning',
        metadata: (input.metadata ?? undefined) as never,
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
      return {
        installId: install.id,
        workspaceId: install.workspaceId,
        agentId: install.agentId,
        widgetId: widget.id,
        widgetPublicKey: widget.publicKey,
        trialEndsAt: workspace?.trialEndsAt ?? null,
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
