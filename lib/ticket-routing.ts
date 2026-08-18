/**
 * Ticket routing — decides which workspace member a NEW ticket lands on.
 *
 * Config lives on the ticket's Brand (Brand.ticketRoutingMode +
 * ticketAssigneeUserId / ticketPoolUserIds / ticketRoutingLastAssignedUserId),
 * with a workspace-level fallback on TicketingSettings
 * (defaultTicketRouting*) for tickets that have no brand — inbound email
 * and co-pilot escalations never do.
 *
 * Modes:
 *  - "manual": no auto-pick — today's behavior, the ticket sits
 *    unassigned until someone claims it.
 *  - "single": every ticket goes to the one designated assignee.
 *  - "pool":   round-robin across the configured pool (empty pool =
 *    all eligible members), cursor in *RoutingLastAssignedUserId.
 *
 * Deliberate divergences from lib/widget-routing.ts (don't "fix" these):
 *  - WorkspaceMember.isAvailable is IGNORED. That flag means "at my desk
 *    for live chat right now"; tickets are async email threads, and
 *    someone at lunch should still receive their brand's tickets.
 *  - No first_available/load-balancing mode — "fewest open tickets" just
 *    rewards whoever resolves slowest.
 *  - No SSE/queue concerns; the caller (lib/ticket-create.ts) owns the
 *    write, the cursor advance, and the assignment notification.
 *
 * Same as widget-routing: viewers are never routed to (read-only role —
 * a ticket assigned to one would strand it), and configured userIds are
 * validated against current workspace membership at pick time, so a
 * departed member degrades to "skip" instead of breaking routing.
 */

import { db } from './db'

export type TicketRoutingMode = 'manual' | 'single' | 'pool'
export type TicketAssignmentReason = 'single' | 'pool_round_robin'

// Which round-robin cursor to advance after the ticket write commits.
// Brand-configured picks advance the brand's cursor; workspace-default
// picks advance the TicketingSettings cursor.
export type TicketRoutingCursor =
  | { kind: 'brand'; brandId: string }
  | { kind: 'workspace' }

export interface TicketRoutingConfig {
  mode: TicketRoutingMode
  singleUserId: string | null
  // Pool mode only. Empty = every eligible member.
  poolUserIds: string[]
  lastAssignedUserId: string | null
}

// Roles that can never be routed a ticket, mirroring NON_CHAT_ROLES in
// lib/widget-routing.ts.
const NON_TICKET_ROLES = new Set(['viewer'])

/**
 * Shared request-body validation for the three surfaces that edit
 * routing config (brand create, brand edit, workspace ticketing
 * settings). Returns canonical values — callers map them onto their own
 * column names (Brand.ticketRouting* vs TicketingSettings
 * defaultTicketRouting*). `memberIds` = current NON-viewer members;
 * configured ids outside that set are rejected rather than silently
 * saved, so a typo'd or stale id can't quietly break the rotation.
 */
export function parseTicketRoutingBody(
  body: { ticketRoutingMode?: unknown; ticketAssigneeUserId?: unknown; ticketPoolUserIds?: unknown },
  memberIds: Set<string>,
):
  | { ok: true; mode?: TicketRoutingMode; assigneeUserId?: string | null; poolUserIds?: string[] }
  | { ok: false; error: string } {
  const out: { ok: true; mode?: TicketRoutingMode; assigneeUserId?: string | null; poolUserIds?: string[] } = { ok: true }

  if (body.ticketRoutingMode !== undefined) {
    if (typeof body.ticketRoutingMode !== 'string' || !['manual', 'single', 'pool'].includes(body.ticketRoutingMode)) {
      return { ok: false, error: 'ticketRoutingMode must be manual, single, or pool.' }
    }
    out.mode = body.ticketRoutingMode as TicketRoutingMode
  }

  if (body.ticketAssigneeUserId === null) {
    out.assigneeUserId = null
  } else if (typeof body.ticketAssigneeUserId === 'string' && body.ticketAssigneeUserId.length > 0) {
    if (!memberIds.has(body.ticketAssigneeUserId)) {
      return { ok: false, error: 'ticketAssigneeUserId is not a non-viewer member of this workspace.' }
    }
    out.assigneeUserId = body.ticketAssigneeUserId
  }

  if (Array.isArray(body.ticketPoolUserIds)) {
    const ids = body.ticketPoolUserIds.filter((id: unknown): id is string => typeof id === 'string' && id.length > 0)
    if (ids.some(id => !memberIds.has(id))) {
      return { ok: false, error: 'ticketPoolUserIds contains users who are not non-viewer members of this workspace.' }
    }
    out.poolUserIds = ids
  }

  return out
}

/** Current non-viewer member ids — the valid universe for routing config. */
export async function loadRoutableMemberIds(workspaceId: string): Promise<Set<string>> {
  const members = await db.workspaceMember.findMany({
    where: { workspaceId, role: { notIn: [...NON_TICKET_ROLES] } },
    select: { userId: true },
  }).catch(() => [] as Array<{ userId: string }>)
  return new Set(members.map(m => m.userId))
}

