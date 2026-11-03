/**
 * White-label email sending domain — the DB + Resend orchestration behind
 * the Custom domain page and the domain status cron.
 *
 * The owner types a subdomain (mail.acme.com); we register it on OUR
 * Resend account, store the DNS records Resend wants, and poll until
 * Resend says verified. From then on the workspace's white-label emails
 * (team invites, sign-in codes) send from notifications@<domain>.
 *
 * Invariants:
 *   - One sending domain per workspace; domains are unique across workspaces.
 *   - A domain is USED only when status='verified' AND the workspace is
 *     still unlocked (re-locking stops it without deleting anything).
 *   - Verification is polled (cron + "Re-check"), never assumed.
 */

import { db } from '@/lib/db'
import { PRIMARY_HOSTS } from './primary-hosts'
import { validateWorkspaceDomain } from './hostname'
import {
  createResendDomain,
  deleteResendDomain,
  findResendDomainByName,
  getResendDomain,
  ResendError,
  verifyResendDomain,
  type ResendDomain,
} from './resend-domains'
import { senderAddressFor, sendingDnsRecords, sendingStatusFrom, type SendingDnsRecord } from './sending-status'

export class SendingDomainError extends Error {
  constructor(public code: 'invalid' | 'locked' | 'taken' | 'exists' | 'not_found' | 'resend', message: string) {
    super(message)
    this.name = 'SendingDomainError'
  }
}

export interface SendingDomainView {
  domain: string
  status: string
  dnsRecords: SendingDnsRecord[]
  senderAddress: string
  lastError: string | null
  lastCheckedAt: string | null
}

function view(row: {
  domain: string; status: string; dnsRecords: unknown; lastError: string | null; lastCheckedAt: Date | null
}): SendingDomainView {
  return {
    domain: row.domain,
    status: row.status,
    dnsRecords: Array.isArray(row.dnsRecords) ? (row.dnsRecords as SendingDnsRecord[]) : [],
    senderAddress: senderAddressFor(row.domain),
    lastError: row.lastError,
    lastCheckedAt: row.lastCheckedAt?.toISOString() ?? null,
  }
}

export async function getSendingDomain(workspaceId: string): Promise<SendingDomainView | null> {
  const row = await db.workspaceSendingDomain.findUnique({ where: { workspaceId } })
  return row ? view(row) : null
}

export async function addSendingDomain(workspaceId: string, input: string): Promise<SendingDomainView> {
  const ws = await db.workspace.findUnique({
    where: { id: workspaceId },
    select: { whitelabelUnlocked: true, whitelabelSendingDomain: { select: { id: true } } },
  })
  if (!ws) throw new SendingDomainError('not_found', 'Workspace not found')
  if (!ws.whitelabelUnlocked) {
    throw new SendingDomainError('locked', 'White-labelling is not enabled for this workspace. Contact us to unlock it.')
  }
  if (ws.whitelabelSendingDomain) {
    throw new SendingDomainError('exists', 'This workspace already has a sending domain. Remove it first.')
  }

  const v = validateWorkspaceDomain(input, [...PRIMARY_HOSTS])
  if (!v.ok) throw new SendingDomainError('invalid', v.error.replace('live.acme.com', 'mail.acme.com'))
  if (await db.workspaceSendingDomain.findUnique({ where: { domain: v.hostname }, select: { id: true } })) {
    throw new SendingDomainError('taken', 'That domain is already in use.')
  }

  // Register on Resend. If it's ALREADY on our account with no row (an
  // earlier add that died before its insert), adopt it instead of
  // reporting "taken" forever.
  let created: ResendDomain
  try {
    created = (await findResendDomainByName(v.hostname)) ?? (await createResendDomain(v.hostname))
    if (!created.records) created = await getResendDomain(created.id)
  } catch (e) {
    if (e instanceof ResendError) {
      console.error('[sending-domain] resend add failed', e.status, e.message)
      throw new SendingDomainError('resend', `We couldn't set up that domain right now: ${e.message}`)
    }
    throw e
  }

  try {
    const row = await db.workspaceSendingDomain.create({
      data: {
        workspaceId,
        domain: v.hostname,
        resendDomainId: created.id,
        status: sendingStatusFrom(created.status),
        dnsRecords: sendingDnsRecords(created.records) as object[],
        lastCheckedAt: new Date(),
        verifiedAt: created.status === 'verified' ? new Date() : null,
      },
    })
    return view(row)
  } catch (e) {
    if (typeof e === 'object' && e && (e as { code?: string }).code === 'P2002') {
      throw new SendingDomainError('taken', 'That domain is already in use.')
    }
    throw e
  }
}

