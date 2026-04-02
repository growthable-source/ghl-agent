import type { KnowledgeEntry } from '@prisma/client'

export function buildKnowledgeBlock(entries: KnowledgeEntry[]): string {
  if (entries.length === 0) return ''
  const chunks = entries
    .map((e) => `### ${e.title}\n${e.content}`)
    .join('\n\n')
  return `\n\n## Knowledge Base\nUse the following information when answering questions. Prioritise this over general knowledge:\n\n${chunks}`
}
