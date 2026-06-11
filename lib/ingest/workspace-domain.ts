/**
 * Default knowledge domain per workspace.
 *
 * The simple "paste any link" flow shouldn't make users invent a
 * "domain" before they can add knowledge — that concept is the main
 * thing operators called overly technical. Sources added through the
 * simple flow land in one auto-created workspace domain; retrieval is
 * workspace-scoped anyway (agents with empty knowledgeDomainIds read
 * everything), so this is invisible until someone deliberately opens
 * the advanced surface to partition knowledge.
 */

import { db } from '@/lib/db'

const DEFAULT_DOMAIN_NAME = 'Workspace knowledge'

export async function getOrCreateWorkspaceDomain(workspaceId: string): Promise<{ id: string }> {
  const existing = await db.knowledgeDomain.findFirst({
    where: { workspaceId, name: DEFAULT_DOMAIN_NAME },
    select: { id: true },
  })
  if (existing) return existing

  // Fall back to ANY existing domain before creating — workspaces that
  // already use the advanced surface shouldn't grow a second container
  // just because someone used the simple box.
  const any = await db.knowledgeDomain.findFirst({
    where: { workspaceId },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  })
  if (any) return any

  return db.knowledgeDomain.create({
    data: {
      workspaceId,
      name: DEFAULT_DOMAIN_NAME,
      description: 'Everything added through the Knowledge page. All agents read this by default.',
    },
    select: { id: true },
  })
}
