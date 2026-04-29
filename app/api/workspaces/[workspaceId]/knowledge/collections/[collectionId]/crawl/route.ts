import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'
import { fetchPageContent } from '@/lib/crawler'
import { chunkText, estimateTokens } from '@/lib/chunker'
import { createKnowledgeInCollection } from '@/lib/knowledge'
import { createHash } from 'node:crypto'

type Params = { params: Promise<{ workspaceId: string; collectionId: string }> }

/**
 * POST — crawl a single URL and store the result as one or more
 * KnowledgeEntries in this collection. The chunker splits long
 * pages; each chunk gets a contentHash so re-crawling the same URL
 * via the dedicated crawler skips unchanged content.
 *
 * Body: { url }
 */
export async function POST(req: NextRequest, { params }: Params) {
  const { workspaceId, collectionId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  const collection = await db.knowledgeCollection.findFirst({
    where: { id: collectionId, workspaceId },
    select: { id: true },
  })
  if (!collection) return NextResponse.json({ error: 'Collection not found' }, { status: 404 })

  let body: any = {}
  try { body = await req.json() } catch {}
  const url = String(body.url || '').trim()
  if (!url) return NextResponse.json({ error: 'url required' }, { status: 400 })

  let title: string, text: string
  try {
    const fetched = await fetchPageContent(url)
    title = fetched.title
    text = fetched.text
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Crawl failed' }, { status: 502 })
  }

  const chunks = chunkText(text)
  const created: any[] = []
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i]
    const hash = createHash('sha256').update(chunk).digest('hex')
    const entry = await createKnowledgeInCollection({
      collectionId,
      workspaceId,
      title: chunks.length === 1 ? title : `${title} (${i + 1}/${chunks.length})`,
      content: chunk,
      source: 'url',
      sourceUrl: url,
      tokenEstimate: estimateTokens(chunk),
      contentHash: hash,
    })
    created.push(entry)
  }
  return NextResponse.json({
    success: true,
    title,
    chunks: created.length,
    totalTokens: created.reduce((s, e) => s + e.tokenEstimate, 0),
  })
}
