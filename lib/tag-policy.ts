/**
 * Tag application policy for agent-initiated tag operations.
 *
 * Rule: the LLM cannot invent tags. Every tag added via `update_contact_tags`,
 * `detect_sentiment`, `score_lead`, or `transfer_to_human` is filtered
 * against the GHL location's existing tag set. Unknown tags are dropped
 * with a log line so operators see exactly what was attempted.
 *
 * User-configured tag writes (detection rules, stop conditions,
 * `update_contact_tags` invoked with an explicit tag list via a rule's
 * actionParams) still go through `crm.addTags` directly — they represent
 * operator intent and are allowed to create tags on the fly.
 *
 * Caching: `getTags()` is called at most once per request, keyed by
 * locationId. A short-lived in-memory map is fine because agent turns are
 * one request each; we don't need cross-request memory here.
 */

import type { CrmAdapter } from './crm/types'

interface WithGetTags {
  getTags?: () => Promise<Array<{ id: string; name: string }>>
  addTags: CrmAdapter['addTags']
}

// Per-request memoisation keyed by the adapter instance. Cleared on GC
// naturally — adapters are created per-turn.
const existingTagCache = new WeakMap<object, Promise<Set<string>>>()

async function loadExistingTags(adapter: WithGetTags): Promise<Set<string>> {
  const cached = existingTagCache.get(adapter as object)
  if (cached) return cached
  const promise = (async () => {
    try {
      const tags = typeof adapter.getTags === 'function' ? await adapter.getTags() : []
      return new Set(tags.map(t => (t.name ?? '').toLowerCase()))
    } catch (err) {
      console.warn('[TagPolicy] getTags failed — nothing will be added:', err)
      return new Set<string>()
    }
  })()
  existingTagCache.set(adapter as object, promise)
  return promise
}

/**
 * Add only the subset of `requested` tags that already exist on the
 * location. Returns both the applied set and the dropped set so callers
 * can surface the decision to the LLM or operator.
 */
export async function addExistingTagsOnly(
  adapter: WithGetTags,
  contactId: string,
  requested: string[],
): Promise<{ applied: string[]; dropped: string[] }> {
  const wanted = Array.from(new Set(
    requested.map(t => (t ?? '').trim()).filter(t => t.length > 0),
  ))
  if (wanted.length === 0) return { applied: [], dropped: [] }

  const existing = await loadExistingTags(adapter)
  const applied: string[] = []
  const dropped: string[] = []
  for (const t of wanted) {
    if (existing.has(t.toLowerCase())) applied.push(t)
    else dropped.push(t)
  }

  if (applied.length > 0) {
    try {
      await adapter.addTags(contactId, applied)
    } catch (err: any) {
      console.warn(`[TagPolicy] addTags partial failure for contact ${contactId}:`, err?.message ?? err)
    }
  }
  if (dropped.length > 0) {
    console.log(`[TagPolicy] Dropped ${dropped.length} non-existing tag(s) for contact ${contactId}: ${dropped.join(', ')}. Create them in GHL first if you want the agent to use them.`)
  }

  return { applied, dropped }
}