/** Ask Resend to re-check, then persist its view. Safe to call repeatedly. */
export async function refreshSendingDomain(workspaceId: string): Promise<SendingDomainView | null> {
  const row = await db.workspaceSendingDomain.findUnique({ where: { workspaceId } })
  if (!row) return null
  try {
    if (row.status !== 'verified') await verifyResendDomain(row.resendDomainId).catch(() => undefined)
    const d = await getResendDomain(row.resendDomainId)
    const status = sendingStatusFrom(d.status)
    const updated = await db.workspaceSendingDomain.update({
      where: { id: row.id },
      data: {
        status,
        dnsRecords: sendingDnsRecords(d.records) as object[],
        lastError: null,
        lastCheckedAt: new Date(),
        verifiedAt: status === 'verified' ? (row.verifiedAt ?? new Date()) : null,
      },
    })
    return view(updated)
  } catch (e) {
    const updated = await db.workspaceSendingDomain.update({
      where: { id: row.id },
      data: { lastError: e instanceof Error ? e.message.slice(0, 500) : 'Check failed', lastCheckedAt: new Date() },
    })
    return view(updated)
  }
}

export async function removeSendingDomain(workspaceId: string): Promise<void> {
  const row = await db.workspaceSendingDomain.findUnique({ where: { workspaceId } })
  if (!row) return
  // Resend first; a 404 there means it's already gone, which is fine.
  await deleteResendDomain(row.resendDomainId).catch(e => {
    if (!(e instanceof ResendError && e.status === 404)) throw e
  })
  await db.workspaceSendingDomain.delete({ where: { id: row.id } })
}

/**
 * The verified sender address for this workspace's white-label emails,
 * or null (not added, not verified yet, or white-label locked) — callers
 * then fall back to our platform sender.
 */
export async function workspaceSenderAddress(workspaceId: string): Promise<string | null> {
  const row = await db.workspaceSendingDomain.findUnique({
    where: { workspaceId },
    select: { domain: true, status: true, workspace: { select: { whitelabelUnlocked: true } } },
  }).catch(() => null) // table not migrated yet → platform sender
  return row && row.status === 'verified' && row.workspace.whitelabelUnlocked ? senderAddressFor(row.domain) : null
}

/**
 * Sender for ANY email a white-label workspace sends (team invites,
 * sign-in codes, ticket replies, CSAT, live-chat transcripts, visitor
 * emails): its brand name on its verified sending domain. Null when the
 * workspace has no verified sending domain (or white-label is locked) —
 * callers keep their normal sender.
 */
export async function brandSender(workspaceId: string): Promise<{ name: string; address: string } | null> {
  const row = await db.workspaceSendingDomain.findUnique({
    where: { workspaceId },
    select: {
      domain: true, status: true,
      workspace: { select: { whitelabelUnlocked: true, whitelabelBrandName: true, name: true } },
    },
  }).catch(() => null) // table not migrated yet → normal sender
  if (!row || row.status !== 'verified' || !row.workspace.whitelabelUnlocked) return null
  return {
    name: row.workspace.whitelabelBrandName?.trim() || row.workspace.name,
    address: senderAddressFor(row.domain),
  }
}
