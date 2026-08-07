/**
 * Workspace creation, in one place.
 *
 * Three call sites need to conjure a workspace out of nothing: the
 * dashboard's POST /api/workspaces, the /try demo claim, and the partner
 * provisioning API. They'd each grown their own copy, and the copies had
 * already started to drift.
 *
 * The part that MUST NOT be forgotten is the native `Location` bootstrap
 * at the bottom. `Agent.locationId` is a required FK, so a workspace
 * without a Location can't hold an agent at all — the operator lands on
 * "Connect your CRM" with no way forward unless they happen to know
 * about the Integrations switch. Native is reversible, so it's the right
 * default rather than a lock-in.
 */

import { db } from '@/lib/db'

export interface ProvisionWorkspaceInput {
  name: string
  /** Becomes the workspace owner. Must already exist. */
  ownerUserId: string
  icon?: string
  /** Same-domain invite gating. Null/omitted = no restriction. */
  domain?: string | null
  /** Attribution: 'direct' | 'help_center' | 'ghl_marketplace' | … */
  installSource?: string
  plan?: string
  /** Null = no trial (already paid). Omitted = the standard 7-day trial. */
  trialEndsAt?: Date | null
}

export interface ProvisionedWorkspace {
  id: string
  name: string
  slug: string
  /** False when the native Location couldn't be created — the workspace
   *  exists but can't hold an agent yet. Callers that go on to create an
   *  agent must treat this as fatal rather than pressing on. */
  locationReady: boolean
}

const DEFAULT_TRIAL_MS = 7 * 24 * 60 * 60 * 1000

/** URL-safe slug with a random suffix. Collisions are theoretically
 *  possible; the unique constraint is the real guard and the caller
 *  retries. */
export function workspaceSlug(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40)
  const suffix = Math.random().toString(36).slice(2, 8)
  return `${base || 'workspace'}-${suffix}`
}

/**
 * Create a workspace with its owner membership and native CRM Location.
 *
 * Throws on workspace-creation failure (the caller has nothing useful to
 * do with a half-made account). A failed Location comes back as
 * `locationReady: false` instead, because for the dashboard path the
 * workspace is still usable — only agent creation is blocked.
 */
export async function provisionWorkspace(
  input: ProvisionWorkspaceInput,
): Promise<ProvisionedWorkspace> {
  const trialEndsAt = input.trialEndsAt === undefined
    ? new Date(Date.now() + DEFAULT_TRIAL_MS)
    : input.trialEndsAt

  const base = {
    name: input.name,
    slug: workspaceSlug(input.name),
    icon: input.icon ?? '🚀',
    domain: input.domain ?? null,
    plan: input.plan ?? 'trial',
    trialEndsAt,
    members: { create: { userId: input.ownerUserId, role: 'owner' } },
  }
  const select = { id: true, name: true, slug: true }

  let workspace
  try {
    workspace = await db.workspace.create({
      data: {
        ...base,
        installSource: input.installSource ?? 'direct',
        // Native is the right default because we auto-provision a
        // native:<wsId> Location immediately below.
        primaryCrmProvider: 'native',
      },
      select,
    })
  } catch (err: unknown) {
    // Only swallow "that column doesn't exist yet" — a unique-slug
    // collision or FK violation must surface, not get reclassified as
    // migration-pending and silently retried into a worse error.
    const code = (err as { code?: string })?.code
    if (code !== 'P2022' && code !== 'P2021') throw err
    workspace = await db.workspace.create({ data: base, select })
  }

  const locationReady = await ensureNativeLocation(workspace.id)
  return { ...workspace, locationReady }
}

/**
 * Idempotent native-CRM Location bootstrap. The sentinel token values
 * are deliberate: this row exists to satisfy `Agent.locationId`, and
 * nothing ever presents these to a real CRM.
 *
 * Returns false rather than throwing so the dashboard path can degrade
 * (workspace usable, agent creation blocked) instead of 500-ing.
 */
export async function ensureNativeLocation(workspaceId: string): Promise<boolean> {
  const id = `native:${workspaceId}`
  try {
    const existing = await db.location.findUnique({ where: { id }, select: { id: true } })
    if (existing) return true
    await db.location.create({
      data: {
        id,
        workspaceId,
        companyId: 'native',
        userId: 'native',
        userType: 'Location',
        scope: 'native',
        accessToken: 'native',
        refreshToken: 'native',
        refreshTokenId: 'native',
        expiresAt: new Date('2099-12-31T23:59:59.000Z'),
        crmProvider: 'native',
      },
    })
    return true
  } catch (err: unknown) {
    // P2002 = someone else won the race; the row is there either way.
    if ((err as { code?: string })?.code === 'P2002') return true
    console.warn(
      '[provisionWorkspace] native Location bootstrap failed (non-fatal):',
      err instanceof Error ? err.message : String(err),
    )
    return false
  }
}
