/**
 * Signed request path, passed from middleware to route handlers.
 *
 * Route handlers and server components can't see their own URL through
 * headers(), but the central access guards (requireWorkspaceAccess and
 * friends, called from ~200 routes) need it to apply the Support Agent
 * allowlist (./access-policy.ts). Middleware therefore stamps the
 * pathname + method onto the forwarded request.
 *
 * Signed, not trusted: middleware only runs on part of the primary host's
 * paths, so on the rest a client could send these headers itself and
 * claim to be calling an allowed route. The HMAC (keyed on AUTH_SECRET,
 * which the client never has) makes a forged or replayed-onto-another-
 * path header fail verification. Callers treat "no valid header" as
 * "unknown path" — for an agent that means deny.
 *
 * WebCrypto only, so the same code runs in Edge middleware and Node.
 */

export const PATH_HEADER = 'x-xv-path'
export const METHOD_HEADER = 'x-xv-method'
export const SIG_HEADER = 'x-xv-path-sig'

const enc = new TextEncoder()

async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(message)))
  return Array.from(sig, b => b.toString(16).padStart(2, '0')).join('')
}

function payload(path: string, method: string): string {
  return `${method.toUpperCase()} ${path}`
}

export async function signRequestPath(path: string, method: string, secret: string): Promise<string> {
  return hmacHex(secret, payload(path, method))
}

/** Constant-time compare of two hex strings. */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

export async function verifyRequestPath(
  path: string | null | undefined,
  method: string | null | undefined,
  sig: string | null | undefined,
  secret: string | null | undefined,
): Promise<boolean> {
  if (!path || !method || !sig || !secret) return false
  return safeEqual(await signRequestPath(path, method, secret), sig)
}

/** The secret both sides use. Undefined → signing is skipped and agents fail closed. */
export function requestPathSecret(): string | undefined {
  return process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET || undefined
}
