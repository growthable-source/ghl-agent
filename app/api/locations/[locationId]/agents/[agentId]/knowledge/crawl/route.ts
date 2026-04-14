import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { stripHtml, extractTitle, chunkText, estimateTokens } from '@/lib/chunker'
import { requireLocationAccess } from '@/lib/require-access'

async function fetchWithJinaFallback(url: string): Promise<{ title: string; text: string }> {
  // Try direct fetch first
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; GHL-Agent-Bot/1.0)' },
      signal: AbortSignal.timeout(10000),
    })
    if (res.ok) {
      const html = await res.text()
      const text = stripHtml(html)
      if (text.length >= 200) {
        return { title: extractTitle(html), text }
      }
    }
  } catch {}

  // Fallback: use Jina AI reader (handles JS-rendered / SPA pages, free, no API key)
  const jinaUrl = `https://r.jina.ai/${url}`
  const res = await fetch(jinaUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; GHL-Agent-Bot/1.0)',
      'Accept': 'text/plain',
    },
    signal: AbortSignal.timeout(25000),
  })

  if (!res.ok) throw new Error(`Could not read page (${res.status})`)

  const markdown = await res.text()

  // Extract title from Jina markdown header
  let title = 'Untitled'
  const titleMatch = markdown.match(/^Title:\s*(.+)$/m) || markdown.match(/^#\s+(.+)$/m)
  if (titleMatch) title = titleMatch[1].trim()

  // Strip Jina metadata header lines
  const text = markdown
    .replace(/^(Title|URL|Published Time|Description|Source URL|Markdown Content):.*$/gm, '')
    .replace(/^={3,}$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

  if (text.length < 100) throw new Error('Page has no readable content')

  return { title, text }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ locationId: string; agentId: string }> }
) {
  const { locationId, agentId } = await params
  const access = await requireLocationAccess(locationId)
  if (access instanceof NextResponse) return access
  const { url } = await req.json()

  if (!url || !url.startsWith('http')) {
    return NextResponse.json({ error: 'Invalid URL' }, { status: 400 })
  }

  try {
    const { title, text } = await fetchWithJinaFallback(url)
    const chunks = chunkText(text)

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
    if (err.name === 'TimeoutError' || err.name === 'AbortError') {
      return NextResponse.json({ error: 'Request timed out — try again' }, { status: 408 })
    }
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
