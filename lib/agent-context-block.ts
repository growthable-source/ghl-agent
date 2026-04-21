/**
 * Advanced-agent context block builder.
 *
 * Only used when `agent.agentType === 'ADVANCED'`. Assembles a compact
 * markdown-ish block that's injected into the system prompt on every turn,
 * giving the LLM:
 *   - the contact's custom fields (only those with values)
 *   - the contact's opportunities from the last 2 quarters (~6 months),
 *     SPLIT BY STATUS — Open (revenue potential), Won (captured LTV),
 *     Lost/Abandoned (ruled out) — each with a subtotal so the agent
 *     can reason about how much is still on the table vs banked vs gone.
 *   - the operator's businessContext glossary at the top, so the LLM
 *     interprets the data through the right business lens
 *
 * Per-bucket caps keep token cost predictable — the `get_opportunities`
 * tool remains available for deeper drill-down beyond what's pre-loaded.
 */

import type { Contact, CrmUser, Opportunity } from '@/types'
import type { CrmAdapter } from './crm/types'
import {
  hydrateContactCustomFields,
  hydrateOpportunityCustomFields,
  renderMergeFields,
  resolveAssignedUser,
} from './merge-fields'

// Keep the footprint predictable. The tool path covers anything beyond.
const WINDOW_DAYS = 182                 // ~2 quarters
const MAX_OPEN_OPPS = 8
const MAX_WON_OPPS = 5
const MAX_LOST_OPPS = 5

type Bucket = 'open' | 'won' | 'lost'

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
  if (!adapter || !contact) {
    // No live data — still render the glossary, but without merge-field
    // resolution (no contact to merge against) so tokens fall back to their
    // `|fallback` values or render empty.
    return businessContext ? wrapGlossary(businessContext, null, null) : ''
  }

  // Fetch opportunities + hydrate custom fields + resolve the assigned user
  // in parallel. Wrap each call so one failure doesn't take the block down.
  const [hydratedContactRaw, rawOpps, assignedUser] = await Promise.all([
    hydrateContactCustomFields(adapter, contact).catch(() => contact),
    fetchOpportunitiesSafe(adapter, contact.id ?? ''),
    resolveAssignedUser(adapter, contact).catch(() => null),
  ])
  const hydratedContact = hydratedContactRaw ?? contact

  const cutoffMs = Date.now() - WINDOW_DAYS * 86_400_000
  const windowed = rawOpps.filter(o => {
    const ts = Date.parse(o.updatedAt || o.createdAt || '') || 0
    return ts >= cutoffMs
  })

  // Three buckets. Open = live opportunity (revenue still in play);
  // Won = captured revenue / lifetime value; Lost/Abandoned = ruled
  // out. Sort each newest-first so the most recent activity in each
  // bucket wins the cap when we truncate.
  const openAll = windowed.filter(o => bucketOf(o) === 'open').sort(byUpdatedDesc)
  const wonAll = windowed.filter(o => bucketOf(o) === 'won').sort(byUpdatedDesc)
  const lostAll = windowed.filter(o => bucketOf(o) === 'lost').sort(byUpdatedDesc)

  const openShown = openAll.slice(0, MAX_OPEN_OPPS)
  const wonShown = wonAll.slice(0, MAX_WON_OPPS)
  const lostShown = lostAll.slice(0, MAX_LOST_OPPS)

  const hydratedOpps = await hydrateOpportunityCustomFields(adapter, [
    ...openShown, ...wonShown, ...lostShown,
  ]).catch(() => [...openShown, ...wonShown, ...lostShown])
  const hOpen = hydratedOpps.slice(0, openShown.length)
  const hWon = hydratedOpps.slice(openShown.length, openShown.length + wonShown.length)
  const hLost = hydratedOpps.slice(openShown.length + wonShown.length)

  // Totals run across the *full* bucket (not just the shown slice) so the
  // agent sees the real revenue-potential / LTV / lost-revenue numbers,
  // even when a bucket has more entries than we inline.
  const openTotal = sumMonetary(openAll)
  const wonTotal = sumMonetary(wonAll)
  const lostTotal = sumMonetary(lostAll)

  // Assemble. Merge fields inside the glossary (e.g. {{contact.first_name|the contact}})
  // are rendered against the hydrated contact + resolved user, so operators
  // can personalise the business context itself — not just pre-written
  // messages. Unresolved tokens fall back to their `|fallback` value or empty.
  const parts: string[] = []
  if (businessContext && businessContext.trim()) {
    parts.push(wrapGlossary(businessContext, hydratedContact as Contact, assignedUser))
  }

  const customFieldLines = formatContactCustomFields(hydratedContact as Contact)
  const openLines = formatOpportunities(hOpen, 'open')
  const wonLines = formatOpportunities(hWon, 'won')
  const lostLines = formatOpportunities(hLost, 'lost')

  if (customFieldLines.length === 0
      && openLines.length === 0
      && wonLines.length === 0
      && lostLines.length === 0) {
    // No business data to share — just return the glossary (or nothing).
    return parts.join('\n\n')
  }

  parts.push('## Contact Context')

  if (customFieldLines.length > 0) {
    parts.push('### Custom fields\n' + customFieldLines.join('\n'))
  }

  // Each bucket gets its own heading with a subtotal so the agent can
  // reason about revenue status at a glance:
  //   - Open = still-closable pipeline value
  //   - Won  = captured LTV (how much we've earned from this contact)
  //   - Lost = missed / ruled-out revenue (don't re-pitch these outright)
  if (openLines.length > 0) {
    const header = `### Open opportunities — ${openAll.length} live inquir${openAll.length === 1 ? 'y' : 'ies'}, ${formatMoney(openTotal)} still in play`
    parts.push(`${header}\n${openLines.join('\n')}`)
  }

  if (wonLines.length > 0) {
    const header = `### Won deals — ${wonAll.length} closed in last ${monthsLabel()}, ${formatMoney(wonTotal)} captured`
    parts.push(`${header}\n${wonLines.join('\n')}`)
  }

  if (lostLines.length > 0) {
    const header = `### Lost / abandoned — ${lostAll.length} in last ${monthsLabel()}, ${formatMoney(lostTotal)} missed`
    parts.push(`${header}\n${lostLines.join('\n')}`)
  }

  // Hint the agent about the tool when we've truncated any bucket.
  const hidden = (openAll.length - openShown.length)
    + (wonAll.length - wonShown.length)
    + (lostAll.length - lostShown.length)
  if (hidden > 0) {
    parts.push(`> Note: ${hidden} additional opportunit${hidden === 1 ? 'y exists' : 'ies exist'} in this window (older entries within each bucket). Call \`get_opportunities\` if the contact references something not listed above.`)
  }

  return parts.join('\n\n')
}

