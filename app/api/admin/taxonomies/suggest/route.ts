import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { auth } from '@/lib/auth'
import { createMessage } from '@/lib/llm'

/**
 * POST /api/admin/taxonomies/suggest
 * Body: { knowledgeDomainId: string }
 *
 * Looks at every chunk in this domain's _other bucket (empty
 * taxonomyTags), asks Haiku to propose 3–5 new topic keys that would
 * cover them, and returns each suggestion alongside the chunkIds it
 * would cover. The operator either:
 *   - Accepts a suggestion → POST /api/admin/taxonomies (create) +
 *     PATCH each chunkId (assign). Done in a follow-up call from the UI.
 *   - Edits the label → same, but with their override.
 *   - Ignores it.
 *
 * This is the "scale" path for the _other bucket — operators can clear
 * 50+ orphans with a handful of clicks instead of dropdown-by-dropdown.
 */
async function memberAccess(domainId: string) {
  const session = await auth()
  if (!session?.user?.id) return null
  const domain = await (db as any).knowledgeDomain.findUnique({
    where: { id: domainId },
    select: { workspaceId: true },
  })
  if (!domain) return null
  const member = await db.workspaceMember.findUnique({
    where: { userId_workspaceId: { userId: session.user.id, workspaceId: domain.workspaceId } },
    select: { role: true },
  })
  return member ? { session, workspaceId: domain.workspaceId } : null
}

interface Suggestion {
  key: string
  label: string
  description: string
  coversChunkIds: string[]
  sampleChunks: Array<{ id: string; primaryTopic: string | null; preview: string }>
}

const MODEL = 'claude-haiku'
const MAX_CHUNKS = 60

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const knowledgeDomainId = typeof body.knowledgeDomainId === 'string' ? body.knowledgeDomainId : null
  if (!knowledgeDomainId) {
    return NextResponse.json({ error: 'knowledgeDomainId required' }, { status: 400 })
  }
  const access = await memberAccess(knowledgeDomainId)
  if (!access) return NextResponse.json({ error: 'forbidden' }, { status: 403 })

  const [domain, existing, unmatched] = await Promise.all([
    (db as any).knowledgeDomain.findUnique({
      where: { id: knowledgeDomainId },
      select: { name: true, description: true },
    }),
    (db as any).taxonomy.findMany({
      where: { knowledgeDomainId },
      select: { key: true, label: true },
    }),
    (db as any).knowledgeChunk.findMany({
      where: { knowledgeDomainId, supersededAt: null, taxonomyTags: { isEmpty: true } },
      orderBy: { createdAt: 'desc' },
      take: MAX_CHUNKS,
      select: { id: true, primaryTopic: true, content: true },
    }),
  ])

  if (!unmatched || unmatched.length === 0) {
    return NextResponse.json({ suggestions: [], note: 'No orphan chunks to suggest from.' })
  }

  const existingKeys: string[] = (existing as Array<{ key: string; label: string }>).map(t => t.key)
  const existingBlock = existing.length > 0
    ? (existing as Array<{ key: string; label: string }>).map(t => `- ${t.key}: ${t.label}`).join('\n')
    : '(no existing topics)'

  // ID-prefix each chunk so Haiku can refer to them by ID in its
  // output. Keep snippets short — we're optimising for a quick
  // categorical read, not deep comprehension.
  const chunkBlock = unmatched
    .map((c: any) => `[id=${c.id}] ${c.primaryTopic ? `(${c.primaryTopic}) ` : ''}${c.content.replace(/\s+/g, ' ').slice(0, 320)}`)
    .join('\n\n')

  const system = `You help maintain a controlled-vocabulary topic taxonomy for an AI knowledge base.

Domain: ${domain?.name ?? '(unnamed)'} — ${domain?.description ?? ''}

Existing topics:
${existingBlock}

You will be given a list of content chunks that the auto-classifier could NOT place into any existing topic.

Your job: propose 3 to 5 NEW topic keys that would cover most of these chunks. For each new topic, list the chunk IDs it would cover.

Rules:
- Do NOT propose a topic that overlaps significantly with an existing one — if the chunk should have been classified as an existing topic, leave it out.
- A new topic must cover at least 3 of the chunks shown — single-chunk topics aren't worth creating.
- Keys: lowercase, underscores, max 40 chars (e.g. "refund_policy", "subscription_billing").
- Labels: human-readable title case, max 60 chars (e.g. "Refund Policy").
- Descriptions: one sentence, what content goes here.
- Output STRICT JSON only — no markdown fences, no commentary:

{
  "suggestions": [
    { "key": "...", "label": "...", "description": "...", "covers_chunk_ids": ["id1", "id2", "id3"] }
  ]
}

If nothing meaningful can be proposed, return { "suggestions": [] }.`

  let parsed: { suggestions?: Array<{ key?: string; label?: string; description?: string; covers_chunk_ids?: string[] }> } = {}
  try {
    const completion = await createMessage(MODEL, {
      max_tokens: 1500,
      system,
      messages: [{ role: 'user', content: `Unplaced chunks:\n\n${chunkBlock}` }],
    }, { surface: 'taxonomy_suggest' })
    const text = completion.content.find(b => b.type === 'text') as { type: 'text'; text: string } | undefined
    const raw = (text?.text ?? '').trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/i, '').trim()
    parsed = JSON.parse(raw)
  } catch (err: any) {
    console.warn('[suggest-topics] Haiku call failed:', err?.message)
    return NextResponse.json({ error: 'Suggestion engine couldn\'t parse a response. Try again in a moment.' }, { status: 502 })
  }

  const existingKeySet = new Set(existingKeys)
  const validChunkIds = new Set<string>((unmatched as Array<{ id: string }>).map(c => c.id))
  const chunkLookup = new Map<string, { id: string; primaryTopic: string | null; content: string }>(
    (unmatched as Array<{ id: string; primaryTopic: string | null; content: string }>).map(c => [c.id, c])
  )

  const suggestions: Suggestion[] = []
  for (const s of parsed.suggestions ?? []) {
    if (typeof s.key !== 'string' || typeof s.label !== 'string') continue
    const key = s.key.trim().toLowerCase().replace(/[^a-z0-9_]/g, '_').slice(0, 40)
    if (!key || existingKeySet.has(key)) continue
    const covers = Array.isArray(s.covers_chunk_ids)
      ? s.covers_chunk_ids.filter((id): id is string => typeof id === 'string' && validChunkIds.has(id))
      : []
    if (covers.length < 2) continue   // model hallucinated; skip
    const samples = covers.slice(0, 3).map(id => {
      const c = chunkLookup.get(id)!
      return { id: c.id, primaryTopic: c.primaryTopic, preview: c.content.replace(/\s+/g, ' ').slice(0, 160) }
    })
    suggestions.push({
      key,
      label: s.label.trim().slice(0, 60),
      description: typeof s.description === 'string' ? s.description.trim().slice(0, 200) : '',
      coversChunkIds: covers,
      sampleChunks: samples,
    })
  }

  return NextResponse.json({ suggestions, examined: unmatched.length })
}
