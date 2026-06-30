/**
 * Automatic topic organisation — the "Needs a topic" queue, without
 * the human.
 *
 * The advanced surface had an AI suggest topics for unmatched chunks
 * and then made the OPERATOR click "Accept & tag" on each AI
 * suggestion — AI-generated work waiting on a human rubber stamp,
 * 100 entries deep. This runs the exact same loop unattended after
 * every ingest:
 *
 *   1. find chunks with no taxonomyTags (the "_other bucket")
 *   2. ask Haiku to propose topics covering them (same prompt and
 *      validation as /api/admin/taxonomies/suggest)
 *   3. create the Taxonomy rows and assign the chunks — the same
 *      writes "Accept & tag" performed
 *   4. repeat (suggestions consider 60 chunks at a time) until the
 *      bucket is clear or nothing more can be proposed
 *
 * Retrieval doesn't depend on topics (single shared pool at launch),
 * so worst case mis-tagging costs organisation, not answers — which
 * is why auto-apply is safe. The manual surface stays for renames
 * and re-assignments.
 */

import Anthropic from '@anthropic-ai/sdk'
import { db } from '@/lib/db'

const MODEL = 'claude-haiku-4-5'
const CHUNKS_PER_PASS = 60
const MAX_PASSES = 4

export async function autoOrganizeTopics(knowledgeDomainId: string): Promise<{ topicsCreated: number; chunksTagged: number }> {
  let topicsCreated = 0
  let chunksTagged = 0

  try {
    for (let pass = 0; pass < MAX_PASSES; pass++) {
      const [domain, existing, unmatched] = await Promise.all([
        db.knowledgeDomain.findUnique({
          where: { id: knowledgeDomainId },
          select: { name: true, description: true },
        }),
        db.taxonomy.findMany({
          where: { knowledgeDomainId },
          select: { key: true, label: true },
        }),
        db.knowledgeChunk.findMany({
          where: { knowledgeDomainId, supersededAt: null, taxonomyTags: { isEmpty: true } },
          orderBy: { createdAt: 'desc' },
          take: CHUNKS_PER_PASS,
          select: { id: true, primaryTopic: true, content: true },
        }),
      ])
      if (!domain || unmatched.length < 3) break

      const existingBlock =
        existing.length > 0 ? existing.map(t => `- ${t.key}: ${t.label}`).join('\n') : '(no existing topics)'
      const chunkBlock = unmatched
        .map(c => `[id=${c.id}] ${c.primaryTopic ? `(${c.primaryTopic}) ` : ''}${c.content.replace(/\s+/g, ' ').slice(0, 320)}`)
        .join('\n\n')

      const system = `You help maintain a controlled-vocabulary topic taxonomy for an AI knowledge base.

Domain: ${domain.name} — ${domain.description ?? ''}

Existing topics:
${existingBlock}

You will be given content chunks the auto-classifier could NOT place into any existing topic.

Propose 3 to 5 NEW topic keys that would cover most of them. For each, list the chunk IDs it covers.

Rules:
- Do NOT propose a topic that overlaps significantly with an existing one.
- A new topic must cover at least 3 of the chunks shown.
- Keys: lowercase, underscores, max 40 chars. Labels: title case, max 60 chars. Descriptions: one sentence.
- Output STRICT JSON only: { "suggestions": [ { "key": "...", "label": "...", "description": "...", "covers_chunk_ids": ["..."] } ] }
- If nothing meaningful can be proposed, return { "suggestions": [] }.`

      const client = new Anthropic()
      let parsed: { suggestions?: Array<{ key?: string; label?: string; covers_chunk_ids?: string[] }> }
      try {
        const completion = await client.messages.create({
          model: MODEL,
          max_tokens: 1500,
          system,
          messages: [{ role: 'user', content: `Unplaced chunks:\n\n${chunkBlock}` }],
        })
        const text = completion.content.find(b => b.type === 'text') as { type: 'text'; text: string } | undefined
        const raw = (text?.text ?? '').trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/i, '').trim()
        parsed = JSON.parse(raw)
      } catch (err) {
        console.warn('[auto-topics] suggestion call failed:', err instanceof Error ? err.message : err)
        break
      }

      const existingKeys = new Set(existing.map(t => t.key))
      const validChunkIds = new Set(unmatched.map(c => c.id))
      let appliedThisPass = 0

      for (const s of parsed.suggestions ?? []) {
        if (typeof s.key !== 'string' || typeof s.label !== 'string') continue
        const key = s.key.trim().toLowerCase().replace(/[^a-z0-9_]/g, '_').slice(0, 40)
        if (!key || existingKeys.has(key)) continue
        const covers = (Array.isArray(s.covers_chunk_ids) ? s.covers_chunk_ids : []).filter(id => validChunkIds.has(id))
        if (covers.length < 3) continue

        try {
          await db.taxonomy.create({
            data: { knowledgeDomainId, key, label: s.label.trim().slice(0, 120), aliases: [] },
          })
        } catch (err) {
          // P2002 = raced/duplicate key — assignment below still valid.
          if ((err as { code?: string })?.code !== 'P2002') {
            console.warn(`[auto-topics] create ${key} failed:`, err instanceof Error ? err.message : err)
            continue
          }
        }
        existingKeys.add(key)
        topicsCreated++

        const updated = await db.knowledgeChunk.updateMany({
          where: { id: { in: covers }, taxonomyTags: { isEmpty: true } },
          data: { taxonomyTags: [key] },
        })
        chunksTagged += updated.count
        appliedThisPass += updated.count
      }

      // No traction this pass → the leftovers genuinely don't cluster;
      // stop rather than burn passes re-asking the same question.
      if (appliedThisPass === 0) break
    }
  } catch (err) {
    console.error('[auto-topics] failed:', err instanceof Error ? err.message : err)
  }

  if (topicsCreated > 0 || chunksTagged > 0) {
    console.log(`[auto-topics] domain ${knowledgeDomainId}: created ${topicsCreated} topic(s), tagged ${chunksTagged} chunk(s)`)
  }
  return { topicsCreated, chunksTagged }
}
