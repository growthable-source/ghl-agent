/**
 * Workspace white-label domain service — the DB + Vercel orchestration
 * behind the settings UI, the status cron, and host → workspace routing.
 *
 * Invariants:
 *   - A domain is SERVED only when status='active' AND the workspace is
 *     still unlocked (admin can re-lock to stop serving without deleting).
 *   - Hostnames are unique across WorkspaceDomain AND Portal.customDomain
 *     (one host, one owner — the middleware treats both as custom hosts).
 *   - The pending → active transition is polled (cron + "Re-check"), never
 *     assumed: Vercel only issues a cert after DNS is correct.
 */

import { db } from '@/lib/db'
import { isPrimaryHost, PRIMARY_HOSTS } from './primary-hosts'
import { validateWorkspaceDomain } from './hostname'
import { deriveDomainState, type DnsRecord } from './status'
import {
  addProjectDomain,
  getProjectDomain,
  isDomainMisconfigured,
  removeProjectDomain,
  verifyProjectDomain,
  VercelError,
} from './vercel'

export class DomainError extends Error {
  constructor(public code: 'invalid' | 'locked' | 'taken' | 'exists' | 'not_found' | 'vercel', message: string) {
    super(message)
    this.name = 'DomainError'
  }
}

const cnameTarget = () => process.env.DOMAINS_CNAME_TARGET || undefined

export interface WorkspaceDomainView {
  hostname: string
  status: string
  dnsRecords: DnsRecord[]
  lastError: string | null
  lastCheckedAt: string | null
}

function view(row: {
  hostname: string; status: string; dnsRecords: unknown; lastError: string | null; lastCheckedAt: Date | null
}): WorkspaceDomainView {
  return {
    hostname: row.hostname,
    status: row.status,
    dnsRecords: Array.isArray(row.dnsRecords) ? (row.dnsRecords as DnsRecord[]) : [],
    lastError: row.lastError,
    lastCheckedAt: row.lastCheckedAt?.toISOString() ?? null,
  }
}

export async function getWorkspaceDomainState(workspaceId: string) {
  const ws = await db.workspace.findUnique({
    where: { id: workspaceId },
    select: { whitelabelUnlocked: true, whitelabelDomain: true },
  })
  return {
    unlocked: !!ws?.whitelabelUnlocked,
    domain: ws?.whitelabelDomain ? view(ws.whitelabelDomain) : null,
  }
}

export async function addWorkspaceDomain(workspaceId: string, input: string): Promise<WorkspaceDomainView> {
  const ws = await db.workspace.findUnique({
    where: { id: workspaceId },
    select: { whitelabelUnlocked: true, whitelabelDomain: { select: { id: true } } },
  })
  if (!ws) throw new DomainError('not_found', 'Workspace not found')
  if (!ws.whitelabelUnlocked) {
    throw new DomainError('locked', 'Custom domains are not enabled for this workspace. Contact us to unlock them.')
  }
  if (ws.whitelabelDomain) throw new DomainError('exists', 'This workspace already has a custom domain. Remove it first.')

  const v = validateWorkspaceDomain(input, [...PRIMARY_HOSTS])
  if (!v.ok) throw new DomainError('invalid', v.error)

  const [wsTaken, portalTaken] = await Promise.all([
    db.workspaceDomain.findUnique({ where: { hostname: v.hostname }, select: { id: true } }),
    db.portal.findUnique({ where: { customDomain: v.hostname }, select: { id: true } }),
  ])
  if (wsTaken || portalTaken) throw new DomainError('taken', 'That domain is already in use.')

  let state
  try {
    state = await addProjectDomain(v.hostname)
  } catch (e) {
    if (e instanceof VercelError) {
      throw new DomainError(
        e.code.includes('domain_taken') || e.code.includes('already') ? 'taken' : 'vercel',
        e.message,
      )
    }
    throw e
  }

  const derived = deriveDomainState({
    hostname: v.hostname,
    verified: state.verified,
    misconfigured: true, // freshly added: DNS can't be pointed yet
    verification: state.verification,
    cnameTarget: cnameTarget(),
  })
  const row = await db.workspaceDomain.create({
    data: { workspaceId, hostname: v.hostname, status: derived.status, dnsRecords: derived.dnsRecords as object[], lastCheckedAt: new Date() },
  })
  return view(row)
}

