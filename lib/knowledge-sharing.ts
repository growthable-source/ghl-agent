import { randomBytes } from 'crypto'
import { db } from '@/lib/db'

/**
 * Cross-workspace knowledge collection sharing.
 *
 * Two entry points, one engine:
 *  - direct copy — the operator is a member of both workspaces and
 *    picks the destination from a list;
 *  - share code — the operator generates a code/link and someone on a
 *    different account redeems it into their own workspace.
 *
 * Both land in `copyCollectionToWorkspace`, which DUPLICATES the
 * collection and its written entries. Nothing is live-linked: brands,
 * agents and data-source credentials are workspace-local, so a live
 * link would leak edits (and secrets) across account boundaries.
 *
 * Deliberately NOT copied:
 *  - data sources (WorkspaceDataSource) — they carry encrypted
 *    credentials and a per-workspace unique name; the destination has
 *    to connect its own. The count is reported back so the UI can say so.
 *  - agent attachments — the destination picks its own agents.
 *  - brandId — brands don't exist across workspaces.
 */

// Ambiguity-free alphabet (no 0/O/1/I) — these codes get read aloud
// and retyped.
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const CODE_LENGTH = 12

export function generateShareCode(): string {
  const bytes = randomBytes(CODE_LENGTH)
  let out = ''
  for (let i = 0; i < CODE_LENGTH; i++) {
    out += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length]
  }
  // Grouped for readability: XXXX-XXXX-XXXX
  return `${out.slice(0, 4)}-${out.slice(4, 8)}-${out.slice(8, 12)}`
}

/** Accept codes typed with or without dashes, in any case. */
export function normalizeShareCode(raw: string): string {
  const stripped = (raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '')
  if (stripped.length !== CODE_LENGTH) return ''
  return `${stripped.slice(0, 4)}-${stripped.slice(4, 8)}-${stripped.slice(8, 12)}`
}

export type ShareRedemptionError =
  | 'NOT_FOUND'
  | 'REVOKED'
  | 'EXPIRED'
  | 'EXHAUSTED'

export function shareRedemptionError(share: {
  revokedAt: Date | null
  expiresAt: Date | null
  maxUses: number | null
  useCount: number
}): ShareRedemptionError | null {
  if (share.revokedAt) return 'REVOKED'
  if (share.expiresAt && share.expiresAt.getTime() <= Date.now()) return 'EXPIRED'
  if (share.maxUses !== null && share.useCount >= share.maxUses) return 'EXHAUSTED'
  return null
}

export function shareErrorMessage(err: ShareRedemptionError): string {
  switch (err) {
    case 'REVOKED':   return 'This share link has been revoked by the workspace that created it.'
    case 'EXPIRED':   return 'This share link has expired.'
    case 'EXHAUSTED': return 'This share link has already been used the maximum number of times.'
    default:          return 'That share link is not valid.'
  }
}

export interface CopyResult {
  collectionId: string
  name: string
  entryCount: number
  /** Data sources present on the source that were intentionally skipped. */
  skippedDataSourceCount: number
}

/**
 * Pick a collection name that doesn't collide with what the target
 * workspace already has. Collection names aren't DB-unique, but two
 * identically-named collections in one list is a support ticket
 * waiting to happen.
 */
async function uniqueName(targetWorkspaceId: string, desired: string): Promise<string> {
  const base = desired.trim().slice(0, 80) || 'Shared collection'
  const existing = await db.knowledgeCollection.findMany({
    where: { workspaceId: targetWorkspaceId },
    select: { name: true },
  })
  const taken = new Set(existing.map(c => c.name.toLowerCase()))
  if (!taken.has(base.toLowerCase())) return base

  for (let n = 2; n < 100; n++) {
    const suffix = ` (${n})`
    const candidate = `${base.slice(0, 80 - suffix.length)}${suffix}`
    if (!taken.has(candidate.toLowerCase())) return candidate
  }
  return base.slice(0, 74) + ` (${Date.now() % 10000})`
}

export async function copyCollectionToWorkspace(opts: {
  sourceCollectionId: string
  targetWorkspaceId: string
  /** Override the copied collection's name. Falls back to the source name. */
  nameOverride?: string | null
}): Promise<CopyResult | { error: string }> {
  const source = await db.knowledgeCollection.findUnique({
    where: { id: opts.sourceCollectionId },
    include: {
      entries: { orderBy: { createdAt: 'asc' } },
      _count: { select: { dataSources: true } },
    },
  })
  if (!source) return { error: 'Source collection no longer exists.' }

  const name = await uniqueName(
    opts.targetWorkspaceId,
    (opts.nameOverride || '').trim() || source.name,
  )

  // Highest existing order + 1 so the copy lands at the bottom of the
  // destination list rather than fighting for the pinned top slot.
  const last = await db.knowledgeCollection.findFirst({
    where: { workspaceId: opts.targetWorkspaceId },
    orderBy: { order: 'desc' },
    select: { order: true },
  })

  const created = await db.knowledgeCollection.create({
    data: {
      workspaceId: opts.targetWorkspaceId,
      name,
      description: source.description,
      icon: source.icon,
      color: source.color,
      order: (last?.order ?? 0) + 1,
      // brandId deliberately omitted — brands are workspace-local.
    },
  })

  if (source.entries.length > 0) {
    await db.knowledgeEntry.createMany({
      data: source.entries.map(e => ({
        collectionId: created.id,
        workspaceId: opts.targetWorkspaceId,
        // agentId deliberately dropped — the origin agent doesn't
        // exist in the destination workspace.
        title: e.title,
        content: e.content,
        source: e.source,
        sourceUrl: e.sourceUrl,
        tokenEstimate: e.tokenEstimate,
        // Copies are immediately usable: written knowledge is stuffed
        // into the prompt directly, no indexing step to wait on.
        status: 'ready',
        contentHash: e.contentHash,
      })),
    })
  }

  return {
    collectionId: created.id,
    name: created.name,
    entryCount: source.entries.length,
    skippedDataSourceCount: source._count.dataSources,
  }
}
