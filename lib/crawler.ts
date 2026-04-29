import { createHash } from 'crypto'
import { db } from './db'
import { stripHtml, extractTitle, chunkText, estimateTokens } from './chunker'
import { createKnowledgeForAgent } from './knowledge'

/**
 * Shared crawl helpers — used by the ad-hoc crawl route AND the recurring
 * CrawlSchedule cron.
 */
export async function fetchPageContent(url: string): Promise<{ title: string; text: string }> {
  // Try direct fetch first
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Voxility-Bot/1.0)' },
      signal: AbortSignal.timeout(10000),
    })
    if (res.ok) {
      const html = await res.text()
      const text = stripHtml(html)
      if (text.length >= 200) return { title: extractTitle(html), text }
    }
  } catch {}

  // Fallback: Jina AI reader
  const jinaUrl = `https://r.jina.ai/${url}`
  const res = await fetch(jinaUrl, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Voxility-Bot/1.0)', 'Accept': 'text/plain' },
    signal: AbortSignal.timeout(25000),
  })
  if (!res.ok) throw new Error(`Could not read page (${res.status})`)
  const markdown = await res.text()
  let title = 'Untitled'
  const titleMatch = markdown.match(/^Title:\s*(.+)$/m) || markdown.match(/^#\s+(.+)$/m)
  if (titleMatch) title = titleMatch[1].trim()
  const text = markdown
    .replace(/^(Title|URL|Published Time|Description|Source URL|Markdown Content):.*$/gm, '')
    .replace(/^={3,}$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  if (text.length < 100) throw new Error('Page has no readable content')
  return { title, text }
}

/**
 * Crawl a URL for a specific agent and produce KnowledgeEntries. If
 * `skipUnchanged` is true, chunks whose contentHash already exists for this
 * agent+sourceUrl are NOT re-inserted — resulting in an "incremental"
 * re-crawl that only picks up new content.
 */
export async function crawlAndIndex(params: {
  agentId: string
  url: string
  source?: 'url' | 'crawl'
  skipUnchanged?: boolean
}): Promise<{ title: string; chunksAdded: number; chunksSkipped: number; totalTokens: number }> {
  const { agentId, url, skipUnchanged = false } = params
  const source = params.source || 'url'

  const { title, text } = await fetchPageContent(url)
  const chunks = chunkText(text)

  let chunksAdded = 0
  let chunksSkipped = 0
  let totalTokens = 0

  // If we're de-duping, collect existing hashes for this URL on this agent
  let existingHashes: Set<string> = new Set()
  if (skipUnchanged) {
    const existing = await db.knowledgeEntry.findMany({
      where: { agentId, sourceUrl: url },
      select: { contentHash: true },
    })
    existingHashes = new Set(existing.map(e => e.contentHash).filter(Boolean) as string[])
  }

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i]
    const hash = createHash('sha256').update(chunk).digest('hex')

    if (skipUnchanged && existingHashes.has(hash)) {
      chunksSkipped++
      continue
    }

    const tokens = estimateTokens(chunk)
    await createKnowledgeForAgent({
      agentId,
      title: chunks.length === 1 ? title : `${title} (${i + 1}/${chunks.length})`,
      content: chunk,
      source,
      sourceUrl: url,
      tokenEstimate: tokens,
      status: 'ready',
      contentHash: hash,
    })
    chunksAdded++
    totalTokens += tokens
  }

  return { title, chunksAdded, chunksSkipped, totalTokens }
}

/**
 * Compute the next-run timestamp for a given frequency.
 */
export function nextRunAt(frequency: 'daily' | 'weekly' | 'monthly', from: Date = new Date()): Date {
  const next = new Date(from)
  if (frequency === 'daily') next.setDate(next.getDate() + 1)
  else if (frequency === 'weekly') next.setDate(next.getDate() + 7)
  else next.setMonth(next.getMonth() + 1)
  return next
}
