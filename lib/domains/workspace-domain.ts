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
import { deriveDomainState, hostAccess, nextLifecycle, type DnsRecord } from './status'
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

  // Attach to Vercel. If the host is ALREADY on our project but has no row
  // (a previous add that died before its DB insert), adopt it instead of
  // reporting it "taken" forever. `weAdded` gates rollback below: never
  // remove a domain we didn't create in this call.
  let weAdded = false
  let state
  try {
    state = await getProjectDomain(v.hostname)
    if (!state) {
      state = await addProjectDomain(v.hostname)
      weAdded = true
    }
  } catch (e) {
    if (e instanceof VercelError) {
      console.error('[domains] vercel add failed', e.code, e.status, e.message)
      const taken = e.code.includes('domain_taken') || e.code.includes('already') || e.status === 409
      throw new DomainError(
        taken ? 'taken' : 'vercel',
        taken
          ? 'That domain is already in use by another account.'
          : "We couldn't set up that domain right now. Please try again, or contact support.",
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
  try {
    const row = await db.workspaceDomain.create({
      data: { workspaceId, hostname: v.hostname, status: derived.status, dnsRecords: derived.dnsRecords as object[], lastCheckedAt: new Date(),
        addedByUs: weAdded, pendingSince: derived.status === 'active' ? null : new Date() },
    })
    invalidateHostCache(v.hostname)
    return view(row)
  } catch (e) {
    // Don't strand the host on our Vercel project with no row pointing at it.
    if (weAdded) await removeProjectDomain(v.hostname).catch(err => console.error('[domains] rollback failed', err))
    if (typeof e === 'object' && e && (e as { code?: string }).code === 'P2002') {
      // Lost a race: another request claimed the hostname or this workspace's single slot.
      throw new DomainError('taken', 'That domain is already in use.')
    }
    throw e
  }
}

/** Re-read Vercel's view and persist it. Safe to call repeatedly. */
export async function refreshWorkspaceDomain(workspaceId: string): Promise<WorkspaceDomainView | null> {
  const row = await db.workspaceDomain.findUnique({
    where: { workspaceId },
    include: { workspace: { select: { whitelabelUnlocked: true } } },
  })
  if (!row) return null
  // Locked workspaces aren't served; don't touch Vercel (a refresh can
  // re-attach a missing domain) until they're unlocked again.
  if (!row.workspace.whitelabelUnlocked) return view(row)

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
    const next = nextLifecycle(row, derived.status, new Date())
    const updated = await db.workspaceDomain.update({
      where: { id: row.id },
      data: {
        status: next.status,
        // Still active but one check failed: keep the records we last showed.
        ...(next.keepRecords ? {} : { dnsRecords: derived.dnsRecords as object[] }),
        pendingSince: next.pendingSince,
        failedChecks: next.failedChecks,
        lastError: next.lastError,
        lastCheckedAt: new Date(),
        verifiedAt: next.status === 'active' ? (row.verifiedAt ?? new Date()) : null,
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
  // Only detach hosts WE attached. An adopted host (addedByUs=false) was on
  // the project before this workspace claimed it — it may be a hand-added
  // portal/partner domain — so we drop our row and leave Vercel alone.
  if (row.addedByUs) await removeProjectDomain(row.hostname)
  await db.workspaceDomain.delete({ where: { id: row.id } })
  invalidateHostCache(row.hostname)
}

// ─── Host → workspace routing ──────────────────────────────────────────

const HOST_TTL_MS = 60_000
interface HostOwner { workspaceId: string; serving: boolean }
const hostCache = new Map<string, { owner: HostOwner | null; at: number }>()
/** Drop cached host lookups (this instance only; others age out within HOST_TTL_MS). */
export function invalidateHostCache(host?: string) { if (host) hostCache.delete(host); else hostCache.clear() }

/** Who (if anyone) has registered this host as a workspace domain. */
async function lookupHostOwner(h: string): Promise<HostOwner | null> {
  const hit = hostCache.get(h)
  if (hit && Date.now() - hit.at < HOST_TTL_MS) return hit.owner
  const row = await db.workspaceDomain.findUnique({
    where: { hostname: h },
    select: { status: true, workspaceId: true, workspace: { select: { whitelabelUnlocked: true } } },
  })
  const owner = row
    ? { workspaceId: row.workspaceId, serving: row.status === 'active' && row.workspace.whitelabelUnlocked }
    : null
  hostCache.set(h, { owner, at: Date.now() })
  return owner
}

/** Workspace that is actively serving on this request host, or null. */
export async function resolveWorkspaceIdForHost(host: string | null | undefined): Promise<string | null> {
  const h = (host || '').toLowerCase().split(':')[0]
  if (!h || isPrimaryHost(h)) return null
  const owner = await lookupHostOwner(h)
  return owner?.serving ? owner.workspaceId : null
}

/**
 * Gate for public (key-authenticated) entry points. Only blocks when the
 * host is REGISTERED as some workspace's domain and this resource isn't
 * served by it (other workspace, still pending, or locked). Primary hosts
 * and unknown hosts (runtime projects, proxies, portal domains) are never
 * blocked here — middleware's allowlist already constrains custom hosts.
 */
export async function hostMayServeWorkspace(host: string | null | undefined, workspaceId: string): Promise<boolean> {
  const h = (host || '').toLowerCase().split(':')[0]
  if (!h || isPrimaryHost(h)) return true
  return hostAccess(await lookupHostOwner(h), workspaceId)
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
