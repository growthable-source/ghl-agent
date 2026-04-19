/**
 * Listening Rules
 *
 * Structurally similar to detection rules (AgentRule) — natural-language
 * description + few-shot examples — but differ in what they DO when they
 * fire. Detection rules write a known value to a known CRM field; listening
 * rules capture free-text context the user couldn't have predicted (family
 * news, health issues, preferences) into the agent's memory of the contact.
 *
 * The agent calls update_contact_memory(category, content) when it hears
 * something that fits an active category. The stored memory is then injected
 * into future turns as "What you already know about this contact" so the
 * agent can reference it naturally.
 */

import { db } from './db'

export interface LoadedListeningRule {
  id: string
  name: string
  description: string
  examples: string[]
  isActive: boolean
  order: number
}

export async function getActiveListeningRules(agentId: string): Promise<LoadedListeningRule[]> {
  const rows = await (db as any).agentListeningRule.findMany({
    where: { agentId, isActive: true },
    orderBy: { order: 'asc' },
  })
  return rows.map((r: any) => ({
    id: r.id,
    name: r.name,
    description: r.description,
    examples: r.examples ?? [],
    isActive: r.isActive,
    order: r.order,
  }))
}

/**
 * Render listening categories as a prompt block. Pairs with
 * renderContactMemoryContext so the agent sees both "what to listen for"
 * and "what you've already captured".
 */
export function buildListeningRulesBlock(rules: LoadedListeningRule[]): string {
  if (rules.length === 0) return ''

  const body = rules.map((r, i) => {
    const exampleLines = r.examples.length
      ? r.examples.map(e => `    • "${e}"`).join('\n')
      : '    (no examples given)'
    return (
`${i + 1}. Category: "${r.name}"
   Listen for: ${r.description}
   Examples that fit:
${exampleLines}`
    )
  }).join('\n\n')

  return `\n\n## Listening Categories
The contact sometimes volunteers information that's worth remembering but
that you wouldn't ask directly (family, health, personal context, etc.).
Keep an ear out for the categories below.

When the contact mentions something that fits a category, call
update_contact_memory with:
  - category: the category name (exactly as listed)
  - content: a brief factual note of what was said, in your own words
    (e.g. "Mother is sick — contact is distracted this week")

Do NOT comment on the captured info in your reply unless the contact
explicitly invites a response. Your job is to log quietly and carry on.

${body}`
}

/**
 * Render what we already know about this contact into the system prompt.
 * Includes both the auto-generated summary and any categorised memory
 * entries. Shown to the agent so it can reference prior context naturally.
 */
export function buildContactMemoryBlock(params: {
  summary?: string | null
  categories?: Record<string, string> | null
}): string {
  const { summary, categories } = params
  const hasSummary = summary && summary.trim().length > 0
  const hasCategories = categories && Object.keys(categories).length > 0
  if (!hasSummary && !hasCategories) return ''

  let block = '\n\n## What You Already Know About This Contact\n'
  if (hasSummary) {
    block += `\n${summary}\n`
  }
  if (hasCategories) {
    block += '\n'
    for (const [cat, content] of Object.entries(categories)) {
      if (content && content.trim()) block += `- ${cat}: ${content}\n`
    }
  }
  block += '\nReference this naturally when relevant. Do not recite it back verbatim.'
  return block
}

/**
 * Write a category-scoped entry into ContactMemory. The agent calls this
 * via the update_contact_memory tool; we merge into the existing categories
 * bag rather than overwriting, so multiple rules can populate in parallel.
 */
export async function writeMemoryCategory(params: {
  agentId: string
  locationId: string
  contactId: string
  category: string
  content: string
}): Promise<void> {
  const { agentId, locationId, contactId, category, content } = params

  // Load existing row so we can merge the category bag without clobbering.
  const existing = await (db as any).contactMemory.findUnique({
    where: { agentId_contactId: { agentId, contactId } },
    select: { categories: true },
  })
  const current = (existing?.categories as Record<string, string>) ?? {}
  const nextCategories = { ...current, [category]: content }

  await (db as any).contactMemory.upsert({
    where: { agentId_contactId: { agentId, contactId } },
    create: {
      agentId,
      locationId,
      contactId,
      categories: nextCategories,
    },
    update: {
      categories: nextCategories,
    },
  })
}
