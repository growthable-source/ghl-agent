import type { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { hashApiKey } from '@/lib/api-key'

export class AuthError extends Error {
  status: number
  code: string
  constructor(status: number, code: string, message: string) {
    super(message)
    this.status = status
    this.code = code
  }
}

export type KeyContext = { scope: 'workspace' | 'org'; workspaceId: string | null; apiKeyId?: string }

/**
 * Pure scope resolver. Given the authenticated key and what the request asked
 * for, returns the effective workspace scope (or null for org-wide endpoints)
 * or throws AuthError.
 */
export function resolveScope(
  key: { scope: 'workspace' | 'org'; workspaceId: string | null },
  opts: { requestedWorkspaceId?: string; orgEndpoint?: boolean }
): { workspaceId: string | null } {
  if (opts.orgEndpoint) {
    if (key.scope !== 'org') throw new AuthError(403, 'forbidden', 'Org-scope key required')
    return { workspaceId: null }
  }
  if (key.scope === 'workspace') {
    if (opts.requestedWorkspaceId && opts.requestedWorkspaceId !== key.workspaceId) {
      throw new AuthError(403, 'forbidden', 'Key is not scoped to that workspace')
    }
    return { workspaceId: key.workspaceId }
  }
  // org key on a per-workspace endpoint
  if (!opts.requestedWorkspaceId) {
    throw new AuthError(422, 'workspace_required', 'workspaceId query param required for org-scope key')
  }
  return { workspaceId: opts.requestedWorkspaceId }
}

/** Verify the Bearer key against the DB. Throws AuthError(401) on failure. */
export async function authenticateApiKey(req: NextRequest): Promise<KeyContext> {
  const header = req.headers.get('authorization') || ''
  const m = header.match(/^Bearer\s+(.+)$/i)
  if (!m) throw new AuthError(401, 'unauthorized', 'Missing Bearer token')
  const hashed = hashApiKey(m[1].trim())
  const row = await db.apiKey.findUnique({ where: { hashedKey: hashed } })
  if (!row || row.revokedAt) throw new AuthError(401, 'unauthorized', 'Invalid API key')
  // best-effort touch; never block
  db.apiKey.update({ where: { id: row.id }, data: { lastUsedAt: new Date() } }).catch(() => {})
  return { scope: row.scope as 'workspace' | 'org', workspaceId: row.workspaceId, apiKeyId: row.id }
}
