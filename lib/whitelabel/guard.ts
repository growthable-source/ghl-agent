/**
 * Server-side checks shared by every workspace access guard
 * (requireWorkspaceAccess, requireWorkspaceRole, the workspace layout).
 *
 *   1. Host binding. On a white-label domain only THAT domain's workspace
 *      is reachable. A team member who also belongs to other workspaces
 *      can't open them through the customer's domain, and a portal
 *      domain (custom host, no workspace) reaches no workspace at all.
 *   2. Support Agent allowlist (./access-policy.ts), keyed on the signed
 *      request path middleware forwards (./request-path.ts). An agent
 *      with no verifiable path is denied — fail closed.
 */

import { headers } from 'next/headers'
import { isPrimaryHost } from '@/lib/domains/primary-hosts'
import { resolveWorkspaceIdForHost } from '@/lib/domains/workspace-domain'
import { agentMayCallApi, agentMayOpenPage } from './access-policy'
import { previewWorkspaceId } from './preview'
import { METHOD_HEADER, PATH_HEADER, SIG_HEADER, requestPathSecret, verifyRequestPath } from './request-path'

export const AGENT_DENIED_MESSAGE = 'Support agents can only use the inbox and tickets.'

async function readHeaders() {
  try {
    return await headers()
  } catch {
    return null // outside a request scope (scripts, cron helpers)
  }
}

/** The request's bare host, lowercased, or null. */
export async function requestHost(): Promise<string | null> {
  const h = await readHeaders()
  const host = (h?.get('host') || '').toLowerCase().split(':')[0]
  return host || null
}

/**
 * null on our own hosts. On a custom host: the workspace it serves, or
 * '' when it serves none (portal domain, pending/locked domain). In
 * white-label test mode (./preview.ts, non-production only) our own host
 * acts as the test workspace's domain.
 */
export async function customHostWorkspaceId(): Promise<string | null> {
  const host = await requestHost()
  if (!host || isPrimaryHost(host)) return previewWorkspaceId()
  return (await resolveWorkspaceIdForHost(host)) ?? ''
}

/** False when the request came in on a custom host that doesn't serve `workspaceId`. */
export async function hostServesWorkspace(workspaceId: string): Promise<boolean> {
  const bound = await customHostWorkspaceId()
  return bound === null || bound === workspaceId
}

/** The path + method middleware signed for this request, or null when absent/forged. */
export async function verifiedRequestPath(): Promise<{ path: string; method: string } | null> {
  const h = await readHeaders()
  if (!h) return null
  const path = h.get(PATH_HEADER)
  const method = h.get(METHOD_HEADER)
  const ok = await verifyRequestPath(path, method, h.get(SIG_HEADER), requestPathSecret())
  return ok && path && method ? { path, method } : null
}

/** True when a Support Agent may make this API call. */
export async function agentApiAllowed(): Promise<boolean> {
  const req = await verifiedRequestPath()
  return !!req && agentMayCallApi(req.path, req.method)
}

/** True when a Support Agent may render this dashboard page. */
export async function agentPageAllowed(): Promise<boolean> {
  const req = await verifiedRequestPath()
  return !!req && agentMayOpenPage(req.path)
}
