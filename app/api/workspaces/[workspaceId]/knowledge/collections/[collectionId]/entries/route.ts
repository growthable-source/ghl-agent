import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'
import { createKnowledgeInCollection } from '@/lib/knowledge'
import { estimateTokens } from '@/lib/chunker'

type Params = { params: Promise<{ workspaceId: string; collectionId: string }> }

/**
 * POST — write a manual knowledge entry into this collection.
 * Body: { title, content, source?, sourceUrl? }
 *
 * For uploads / Notion / YouTube / URL crawl, see the sibling routes:
 *   ./upload      (file upload, multipart)
 *   ./import/notion
 *   ./import/youtube
 *   ./crawl       (URL crawl)
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
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }
  const title = typeof body.title === 'string' ? body.title.trim() : ''
  const content = typeof body.content === 'string' ? body.content : ''
  if (!title) return NextResponse.json({ error: 'title required' }, { status: 400 })
  if (!content.trim()) return NextResponse.json({ error: 'content required' }, { status: 400 })

  const allowedSources = ['manual', 'qa', 'notion', 'youtube', 'url']
  const source = typeof body.source === 'string' && allowedSources.includes(body.source)
    ? body.source
    : 'manual'
  const sourceUrl = typeof body.sourceUrl === 'string' ? body.sourceUrl : null

  const entry = await createKnowledgeInCollection({
    collectionId,
    workspaceId,
    title,
    content,
    source,
    sourceUrl,
    tokenEstimate: estimateTokens(content),
  })

  return NextResponse.json({ entry }, { status: 201 })
}
