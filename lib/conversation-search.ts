/**
 * Shared conversation search + filter logic.
 *
 * Used by:
 *   - GET /api/workspaces/:wid/widget-conversations/search
 *     (server-backed inbox search — walks full transcripts and metadata)
 *   - GET /api/workspaces/:wid/brands/:bid/transcripts/export
 *     (transcript export — exports the same filtered set)
 *
 * Both endpoints take the same shape of filters. Centralising the logic
 * means "what the operator sees in the inbox after filtering" and
 * "what gets included in the export" can never drift.
 */

import { db } from './db'

export interface ConversationSearchInput {
  workspaceId: string
  /** Brand slug to scope to. 'untagged' for widgets without a brand.
   *  null/undefined for "every brand." */
  brandSlug?: string | null
  /** Brand ID alternative — wins over brandSlug when both are set. */
  brandId?: string | null
  /** 'active' | 'handed_off' | 'ended' — null for any */
  status?: string | null
  /** ISO date string */
  from?: string | null
  to?: string | null
  /** Free-text search across messages, visitor, assignee, widget, brand. */
  q?: string | null
  /** Result limit. Defaults to 100 for inbox search; the export caller
   *  passes 1000 since exports are bounded differently. */
  take?: number
}

export interface MatchedConversation {
  conversation: any
  /** Which fields the query matched in. For surfacing chips like
   *  "matched in transcript" / "matched in visitor email." */
  matchedIn: Array<'visitor' | 'message' | 'assignee' | 'widget' | 'brand' | 'csat'>
  /** Up to 3 short snippets from matching messages, with the matched
   *  word at the centre. Useful for showing context in the inbox UI. */
  snippets: string[]
}

/**
 * Resolve a brand slug to its id (workspace-scoped). Returns null
 * if not found. Untagged is signalled by a sentinel returned as
 * 'untagged' — callers that handle "untagged" should check for that
 * case before passing through.
 */
async function resolveBrand(workspaceId: string, slug: string | null | undefined, id: string | null | undefined): Promise<string | null | 'untagged'> {
  if (id) {
    const b = await (db as any).brand.findFirst({
      where: { id, workspaceId },
      select: { id: true },
    }).catch(() => null)
    return b?.id ?? null
  }
  if (slug === 'untagged') return 'untagged'
  if (!slug) return null
  const b = await (db as any).brand.findFirst({
    where: { workspaceId, slug },
    select: { id: true },
  }).catch(() => null)
  return b?.id ?? null
}

/** Build the Prisma `where` for the conversation list given the filters
 *  except free-text search, which composes on top with `OR` clauses. */
function buildBaseWhere(workspaceId: string, brand: string | null | 'untagged', status: string | null | undefined, from: string | null | undefined, to: string | null | undefined): any {
  const where: any = {
    widget: brand === 'untagged'
      ? { workspaceId, brandId: null }
      : brand
        ? { workspaceId, brandId: brand }
        : { workspaceId },
  }
  if (status && ['active', 'handed_off', 'ended'].includes(status)) {
    where.status = status
  }
  if (from || to) {
    where.createdAt = {}
    if (from) where.createdAt.gte = new Date(from)
    if (to) where.createdAt.lte = new Date(to)
  }
  return where
}

/**
 * Full-text-ish search across messages and metadata. Postgres ILIKE
 * via Prisma's `contains` mode. Caps the result set; for larger
 * archives, callers narrow via the date-range filters first.
 */
