/**
 * Pre-signup intent — carries the visitor's CRM choice + business name from
 * the public /start page, through the Google OAuth round-trip, into the
 * post-login onboarding modal (which pre-fills from it instead of asking
 * again). A signed httpOnly cookie; no DB table / migration. The lead
 * itself is also persisted to MarketingLead by the /start endpoint.
 */
import { createHmac, timingSafeEqual } from 'crypto'

export const SIGNUP_INTENT_COOKIE = 'xv_signup_intent'
export const SIGNUP_INTENT_TTL_SECS = 60 * 60 * 2 // 2h — covers OAuth + first onboarding

export type CrmChoice = 'ghl' | 'hubspot' | 'native'
export type SignupIntent = { crm: CrmChoice; email?: string; name?: string; company?: string }

function secret(): string {
  // NextAuth always has one of these set.
  return process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET || ''
}

function hmac(body: string): string {
  return createHmac('sha256', secret()).update(body).digest('base64url')
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a), bb = Buffer.from(b)
  if (ab.length !== bb.length) return false
  return timingSafeEqual(ab, bb)
}

export function signSignupIntent(payload: SignupIntent): string {
  const body = Buffer.from(JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + SIGNUP_INTENT_TTL_SECS })).toString('base64url')
  return `${body}.${hmac(body)}`
}

export function readSignupIntent(token: string | undefined | null): SignupIntent | null {
  if (!token || !secret()) return null
  const dot = token.indexOf('.')
  if (dot <= 0) return null
  const body = token.slice(0, dot)
  if (!safeEqual(token.slice(dot + 1), hmac(body))) return null
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'))
    if (p?.exp && Date.now() / 1000 > p.exp) return null
    if (p.crm !== 'ghl' && p.crm !== 'hubspot' && p.crm !== 'native') return null
    return { crm: p.crm, email: p.email, name: p.name, company: p.company }
  } catch {
    return null
  }
}
