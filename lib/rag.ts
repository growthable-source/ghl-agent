import type { KnowledgeEntry } from '@prisma/client'

const FULL_INJECT_THRESHOLD = 15  // inject all when <= this many chunks
const MAX_SMART_CHUNKS = 5        // inject this many when above threshold

// Simple keyword scorer — counts matching words between query and chunk
function scoreChunk(chunk: KnowledgeEntry, query: string): number {
  const queryWords = query
    .toLowerCase()
    .split(/\W+/)
    .filter(w => w.length > 3)  // skip short words

  if (queryWords.length === 0) return 0

  const content = (chunk.title + ' ' + chunk.content).toLowerCase()
  return queryWords.reduce((score, word) => {
    // Count occurrences, not just presence
    const matches = (content.match(new RegExp(word, 'g')) || []).length
    return score + matches
  }, 0)
}

export function selectRelevantChunks(
  entries: KnowledgeEntry[],
  query: string
): KnowledgeEntry[] {
  if (entries.length === 0) return []

  // Below threshold — inject everything
  if (entries.length <= FULL_INJECT_THRESHOLD) return entries

  // Above threshold — score and pick top chunks
  const scored = entries
    .map(e => ({ entry: e, score: scoreChunk(e, query) }))
    .sort((a, b) => b.score - a.score)

  // Always include top scoring chunks, min 1
  const topChunks = scored.slice(0, MAX_SMART_CHUNKS).map(s => s.entry)

  return topChunks
}

export function buildKnowledgeBlock(
  entries: KnowledgeEntry[],
  query?: string
): string {
  if (entries.length === 0) return ''

  const selected = query ? selectRelevantChunks(entries, query) : entries

  if (selected.length === 0) return ''

  const chunks = selected
    .map(e => `### ${e.title}\n${e.content}`)
    .join('\n\n')

  const note = entries.length > FULL_INJECT_THRESHOLD
    ? ` (${selected.length} of ${entries.length} most relevant chunks selected)`
    : ''

  return `\n\n## Knowledge Base${note}\nUse the following information when answering questions. Prioritise this over general knowledge:\n\n${chunks}`
}
