/**
 * Advanced-agent context block builder.
 *
 * Only used when `agent.agentType === 'ADVANCED'`. Assembles a compact
 * markdown-ish block that's injected into the system prompt on every turn,
 * giving the LLM:
 *   - the contact's custom fields (only those with values)
 *   - the contact's opportunities within the last 2 quarters (~6 months),
 *     split into Active / Closed, with monetaryValue + any opportunity
 *     custom fields surfaced inline
 *   - the operator's businessContext glossary at the top, so the LLM
 *     interprets the data through the right business lens
 *
 * The block is capped (top 8 active, top 5 closed within the window) to
 * keep token cost predictable — the `get_opportunities` tool remains
 * available for deeper drill-down beyond what's pre-loaded.
 */

import type { Contact, Opportunity } from '@/types'
import type { CrmAdapter } from './crm/types'
import { hydrateContactCustomFields, hydrateOpportunityCustomFields } from './merge-fields'

// Keep the footprint predictable. The tool path covers anything beyond.
const WINDOW_DAYS = 182                 // ~2 quarters
const MAX_ACTIVE_OPPS = 8
const MAX_CLOSED_OPPS = 5

interface BuildOpts {
  adapter: CrmAdapter
  contact: Partial<Contact> | null | undefined
  businessContext?: string | null
}

/**
 * Returns the full `## Contact Context` block, or the empty string if no
 * context is worth showing. Non-fatal on every CRM call — a partial
 * adapter failure just yields a partial block (or an empty one) rather
 * than blocking the message.
 */
export async function buildContactContextBlock({
  adapter,
  contact,
  businessContext,
}: BuildOpts): Promise<string> {
  if (!adapter || !contact) return businessContext ? wrapGlossary(businessContext) : ''

  // Fetch opportunities + hydrate custom fields in parallel. Wrap each call
  // so one failure doesn't take the block down.
  const [hydratedContactRaw, rawOpps] = await Promise.all([
    hydrateContactCustomFields(adapter, contact).catch(() => contact),
    fetchOpportunitiesSafe(adapter, contact.id ?? ''),
  ])
  const hydratedContact = hydratedContactRaw ?? contact

  const cutoffMs = Date.now() - WINDOW_DAYS * 86_400_000
  const windowed = rawOpps.filter(o => {
    const ts = Date.parse(o.updatedAt || o.createdAt || '') || 0
    return ts >= cutoffMs
  })
  // Active = anything not won/lost/abandoned. Sort newest-first.
  const active = windowed
    .filter(o => !/(won|lost|abandoned)/i.test(o.status ?? ''))
    .sort(byUpdatedDesc)
    .slice(0, MAX_ACTIVE_OPPS)
  const closed = windowed
    .filter(o => /(won|lost|abandoned)/i.test(o.status ?? ''))
    .sort(byUpdatedDesc)
    .slice(0, MAX_CLOSED_OPPS)

  const hydratedOpps = await hydrateOpportunityCustomFields(adapter, [...active, ...closed])
    .catch(() => [...active, ...closed])
  const hActive = hydratedOpps.slice(0, active.length)
  const hClosed = hydratedOpps.slice(active.length)

  // Assemble
  const parts: string[] = []
  if (businessContext && businessContext.trim()) parts.push(wrapGlossary(businessContext))

  const customFieldLines = formatContactCustomFields(hydratedContact as Contact)
  const activeLines = formatOpportunities(hActive)
  const closedLines = formatOpportunities(hClosed)

  if (customFieldLines.length === 0 && activeLines.length === 0 && closedLines.length === 0) {
    // No business data to share — just return the glossary (or nothing).
    return parts.join('\n\n')
  }

  parts.push('## Contact Context')

  if (customFieldLines.length > 0) {
    parts.push('### Custom fields\n' + customFieldLines.join('\n'))
  }

  if (activeLines.length > 0) {
    parts.push(`### Active inquiries (${active.length} of ${rawOpps.filter(o => !/(won|lost|abandoned)/i.test(o.status ?? '')).length})\n` + activeLines.join('\n'))
  }

  if (closedLines.length > 0) {
    parts.push(`### Recent past inquiries (last ${Math.round(WINDOW_DAYS / 30)} months)\n` + closedLines.join('\n'))
  }

  // Hint the agent about the tool when we've truncated.
  const totalOppsInWindow = windowed.length
  if (totalOppsInWindow > active.length + closed.length) {
    parts.push(`> Note: ${totalOppsInWindow - active.length - closed.length} additional opportunit${totalOppsInWindow - active.length - closed.length === 1 ? 'y exists' : 'ies exist'} in this window. Call \`get_opportunities\` if the contact references something not listed above.`)
  }

  return parts.join('\n\n')
}

// ─── helpers ───────────────────────────────────────────────────────────────

function wrapGlossary(text: string): string {
  return `## Business Context\n\n${text.trim()}`
}

function byUpdatedDesc(a: Opportunity, b: Opportunity): number {
  const ta = Date.parse(a.updatedAt || a.createdAt || '') || 0
  const tb = Date.parse(b.updatedAt || b.createdAt || '') || 0
  return tb - ta
}

async function fetchOpportunitiesSafe(adapter: CrmAdapter, contactId: string): Promise<Opportunity[]> {
  if (!contactId) return []
  try { return await adapter.getOpportunitiesForContact(contactId) }
  catch { return [] }
}

function formatContactCustomFields(contact: Contact | null | undefined): string[] {
  const fields = (contact as any)?.customFields as Array<{ key?: string; id?: string; value?: any }> | undefined
  if (!Array.isArray(fields)) return []
  return fields
    .filter(f => f.value !== undefined && f.value !== null && String(f.value).trim() !== '')
    .map(f => `- ${f.key ?? f.id ?? 'unknown'}: ${stringifyValue(f.value)}`)
}

function formatOpportunities(opps: Opportunity[]): string[] {
  return opps.map((o, i) => {
    const price = formatMoney(o.monetaryValue)
    const stage = o.pipelineStageId ? ` stage: ${o.pipelineStageId}` : ''
    const status = o.status ? ` (${o.status})` : ''
    const headline = `${i + 1}. ${o.name || 'Unnamed opportunity'} — ${price}${status}${stage}`
    const fieldLines = formatOpportunityCustomFields(o.customFields as any)
    return fieldLines.length > 0 ? `${headline}\n   ${fieldLines.join(', ')}` : headline
  })
}

function formatOpportunityCustomFields(fields: Array<{ key?: string; id?: string; value?: any }> | undefined): string[] {
  if (!Array.isArray(fields)) return []
  return fields
    .filter(f => f.value !== undefined && f.value !== null && String(f.value).trim() !== '')
    .map(f => `${f.key ?? f.id ?? '?'}=${stringifyValue(f.value)}`)
}

function formatMoney(n: number | undefined): string {
  if (n === undefined || n === null || Number.isNaN(n)) return 'unpriced'
  // USD-only for now — locality comes later. Using the safe Intl path so
  // big numbers render as $45,000 rather than 45000.
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n)
  } catch {
    return `$${n}`
  }
}

function stringifyValue(v: any): string {
  if (v === null || v === undefined) return ''
  if (Array.isArray(v)) return v.map(stringifyValue).join(', ')
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}
