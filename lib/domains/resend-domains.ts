/**
 * Thin Resend REST client for registering customer SENDING domains on
 * OUR Resend account (white-label email). Resend hands back the DNS
 * records the customer must create and later tells us when they verify;
 * the customer never touches Resend.
 *
 * Env: RESEND_API_KEY — must be a FULL-access key (a sending-only key
 * gets 401/403 from /domains). Unconfigured → ResendNotConfiguredError,
 * which routes turn into a clear 503. Failures surface as ResendError
 * with the HTTP status — branch on that, don't parse messages.
 */

const API = 'https://api.resend.com'

export class ResendNotConfiguredError extends Error {
  constructor() {
    super('Email sending domains are not configured on this deployment (missing RESEND_API_KEY).')
    this.name = 'ResendNotConfiguredError'
  }
}

export class ResendError extends Error {
  constructor(message: string, public status: number) {
    super(message)
    this.name = 'ResendError'
  }
}

export interface ResendDnsRecord {
  record: string // 'SPF' | 'DKIM' | 'DMARC' | …
  name: string
  type: string // 'MX' | 'TXT' | 'CNAME'
  value: string
  priority?: number
  status?: string
}

export interface ResendDomain {
  id: string
  name: string
  /** 'not_started' | 'pending' | 'verified' | 'failed' | 'temporary_failure' */
  status: string
  records?: ResendDnsRecord[]
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const key = process.env.RESEND_API_KEY
  if (!key) throw new ResendNotConfiguredError()
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
    cache: 'no-store',
  })
  const text = await res.text()
  if (!res.ok) {
    let message = text.slice(0, 300)
    try { message = (JSON.parse(text) as { message?: string }).message || message } catch { /* raw body */ }
    throw new ResendError(message || `Resend ${res.status}`, res.status)
  }
  return (text ? JSON.parse(text) : {}) as T
}

export function createResendDomain(name: string): Promise<ResendDomain> {
  return call<ResendDomain>('POST', '/domains', { name })
}

export function getResendDomain(id: string): Promise<ResendDomain> {
  return call<ResendDomain>('GET', `/domains/${encodeURIComponent(id)}`)
}

/** Ask Resend to re-check DNS now (async on their side; read status after). */
export async function verifyResendDomain(id: string): Promise<void> {
  await call('POST', `/domains/${encodeURIComponent(id)}/verify`)
}

export async function deleteResendDomain(id: string): Promise<void> {
  await call('DELETE', `/domains/${encodeURIComponent(id)}`)
}

/** Already on our account (e.g. a previous add that died before its DB insert)? */
export async function findResendDomainByName(name: string): Promise<ResendDomain | null> {
  const list = await call<{ data?: ResendDomain[] }>('GET', '/domains')
  return list.data?.find(d => d.name === name) ?? null
}
