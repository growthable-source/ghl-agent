import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { stripHtml, extractTitle, chunkText, estimateTokens } from '@/lib/chunker'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ locationId: string; agentId: string }> }
) {
  const { agentId } = await params
  const { url } = await req.json()

  if (!url || !url.startsWith('http')) {
    return NextResponse.json({ error: 'Invalid URL' }, { status: 400 })
  }

  try {
    // Fetch the URL
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; GHL-Agent-Bot/1.0)' },
      signal: AbortSignal.timeout(10000),
    })

    if (!res.ok) {
      return NextResponse.json({ error: `Failed to fetch URL: ${res.status}` }, { status: 400 })
    }

    const html = await res.text()
    const title = extractTitle(html)
    const text = stripHtml(html)

    if (text.length < 100) {
      return NextResponse.json({ error: 'Page has no readable content' }, { status: 400 })
    }

    const chunks = chunkText(text)

    // Create a KnowledgeEntry per chunk
    const entries = await Promise.all(
      chunks.map((chunk, i) =>
        db.knowledgeEntry.create({
          data: {
            agentId,
            title: chunks.length === 1 ? title : `${title} (${i + 1}/${chunks.length})`,
            content: chunk,
            source: 'url',
            sourceUrl: url,
            tokenEstimate: estimateTokens(chunk),
          },
        })
      )
    )

    return NextResponse.json({
      success: true,
      chunks: entries.length,
      title,
      totalTokens: entries.reduce((sum, e) => sum + e.tokenEstimate, 0),
    })
  } catch (err: any) {
    if (err.name === 'TimeoutError') {
      return NextResponse.json({ error: 'Request timed out (10s limit)' }, { status: 408 })
    }
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
