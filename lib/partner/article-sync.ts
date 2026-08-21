/**
 * Help Center article sync — teach a partner-provisioned agent about
 * the CUSTOMER'S OWN help center content.
 *
 * Provisioning attaches every install's agent to one shared canonical
 * corpus (the global GHL help-centre collection) and nothing else —
 * the customer's own articles never reach the agent. This closes that
 * gap by crawling their public help center through the exact pipeline
 * the dashboard's "add knowledge" box uses:
 *
 *   detectUrl → workspace-scoped KnowledgeSource → queued IngestionRun
 *   (the ingest-queue cron claims it within a minute) → chunks land in
 *   a dedicated per-workspace "Help center articles" collection →
 *   an AgentCollection row attaches it ALONGSIDE the canonical corpus
 *   (the agent is knowledgeScopeAll:false, so attachment is explicit).
 *
 * Idempotent: re-running re-crawls (same re-check semantics as pasting
 * a URL twice into the knowledge box) instead of duplicating anything.
 * Currently invoked from the super-admin unlock flow; safe to reuse
 * from a future partner-facing endpoint or a recrawl cron.
 */

import { db } from '@/lib/db'
import { detectUrl } from '@/lib/ingest/detect'
import { resolveIngestTarget } from '@/lib/knowledge/default-collection'

export const HELP_CENTER_COLLECTION_NAME = 'Help center articles'

export interface ArticleSyncResult {
  collectionId: string
  sourceId: string
  runId: string
  alreadyExisted: boolean
  detected: string
}

export async function syncHelpCenterArticles(params: {
  workspaceId: string
  agentId: string
  url: string
}): Promise<ArticleSyncResult> {
  let parsed: URL
  try {
    parsed = new URL(params.url.startsWith('http') ? params.url : `https://${params.url}`)
  } catch {
    throw new Error(`"${params.url}" is not a valid help center URL.`)
  }
  const normalizedUrl = parsed.toString()

  // Dedicated collection so the customer's articles stay distinguishable
  // from the canonical corpus (and deletable without touching it).
  const collection =
    (await db.knowledgeCollection.findFirst({
      where: { workspaceId: params.workspaceId, name: HELP_CENTER_COLLECTION_NAME },
      select: { id: true },
    })) ??
    (await db.knowledgeCollection.create({
      data: {
        workspaceId: params.workspaceId,
        name: HELP_CENTER_COLLECTION_NAME,
        description: 'Crawled from this customer\'s own help center. Synced by the unlock flow.',
        icon: '📖',
        color: '#3b82f6',
      },
      select: { id: true },
    }))

  const target = await resolveIngestTarget(params.workspaceId, collection.id)
  if (!target) throw new Error('Help center collection resolution failed.')

  const detection = await detectUrl(normalizedUrl)

  // Same dedupe semantics as the knowledge/add route: re-adding the
  // same URL to the same collection re-checks it, never duplicates.
  const existing = await db.knowledgeSource.findFirst({
    where: {
      domain: { workspaceId: params.workspaceId },
      urlOrIdentifier: normalizedUrl,
      collectionId: target.collectionId,
    },
    select: { id: true },
  })
  const source =
    existing ??
    (await db.knowledgeSource.create({
      data: {
        knowledgeDomainId: target.knowledgeDomainId,
        collectionId: target.collectionId,
        sourceType: detection.sourceType,
        urlOrIdentifier: normalizedUrl,
        crawlConfig: detection.crawlConfig as object,
        isActive: true,
      },
      select: { id: true },
    }))

  const pending = await db.ingestionRun.findFirst({
    where: { sourceId: source.id, status: { in: ['queued', 'running'] } },
    select: { id: true },
  })
  const run =
    pending ??
    (await db.ingestionRun.create({ data: { sourceId: source.id, status: 'queued' }, select: { id: true } }))

  // Attach the collection to the install's agent alongside the
  // canonical corpus. Upsert on the (agentId, collectionId) unique.
  await db.agentCollection.upsert({
    where: { agentId_collectionId: { agentId: params.agentId, collectionId: target.collectionId } },
    create: { agentId: params.agentId, collectionId: target.collectionId },
    update: {},
  })

  return {
    collectionId: target.collectionId,
    sourceId: source.id,
    runId: run.id,
    alreadyExisted: !!existing,
    detected: detection.kind,
  }
}

/**
 * Re-crawl a help center's already-synced articles, on demand — the
 * push-on-publish path. Finds the workspace's "Help center articles"
 * collection and its active sources, and enqueues a FORCED IngestionRun
 * for each (force so EDITS to existing article pages are re-fetched, not
 * just brand-new URLs). Deduped against a queued/running run so repeated
 * pushes coalesce. Returns how many runs it queued; 0 = nothing synced
 * for this workspace yet (they were never unlocked with articles).
 */
export async function refreshHelpCenterArticles(workspaceId: string): Promise<{ queued: number; sources: number }> {
  const collection = await db.knowledgeCollection.findFirst({
    where: { workspaceId, name: HELP_CENTER_COLLECTION_NAME },
    select: { id: true },
  })
  if (!collection) return { queued: 0, sources: 0 }

  const sources = await db.knowledgeSource.findMany({
    where: { collectionId: collection.id, domain: { workspaceId }, isActive: true },
    select: { id: true },
  })

  let queued = 0
  for (const source of sources) {
    const pending = await db.ingestionRun.findFirst({
      where: { sourceId: source.id, status: { in: ['queued', 'running'] } },
      select: { id: true },
    })
    if (pending) continue
    await db.ingestionRun.create({ data: { sourceId: source.id, status: 'queued', force: true } })
    queued++
  }
  return { queued, sources: sources.length }
}
