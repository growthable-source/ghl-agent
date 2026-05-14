/**
 * Conversation-export formatters.
 *
 * Single source of truth for what a conversation looks like in
 * exported form, so the single-conversation route and the bulk route
 * stay in lock-step. Output formats:
 *
 *   - csv      flat one-row-per-message table (timestamp, role,
 *              conversation_id, content). Ideal for spreadsheet
 *              triage / bulk import.
 *   - md       grouped Markdown per conversation with metadata
 *              header + a line per message. Operator-friendly for
 *              sharing a thread.
 *   - json     full structured payload — messages array, visitor,
 *              agent, csat, etc. For programmatic re-import / archive.
 */

export interface ExportMessage {
  id: string
  role: string
  content: string
  kind: string | null
  createdAt: Date | string
}

export interface ExportConversation {
  id: string
  status: string
  createdAt: Date | string
  lastMessageAt: Date | string
  csatRating: number | null
  csatComment: string | null
  initiatedUrl: string | null
  widget: { id: string; name: string | null } | null
  brand: { id: string; name: string; slug: string } | null
  visitor: {
    id: string
    name: string | null
    email: string | null
    phone: string | null
  } | null
  assignedUser: { id: string; name: string | null; email: string | null } | null
  messages: ExportMessage[]
}

export type ExportFormat = 'csv' | 'md' | 'json'

export const EXPORT_CONTENT_TYPE: Record<ExportFormat, string> = {
  csv:  'text/csv; charset=utf-8',
  md:   'text/markdown; charset=utf-8',
  json: 'application/json; charset=utf-8',
}

export const EXPORT_EXTENSION: Record<ExportFormat, string> = {
  csv: 'csv', md: 'md', json: 'json',
}

export function isValidFormat(value: unknown): value is ExportFormat {
  return value === 'csv' || value === 'md' || value === 'json'
}

export function formatConversations(convos: ExportConversation[], format: ExportFormat): string {
  if (format === 'json') return JSON.stringify(convos, null, 2)
  if (format === 'md') return convos.map(formatMarkdown).join('\n\n---\n\n')
  return formatCsv(convos)
}

function formatMarkdown(c: ExportConversation): string {
  const visitor = c.visitor
  const v = visitor?.name || visitor?.email || 'Visitor'
  const header = [
    `# Conversation ${c.id}`,
    `**Visitor:** ${escapeMd(v)}${visitor?.email ? ` (${visitor.email})` : ''}`,
    c.brand ? `**Brand:** ${escapeMd(c.brand.name)}` : null,
    c.widget ? `**Widget:** ${escapeMd(c.widget.name ?? 'unnamed')}` : null,
    `**Status:** ${c.status}`,
    `**Started:** ${toIso(c.createdAt)}`,
    `**Last activity:** ${toIso(c.lastMessageAt)}`,
    c.assignedUser ? `**Assigned to:** ${escapeMd(c.assignedUser.name || c.assignedUser.email || 'unknown')}` : null,
    typeof c.csatRating === 'number' ? `**CSAT:** ${c.csatRating}/5${c.csatComment ? ` — "${escapeMd(c.csatComment)}"` : ''}` : null,
    c.initiatedUrl ? `**Started on:** ${c.initiatedUrl}` : null,
  ].filter(Boolean).join('\n')

  const lines = c.messages.map(m => {
    const who = m.role === 'agent'  ? '**Agent**'
              : m.role === 'visitor' ? `**${escapeMd(v)}**`
              : '*system*'
    const ts = toIso(m.createdAt)
    return `> _${ts}_ — ${who}\n> ${escapeMd(m.content).replace(/\n/g, '\n> ')}`
  }).join('\n\n')

  return `${header}\n\n${lines}`
}

function formatCsv(convos: ExportConversation[]): string {
  const header = ['conversation_id', 'visitor', 'brand', 'widget', 'status', 'timestamp', 'role', 'content']
  const rows: string[][] = [header]
  for (const c of convos) {
    const v = c.visitor?.name || c.visitor?.email || ''
    const b = c.brand?.name || ''
    const w = c.widget?.name || ''
    for (const m of c.messages) {
      rows.push([
        c.id, v, b, w, c.status,
        toIso(m.createdAt), m.role, m.content,
      ])
    }
  }
  return rows.map(r => r.map(csvCell).join(',')).join('\n')
}

function csvCell(value: string): string {
  // Quote on comma, quote, newline. Escape internal quotes by
  // doubling. Excel-safe.
  if (/[",\n]/.test(value)) {
    return '"' + value.replace(/"/g, '""') + '"'
  }
  return value
}

function escapeMd(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/`/g, '\\`')
}

function toIso(d: Date | string): string {
  return typeof d === 'string' ? d : d.toISOString()
}
