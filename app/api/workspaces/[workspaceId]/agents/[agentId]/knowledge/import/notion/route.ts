import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'

type Params = { params: Promise<{ workspaceId: string; agentId: string }> }

/**
 * Notion import — pulls a page's blocks via the Notion REST API and
 * stores the rendered text as a KnowledgeEntry.
 *
 * The Notion token is NOT persisted server-side here; the operator's
 * dashboard sends it on each import call. If we want recurring sync
 * later, switch to storing it in the Integration table.
 *
 * Body: { token: "secret_…", pageId: "<uuid or notion url>" }
 */

function extractPageId(input: string): string | null {
  const trimmed = input.trim()
  // Bare uuid (with or without dashes)
  const bare = trimmed.replace(/-/g, '')
  if (/^[a-f0-9]{32}$/i.test(bare)) {
    return [bare.slice(0, 8), bare.slice(8, 12), bare.slice(12, 16), bare.slice(16, 20), bare.slice(20)].join('-')
  }
  // Pull the trailing 32-char hex from a Notion URL
  const m = trimmed.match(/([a-f0-9]{32})(?:[?#].*)?$/i)
  if (m) {
    const id = m[1]
    return [id.slice(0, 8), id.slice(8, 12), id.slice(12, 16), id.slice(16, 20), id.slice(20)].join('-')
  }
  return null
}

interface NotionRichText { plain_text?: string }
interface NotionBlock {
  id: string
  type: string
  has_children?: boolean
  paragraph?: { rich_text?: NotionRichText[] }
  heading_1?: { rich_text?: NotionRichText[] }
  heading_2?: { rich_text?: NotionRichText[] }
  heading_3?: { rich_text?: NotionRichText[] }
  bulleted_list_item?: { rich_text?: NotionRichText[] }
  numbered_list_item?: { rich_text?: NotionRichText[] }
  quote?: { rich_text?: NotionRichText[] }
  to_do?: { rich_text?: NotionRichText[]; checked?: boolean }
  callout?: { rich_text?: NotionRichText[] }
  code?: { rich_text?: NotionRichText[]; language?: string }
}

const NOTION_VERSION = '2022-06-28'

async function fetchPageTitle(token: string, pageId: string): Promise<string | null> {
  const res = await fetch(`https://api.notion.com/v1/pages/${pageId}`, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'Notion-Version': NOTION_VERSION,
    },
  })
  if (!res.ok) return null
  const data = await res.json().catch(() => null) as any
  // Title sits inside the "title"-typed property on the page.
  const props = data?.properties || {}
  for (const key of Object.keys(props)) {
    const p = props[key]
    if (p?.type === 'title' && Array.isArray(p.title)) {
      return p.title.map((t: NotionRichText) => t.plain_text).join('').trim() || null
    }
  }
  return null
}

async function fetchBlocks(token: string, pageId: string, depth = 0, maxDepth = 3): Promise<string> {
  if (depth > maxDepth) return ''
  let cursor: string | undefined
  const out: string[] = []
  do {
    const url = new URL(`https://api.notion.com/v1/blocks/${pageId}/children`)
    url.searchParams.set('page_size', '100')
    if (cursor) url.searchParams.set('start_cursor', cursor)
    const res = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Notion-Version': NOTION_VERSION,
      },
    })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new Error(`Notion API ${res.status}: ${body.slice(0, 200)}`)
    }
    const data = await res.json() as { results?: NotionBlock[]; next_cursor?: string; has_more?: boolean }
    for (const block of data.results || []) {
      const rendered = renderBlock(block, depth)
      if (rendered) out.push(rendered)
      // Recurse into children (toggle, list items, etc) — bounded by maxDepth
      if (block.has_children) {
        const childText = await fetchBlocks(token, block.id, depth + 1, maxDepth)
        if (childText) out.push(childText)
      }
    }
    cursor = data.has_more ? data.next_cursor : undefined
  } while (cursor)
  return out.join('\n')
}

function joinText(arr?: NotionRichText[]): string {
  return (arr || []).map(t => t.plain_text || '').join('').trim()
}

function renderBlock(block: NotionBlock, depth: number): string {
  const indent = '  '.repeat(depth)
  switch (block.type) {
    case 'paragraph':           return indent + joinText(block.paragraph?.rich_text)
    case 'heading_1':           return `\n# ${joinText(block.heading_1?.rich_text)}`
    case 'heading_2':           return `\n## ${joinText(block.heading_2?.rich_text)}`
    case 'heading_3':           return `\n### ${joinText(block.heading_3?.rich_text)}`
    case 'bulleted_list_item':  return `${indent}- ${joinText(block.bulleted_list_item?.rich_text)}`
    case 'numbered_list_item':  return `${indent}1. ${joinText(block.numbered_list_item?.rich_text)}`
    case 'quote':               return `${indent}> ${joinText(block.quote?.rich_text)}`
    case 'to_do':               return `${indent}- [${block.to_do?.checked ? 'x' : ' '}] ${joinText(block.to_do?.rich_text)}`
    case 'callout':             return `${indent}> ${joinText(block.callout?.rich_text)}`
    case 'code':                return `${indent}\`\`\`${block.code?.language || ''}\n${joinText(block.code?.rich_text)}\n\`\`\``
    default:                    return ''
  }
}

export async function POST(req: NextRequest, { params }: Params) {
  const { workspaceId, agentId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  let body: any = {}
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }
  const token = String(body.token || '').trim()
  const pageInput = String(body.pageId || '').trim()
  if (!token || !pageInput) {
    return NextResponse.json({ error: 'token and pageId required' }, { status: 400 })
  }
  const pageId = extractPageId(pageInput)
  if (!pageId) {
    return NextResponse.json({ error: 'Could not parse a Notion page ID from that input' }, { status: 400 })
  }

  try {
    const [title, content] = await Promise.all([
      fetchPageTitle(token, pageId),
      fetchBlocks(token, pageId),
    ])
    const finalTitle = title || `Notion page ${pageId.slice(0, 8)}`
    if (!content.trim()) {
      return NextResponse.json({ error: 'Notion page has no readable text' }, { status: 400 })
    }
    const entry = await db.knowledgeEntry.create({
      data: {
        agentId,
        title: finalTitle,
        content,
        source: 'notion',
        sourceUrl: `https://www.notion.so/${pageId.replace(/-/g, '')}`,
      },
    })
    return NextResponse.json({ entry })
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Notion import failed' }, { status: 502 })
  }
}