/**
 * Pure picker — no I/O, unit-tested in lib/ticket-routing.test.ts.
 *
 * `eligibleUserIds` is the pre-validated candidate universe: current
 * workspace members minus excluded roles. Order doesn't matter; the
 * picker sorts internally so round-robin is deterministic across calls.
 * Returns null when the mode is manual or nothing eligible matches the
 * config (single assignee gone, pool entirely stale, …).
 */
export function pickTicketAssignee(
  config: TicketRoutingConfig,
  eligibleUserIds: string[],
): { userId: string; reason: TicketAssignmentReason } | null {
  if (config.mode === 'single') {
    if (config.singleUserId && eligibleUserIds.includes(config.singleUserId)) {
      return { userId: config.singleUserId, reason: 'single' }
    }
    return null
  }

  if (config.mode === 'pool') {
    const pool = config.poolUserIds.length > 0
      ? eligibleUserIds.filter(id => config.poolUserIds.includes(id))
      : [...eligibleUserIds]
    if (pool.length === 0) return null

    // Stable order so the rotation is deterministic across calls. When
    // the cursor user is no longer in the pool, findIndex yields -1 and
    // the rotation restarts from the front — same idiom as
    // lib/widget-routing.ts.
    pool.sort((a, b) => a.localeCompare(b))
    const lastIdx = config.lastAssignedUserId
      ? pool.findIndex(id => id === config.lastAssignedUserId)
      : -1
    return { userId: pool[(lastIdx + 1) % pool.length], reason: 'pool_round_robin' }
  }

  return null
}

/**
 * Load the routing config that applies to a ticket: the brand's when
 * brandId resolves to a live Brand row, else the workspace default from
 * TicketingSettings. Missing rows / pending migrations (P2021 table,
 * P2022 column) degrade to manual — never block ticket creation on
 * routing.
 */
async function loadRoutingConfig(
  workspaceId: string,
  brandId: string | null,
): Promise<{ config: TicketRoutingConfig; cursor: TicketRoutingCursor } | null> {
  if (brandId) {
    try {
      const brand = await db.brand.findFirst({
        where: { id: brandId, workspaceId },
        select: {
          ticketRoutingMode: true,
          ticketAssigneeUserId: true,
          ticketPoolUserIds: true,
          ticketRoutingLastAssignedUserId: true,
        },
      })
      if (brand && brand.ticketRoutingMode !== 'manual') {
        return {
          config: {
            mode: brand.ticketRoutingMode as TicketRoutingMode,
            singleUserId: brand.ticketAssigneeUserId,
            poolUserIds: brand.ticketPoolUserIds ?? [],
            lastAssignedUserId: brand.ticketRoutingLastAssignedUserId,
          },
          cursor: { kind: 'brand', brandId },
        }
      }
      // Brand exists but is manual → respect that; deleted brand
      // (SetNull'd brandId pointing nowhere) → fall through to the
      // workspace default like a brandless ticket.
      if (brand) return null
    } catch (err) {
      if (isMigrationPending(err)) return null
      throw err
    }
  }

  try {
    const settings = await db.ticketingSettings.findUnique({
      where: { workspaceId },
      select: {
        defaultTicketRoutingMode: true,
        defaultTicketAssigneeUserId: true,
        defaultTicketPoolUserIds: true,
        defaultTicketRoutingLastAssignedUserId: true,
      },
    })
    if (!settings || settings.defaultTicketRoutingMode === 'manual') return null
    return {
      config: {
        mode: settings.defaultTicketRoutingMode as TicketRoutingMode,
        singleUserId: settings.defaultTicketAssigneeUserId,
        poolUserIds: settings.defaultTicketPoolUserIds ?? [],
        lastAssignedUserId: settings.defaultTicketRoutingLastAssignedUserId,
      },
      cursor: { kind: 'workspace' },
    }
  } catch (err) {
    if (isMigrationPending(err)) return null
    throw err
  }
}

function isMigrationPending(err: unknown): boolean {
  const e = err as { code?: string; message?: string } | null
  return (
    e?.code === 'P2021' ||
    e?.code === 'P2022' ||
    /column .* does not exist|does not exist in the current database/i.test(e?.message ?? '')
  )
}

/**
 * Resolve who (if anyone) should be auto-assigned a new ticket for
 * `brandId` in `workspaceId`. Returns the pick plus which round-robin
 * cursor the caller must advance IN THE SAME TRANSACTION as the ticket
 * write (only meaningful for pool picks; harmless to skip for single).
 * Null = leave unassigned (manual mode, unset config, stale members,
 * pending migration).
 */
export async function resolveTicketAssignee(
  workspaceId: string,
  brandId: string | null,
): Promise<{ userId: string; reason: TicketAssignmentReason; cursor: TicketRoutingCursor } | null> {
  const loaded = await loadRoutingConfig(workspaceId, brandId)
  if (!loaded) return null

  const members = await db.workspaceMember.findMany({
    where: { workspaceId },
    select: { userId: true, role: true },
  }).catch(() => [] as Array<{ userId: string; role: string }>)
  const eligible = members
    .filter(m => !NON_TICKET_ROLES.has(m.role))
    .map(m => m.userId)

  const pick = pickTicketAssignee(loaded.config, eligible)
  if (!pick) return null
  return { ...pick, cursor: loaded.cursor }
}