/** Re-read Vercel's view and persist it. Safe to call repeatedly. */
export async function refreshWorkspaceDomain(workspaceId: string): Promise<WorkspaceDomainView | null> {
  const row = await db.workspaceDomain.findUnique({ where: { workspaceId } })
  if (!row) return null

  try {
    let state = await getProjectDomain(row.hostname)
    if (!state) {
      // Dropped from Vercel out-of-band — re-attach rather than strand the customer.
      state = await addProjectDomain(row.hostname)
    } else if (!state.verified) {
      state = await verifyProjectDomain(row.hostname).catch(() => state!)
    }
    const misconfigured = await isDomainMisconfigured(row.hostname)
    const derived = deriveDomainState({
      hostname: row.hostname,
      verified: state.verified,
      misconfigured,
      verification: state.verification,
      cnameTarget: cnameTarget(),
    })
    const updated = await db.workspaceDomain.update({
      where: { id: row.id },
      data: {
        status: derived.status,
        dnsRecords: derived.dnsRecords as object[],
        lastError: null,
        lastCheckedAt: new Date(),
        verifiedAt: derived.status === 'active' ? (row.verifiedAt ?? new Date()) : null,
      },
    })
    invalidateHostCache(row.hostname)
    return view(updated)
  } catch (e) {
    const updated = await db.workspaceDomain.update({
      where: { id: row.id },
      data: { lastError: e instanceof Error ? e.message.slice(0, 500) : 'Check failed', lastCheckedAt: new Date() },
    })
    return view(updated)
  }
}

export async function removeWorkspaceDomain(workspaceId: string): Promise<void> {
  const row = await db.workspaceDomain.findUnique({ where: { workspaceId } })
  if (!row) return
  // Vercel first: if it fails we keep the row so the operator can retry,
  // instead of orphaning a host on our project with no record of it.
  await removeProjectDomain(row.hostname)
  await db.workspaceDomain.delete({ where: { id: row.id } })
  invalidateHostCache(row.hostname)
}

// ─── Host → workspace routing ──────────────────────────────────────────

const HOST_TTL_MS = 60_000
const hostCache = new Map<string, { workspaceId: string | null; at: number }>()
function invalidateHostCache(host: string) { hostCache.delete(host) }

/** Workspace that owns this request host, or null (primary host / unknown / not serving). */
export async function resolveWorkspaceIdForHost(host: string | null | undefined): Promise<string | null> {
  const h = (host || '').toLowerCase().split(':')[0]
  if (!h || isPrimaryHost(h)) return null
  const hit = hostCache.get(h)
  if (hit && Date.now() - hit.at < HOST_TTL_MS) return hit.workspaceId

  const row = await db.workspaceDomain.findUnique({
    where: { hostname: h },
    select: { status: true, workspaceId: true, workspace: { select: { whitelabelUnlocked: true } } },
  })
  const workspaceId = row && row.status === 'active' && row.workspace.whitelabelUnlocked ? row.workspaceId : null
  hostCache.set(h, { workspaceId, at: Date.now() })
  return workspaceId
}

/**
 * Gate for public (key-authenticated) entry points: on the primary host
 * anything goes; on a workspace custom host the resource must belong to
 * THAT workspace, so one tenant's domain can't front another's agent.
 * Portal custom domains never serve these surfaces.
 */
export async function hostMayServeWorkspace(host: string | null | undefined, workspaceId: string): Promise<boolean> {
  const h = (host || '').toLowerCase().split(':')[0]
  if (!h || isPrimaryHost(h)) return true
  return (await resolveWorkspaceIdForHost(h)) === workspaceId
}

/** Origin used when generating shareable links/snippets for this workspace. */
export async function getWorkspacePublicOrigin(workspaceId: string, fallbackOrigin: string): Promise<string> {
  const row = await db.workspaceDomain.findUnique({
    where: { workspaceId },
    select: { hostname: true, status: true, workspace: { select: { whitelabelUnlocked: true } } },
  })
  return row && row.status === 'active' && row.workspace.whitelabelUnlocked
    ? `https://${row.hostname}`
    : fallbackOrigin
}