export async function searchConversations(input: ConversationSearchInput): Promise<MatchedConversation[]> {
  const brand = await resolveBrand(input.workspaceId, input.brandSlug, input.brandId)
  const where = buildBaseWhere(input.workspaceId, brand, input.status, input.from, input.to)

  const q = (input.q ?? '').trim()
  const take = input.take ?? 100

  if (q) {
    // Match in any of: visitor (name/email/phone), widget name, brand
    // name, assignee name/email, CSAT comment, OR any message content.
    where.OR = [
      { visitor: { is: { name:  { contains: q, mode: 'insensitive' } } } },
      { visitor: { is: { email: { contains: q, mode: 'insensitive' } } } },
      { visitor: { is: { phone: { contains: q, mode: 'insensitive' } } } },
      { widget:  { is: { name:  { contains: q, mode: 'insensitive' } } } },
      { widget:  { is: { brand: { is: { name: { contains: q, mode: 'insensitive' } } } } } },
      { assignedUser: { is: { name:  { contains: q, mode: 'insensitive' } } } } as any,
      { assignedUser: { is: { email: { contains: q, mode: 'insensitive' } } } } as any,
      { csatComment: { contains: q, mode: 'insensitive' } } as any,
      { messages: { some: { content: { contains: q, mode: 'insensitive' } } } },
    ]
  }

  const conversations = await db.widgetConversation.findMany({
    where,
    orderBy: { lastMessageAt: 'desc' },
    take,
    include: {
      widget: {
        select: {
          id: true, name: true, primaryColor: true,
          brand: { select: { id: true, name: true, slug: true, logoUrl: true, primaryColor: true } },
        },
      },
      visitor: { select: { id: true, name: true, email: true, phone: true, cookieId: true } },
      assignedUser: { select: { id: true, name: true, email: true, image: true } } as any,
      // For snippet generation we pull the full message thread when q
      // is present. When q is empty we only need the latest message
      // for the inbox preview, matching the existing list behaviour.
      messages: q
        ? { orderBy: { createdAt: 'asc' as const } }
        : { orderBy: { createdAt: 'desc' as const }, take: 1 },
      _count: { select: { messages: true } },
    } as any,
  })

  if (!q) {
    // No query → return everything, no match metadata. The inbox
    // shapes this into rows the same as the regular list endpoint.
    return conversations.map(c => ({ conversation: c, matchedIn: [], snippets: [] }))
  }

  // For each result, figure out *where* the match was so we can show
  // a small chip + extract message snippets.
  const ql = q.toLowerCase()
  const out: MatchedConversation[] = []
  for (const c of conversations as any[]) {
    const matchedIn: MatchedConversation['matchedIn'] = []
    const snippets: string[] = []

    if (
      (c.visitor?.name  && c.visitor.name.toLowerCase().includes(ql))
      || (c.visitor?.email && c.visitor.email.toLowerCase().includes(ql))
      || (c.visitor?.phone && c.visitor.phone.toLowerCase().includes(ql))
    ) matchedIn.push('visitor')
    if (c.widget?.name && c.widget.name.toLowerCase().includes(ql)) matchedIn.push('widget')
    if (c.widget?.brand?.name && c.widget.brand.name.toLowerCase().includes(ql)) matchedIn.push('brand')
    if (
      (c.assignedUser?.name  && c.assignedUser.name.toLowerCase().includes(ql))
      || (c.assignedUser?.email && c.assignedUser.email.toLowerCase().includes(ql))
    ) matchedIn.push('assignee')
    if (c.csatComment && c.csatComment.toLowerCase().includes(ql)) matchedIn.push('csat')

    // Walk messages to find matching ones; emit up to 3 snippets.
    const matchingMessages = (c.messages ?? []).filter((m: any) => m.content?.toLowerCase().includes(ql))
    if (matchingMessages.length > 0) matchedIn.push('message')
    for (const m of matchingMessages.slice(0, 3)) {
      snippets.push(snippetAround(m.content, ql))
    }

    out.push({ conversation: c, matchedIn, snippets })
  }
  return out
}

/** Pull a short window of text centred on the first occurrence of
 *  `needle` (case-insensitive) — for showing match context in the UI.
 *  Caps at ~140 chars with ellipses on either side when truncated. */
function snippetAround(content: string, needle: string): string {
  if (!content) return ''
  const lower = content.toLowerCase()
  const idx = lower.indexOf(needle)
  if (idx < 0) return content.slice(0, 140) + (content.length > 140 ? '…' : '')
  const radius = 60
  const start = Math.max(0, idx - radius)
  const end = Math.min(content.length, idx + needle.length + radius)
  const prefix = start > 0 ? '…' : ''
  const suffix = end < content.length ? '…' : ''
  return prefix + content.slice(start, end).replace(/\s+/g, ' ').trim() + suffix
}