function bucketOf(o: Opportunity): Bucket {
  const s = (o.status ?? '').toLowerCase()
  if (s === 'won') return 'won'
  if (s === 'lost' || s === 'abandoned') return 'lost'
  // Anything else (open / undefined / unknown statuses) counts as live
  // so we don't hide revenue potential behind a typo.
  return 'open'
}

function sumMonetary(opps: Opportunity[]): number {
  return opps.reduce((acc, o) => {
    const v = typeof o.monetaryValue === 'number' ? o.monetaryValue : 0
    return acc + (Number.isFinite(v) ? v : 0)
  }, 0)
}

function monthsLabel(): string {
  const months = Math.round(WINDOW_DAYS / 30)
  return `${months} months`
}

// ─── helpers ───────────────────────────────────────────────────────────────

function wrapGlossary(
  text: string,
  contact: Partial<Contact> | null | undefined,
  user: CrmUser | null | undefined,
): string {
  // Render merge-field tokens inside the glossary before it's handed to
  // the LLM. Lets operators write things like "This contact's budget is
  // {{custom.budget_cap|not disclosed}}" and have it resolve per-contact.
  const rendered = renderMergeFields(text, { contact, user })
  return `## Business Context\n\n${rendered.trim()}`
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

function formatOpportunities(opps: Opportunity[], bucket: Bucket): string[] {
  return opps.map((o, i) => {
    const price = formatMoney(o.monetaryValue)
    // What we tack onto the end of the headline varies by bucket so the
    // reading experience matches the relevance of the detail:
    //   open → current stage (what's the next step?)
    //   won  → close date (when did we bank this?)
    //   lost → close date + explicit status subtype (lost vs abandoned)
    let trailer = ''
    if (bucket === 'open') {
      if (o.pipelineStageId) trailer = ` — stage: ${o.pipelineStageId}`
    } else if (bucket === 'won') {
      const d = shortDate(o.updatedAt || o.createdAt)
      trailer = d ? ` — sold ${d}` : ''
    } else {
      // lost / abandoned — differentiate them, the agent behaves
      // differently depending on whether the contact actively bailed
      // or just went dark.
      const sub = (o.status ?? '').toLowerCase() === 'abandoned' ? 'abandoned' : 'lost'
      const d = shortDate(o.updatedAt || o.createdAt)
      trailer = d ? ` — ${sub} ${d}` : ` — ${sub}`
    }
    const headline = `${i + 1}. ${o.name || 'Unnamed opportunity'} — ${price}${trailer}`
    const fieldLines = formatOpportunityCustomFields(o.customFields as any)
    return fieldLines.length > 0 ? `${headline}\n   ${fieldLines.join(', ')}` : headline
  })
}

function shortDate(iso: string | undefined): string {
  if (!iso) return ''
  const t = Date.parse(iso)
  if (!t) return ''
  // YYYY-MM-DD — compact, unambiguous, locale-independent.
  return new Date(t).toISOString().slice(0, 10)
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
