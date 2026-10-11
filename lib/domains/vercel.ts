/**
 * Thin Vercel REST client for attaching customer hostnames to OUR
 * project. Vercel terminates TLS (auto-issues the cert once DNS points
 * at it) and routes the host to this deployment; the app then resolves
 * host → workspace itself (lib/domains/workspace-domain.ts).
 *
 * Env: DOMAINS_VERCEL_TOKEN, DOMAINS_VERCEL_PROJECT_ID, optional DOMAINS_VERCEL_TEAM_ID.
 * Unconfigured → VercelNotConfiguredError, which routes turn into a clear
 * 503 rather than a stack trace. Failures surface as typed VercelError
 * with a stable `.code` — branch on that, don't parse messages.
 */

const API = 'https://api.vercel.com'

export class VercelNotConfiguredError extends Error {
  constructor() {
    super('Custom domains are not configured on this deployment (missing DOMAINS_VERCEL_TOKEN / DOMAINS_VERCEL_PROJECT_ID).')
    this.name = 'VercelNotConfiguredError'
  }
}

export class VercelError extends Error {
  constructor(public code: string, message: string, public status: number) {
    super(message)
    this.name = 'VercelError'
  }
}

export interface VercelVerificationRecord {
  type: string
  domain: string
  value: string
  reason?: string
}

export interface VercelDomainState {
  name: string
  verified: boolean
  verification: VercelVerificationRecord[]
}

export function isVercelDomainsConfigured(): boolean {
  return !!(process.env.DOMAINS_VERCEL_TOKEN && process.env.DOMAINS_VERCEL_PROJECT_ID)
}

function qs(): string {
  const team = process.env.DOMAINS_VERCEL_TEAM_ID
  return team ? `?teamId=${encodeURIComponent(team)}` : ''
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const token = process.env.DOMAINS_VERCEL_TOKEN
  const project = process.env.DOMAINS_VERCEL_PROJECT_ID
  if (!token || !project) throw new VercelNotConfiguredError()

  const res = await fetch(`${API}${path.replace('{project}', encodeURIComponent(project))}${qs()}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
    cache: 'no-store',
  })
  const json = (await res.json().catch(() => ({}))) as { error?: { code?: string; message?: string } } & T
  if (!res.ok) {
    throw new VercelError(json.error?.code ?? `http_${res.status}`, json.error?.message ?? 'Vercel API error', res.status)
  }
  return json
}

function toState(r: { name: string; verified?: boolean; verification?: VercelVerificationRecord[] }): VercelDomainState {
  return { name: r.name, verified: !!r.verified, verification: r.verification ?? [] }
}

export async function addProjectDomain(hostname: string): Promise<VercelDomainState> {
  return toState(await call('POST', '/v10/projects/{project}/domains', { name: hostname }))
}

export async function getProjectDomain(hostname: string): Promise<VercelDomainState | null> {
  try {
    return toState(await call('GET', `/v9/projects/{project}/domains/${encodeURIComponent(hostname)}`))
  } catch (e) {
    if (e instanceof VercelError && e.status === 404) return null
    throw e
  }
}

/** Ask Vercel to re-run ownership verification (TXT challenge), if needed. */
export async function verifyProjectDomain(hostname: string): Promise<VercelDomainState> {
  return toState(await call('POST', `/v9/projects/{project}/domains/${encodeURIComponent(hostname)}/verify`))
}

/** True when the host's DNS does NOT yet resolve to Vercel. */
export async function isDomainMisconfigured(hostname: string): Promise<boolean> {
  const r = await call<{ misconfigured?: boolean }>('GET', `/v6/domains/${encodeURIComponent(hostname)}/config`)
  return r.misconfigured !== false
}

export async function removeProjectDomain(hostname: string): Promise<void> {
  try {
    await call('DELETE', `/v9/projects/{project}/domains/${encodeURIComponent(hostname)}`)
  } catch (e) {
    if (e instanceof VercelError && e.status === 404) return // already gone
    throw e
  }
}
