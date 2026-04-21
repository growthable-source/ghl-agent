/**
 * Merge field renderer
 *
 * Replaces {{token}} placeholders in pre-written templates with contact /
 * agent / date values before a message is sent. Used anywhere a user-authored
 * string goes out verbatim (follow-up steps, fixed-mode trigger first
 * messages, voice call opener/closer, fallback replies, widget greetings,
 * scheduled messages).
 *
 * NOT used for anything the agent writes itself — the LLM already has contact
 * data in its context and personalises naturally.
 *
 * ── Syntax ────────────────────────────────────────────────────────────────
 *   {{contact.first_name}}           → "Ryan"   (empty → "")
 *   {{contact.first_name|there}}     → "Ryan" or "there" if empty
 *   {{custom.quote_total|TBD}}       → GHL custom field by key, with fallback
 *   {{agent.name|our team}}          → agent display name
 *   {{user.name|our team}}           → assigned-user display name
 *   {{date.today}}                   → "Saturday, November 8"
 *
 * ── Supported tokens ──────────────────────────────────────────────────────
 *   contact.first_name | last_name | full_name | email | phone
 *   contact.company    | city      | state     | country
 *   contact.tags                              → comma-joined
 *   custom.<fieldKey>                         → resolved from GHL customFields
 *   agent.name                                → agent display name
 *   user.name | first_name | last_name        → assigned team member (CRM user)
 *   user.email | phone | extension
 *   date.today         | date.tomorrow        → locale-friendly dates
 *
 * Unknown tokens render as empty string unless a fallback is given, in which
 * case the fallback is used. The raw `{{token}}` is never left in the output.
 */

import type { Contact, CrmUser } from '@/types'
import type { CrmAdapter } from './crm/types'

export interface MergeFieldContext {
  contact?: Partial<Contact> | null
  agent?: { name?: string | null } | null
  /**
   * Assigned team member — powers {{user.*}} tokens. Callers that have an
   * adapter available should pre-resolve this via resolveAssignedUser()
   * before calling renderMergeFields(), since the renderer itself is
   * synchronous.
   */
  user?: Partial<CrmUser> | null
  /** Contact timezone / locale if you have it, used for date formatting. */
  timezone?: string | null
}

/**
 * Fetch the assigned user for a contact via the CRM adapter. Non-fatal —
 * returns null if the contact has no assignment, if the adapter doesn't
 * implement getUser, or if the API call fails (e.g. missing users.readonly
 * scope on an older token). Intended as a one-liner bridge between the
 * message-sending call sites and the synchronous renderMergeFields.
 */
export async function resolveAssignedUser(
  adapter: Pick<CrmAdapter, 'getUser'> | null | undefined,
  contact: Partial<Contact> | null | undefined,
): Promise<CrmUser | null> {
  if (!adapter?.getUser) return null
  const userId = (contact as any)?.assignedTo
  if (!userId || typeof userId !== 'string') return null
  try { return await adapter.getUser(userId) }
  catch { return null }
}

/**
 * Decorate a contact's customFields with their stable fieldKey values.
 *
 * GHL's /contacts/:id endpoint returns customFields as [{ id, value }] —
 * no fieldKey. Our tokens use the fieldKey ({{custom.quote_total}}), so
 * the renderer can never match without a lookup. This helper fetches
 * the location's custom-field definitions once, builds an id→fieldKey
 * map, and returns a new contact object where each customFields entry
 * carries its key alongside the id+value.
 *
 * Non-fatal: on error or missing customFields, returns the contact
 * unchanged so standard tokens still work.
 */
export async function hydrateContactCustomFields(
  adapter: Pick<CrmAdapter, 'getCustomFields'> | null | undefined,
  contact: Partial<Contact> | null | undefined,
): Promise<Partial<Contact> | null | undefined> {
  if (!adapter?.getCustomFields || !contact) return contact
  const fields = (contact as any).customFields as
    | Array<{ id?: string; key?: string; fieldKey?: string; value?: string }>
    | undefined
  if (!Array.isArray(fields) || fields.length === 0) return contact
  // If every entry already has a key/fieldKey, skip the lookup.
  if (fields.every(f => f.key || f.fieldKey)) return contact
  try {
    const defs = await adapter.getCustomFields()
    if (!defs?.length) return contact
    const idToKey = new Map<string, string>()
    for (const d of defs) {
      if (d.id && d.fieldKey) idToKey.set(d.id, d.fieldKey)
    }
    if (idToKey.size === 0) return contact
    return {
      ...contact,
      customFields: fields.map(f => ({
        ...f,
        key: f.key ?? (f.id ? idToKey.get(f.id) : undefined) ?? f.fieldKey,
      })) as any,
    }
  } catch {
    return contact
  }
}

// Regex captures: whole match, token path, optional |fallback.
// Allows dots, underscores, dashes, letters, digits in both parts.
// Non-greedy fallback capture so `}}` terminates cleanly.
const TOKEN_RE = /\{\{\s*([a-zA-Z0-9_.\-]+)\s*(?:\|\s*([^}]*?)\s*)?\}\}/g

export function renderMergeFields(template: string, ctx: MergeFieldContext): string {
  if (!template) return template
  return template.replace(TOKEN_RE, (_match, path: string, fallback?: string) => {
    const value = resolveToken(path, ctx)
    if (value !== null && value !== undefined && String(value).trim().length > 0) {
      return String(value)
    }
    return fallback ?? ''
  })
}

function resolveToken(path: string, ctx: MergeFieldContext): string | null {
  const contact = ctx.contact ?? null
  const agent = ctx.agent ?? null
  const user = ctx.user ?? null
  const [ns, ...rest] = path.split('.')
  const key = rest.join('.')

  switch (ns) {
    case 'contact':
      return contactToken(contact, key)
    case 'custom':
      return customFieldToken(contact, key)
    case 'agent':
      if (key === 'name') return agent?.name ?? null
      return null
    case 'user':
      return userToken(user, key)
    case 'date':
      return dateToken(key, ctx.timezone ?? undefined)
    default:
      return null
  }
}

function userToken(user: Partial<CrmUser> | null, key: string): string | null {
  if (!user) return null
  switch (key) {
    case 'first_name':
    case 'firstname':
      return user.firstName ?? extractFirst(user.name ?? undefined) ?? null
    case 'last_name':
    case 'lastname':
      return user.lastName ?? extractLast(user.name ?? undefined) ?? null
    case 'full_name':
    case 'name':
      return user.name ?? joinName(user.firstName, user.lastName)
    case 'email':     return user.email ?? null
    case 'phone':     return user.phone ?? null
    case 'extension': return user.extension ?? null
    default:          return null
  }
}

function contactToken(contact: Partial<Contact> | null, key: string): string | null {
  if (!contact) return null
  switch (key) {
    case 'first_name':
    case 'firstname':
      return contact.firstName ?? extractFirst(contact.name) ?? null
    case 'last_name':
    case 'lastname':
      return contact.lastName ?? extractLast(contact.name) ?? null
    case 'full_name':
    case 'name':
      return contact.name ?? joinName(contact.firstName, contact.lastName)
    case 'email':   return contact.email ?? null
    case 'phone':   return contact.phone ?? null
    case 'tags':    return contact.tags?.length ? contact.tags.join(', ') : null
    // GHL-style address fields live on the raw contact; cast-through is fine
    // because the Contact type trims to what's typically useful.
    case 'company': return (contact as any).companyName ?? (contact as any).company ?? null
    case 'city':    return (contact as any).city ?? null
    case 'state':   return (contact as any).state ?? null
    case 'country': return (contact as any).country ?? null
    default:        return null
  }
}

function customFieldToken(contact: Partial<Contact> | null, fieldKey: string): string | null {
  // GHL returns customFields as [{ id, key, value }]. Match by either — keys
  // are the stable identifier users type here, but some older rows only have id.
  const fields = (contact as any)?.customFields as Array<{ id?: string; key?: string; value?: string }> | undefined
  if (!fields?.length) return null
  const hit = fields.find(f => f.key === fieldKey || f.id === fieldKey)
  return hit?.value ?? null
}

function dateToken(key: string, timezone?: string): string | null {
  const now = new Date()
  const opts: Intl.DateTimeFormatOptions = {
    weekday: 'long', month: 'long', day: 'numeric',
    ...(timezone ? { timeZone: timezone } : {}),
  }
  switch (key) {
    case 'today':    return now.toLocaleDateString('en-US', opts)
    case 'tomorrow': {
      const t = new Date(now.getTime() + 24 * 60 * 60 * 1000)
      return t.toLocaleDateString('en-US', opts)
    }
    default: return null
  }
}

function extractFirst(full?: string): string | null {
  if (!full) return null
  const parts = full.trim().split(/\s+/)
  return parts[0] || null
}
function extractLast(full?: string): string | null {
  if (!full) return null
  const parts = full.trim().split(/\s+/)
  return parts.length > 1 ? parts[parts.length - 1] : null
}
function joinName(first?: string | null, last?: string | null): string | null {
  const s = [first, last].filter(Boolean).join(' ').trim()
  return s || null
}

/**
 * Catalogue used by the UI helper — name, description, token string, example.
 * Keep in sync with resolveToken above. Adding a new entry here AND supporting
 * it in resolveToken is the full cost of a new merge field.
 */
export interface MergeFieldSpec {
  token: string
  label: string
  example: string
  group: 'Contact' | 'Custom' | 'Agent' | 'User' | 'Date'
}

export const MERGE_FIELDS: MergeFieldSpec[] = [
  { token: '{{contact.first_name}}', label: 'First name',      example: 'Ryan',                 group: 'Contact' },
  { token: '{{contact.last_name}}',  label: 'Last name',       example: 'Johnson',              group: 'Contact' },
  { token: '{{contact.full_name}}',  label: 'Full name',       example: 'Ryan Johnson',         group: 'Contact' },
  { token: '{{contact.email}}',      label: 'Email',           example: 'ryan@example.com',     group: 'Contact' },
  { token: '{{contact.phone}}',      label: 'Phone',           example: '+14155551234',         group: 'Contact' },
  { token: '{{contact.company}}',    label: 'Company',         example: 'Acme Corp',            group: 'Contact' },
  { token: '{{contact.city}}',       label: 'City',            example: 'Brisbane',             group: 'Contact' },
  { token: '{{contact.state}}',      label: 'State',           example: 'QLD',                  group: 'Contact' },
  { token: '{{contact.country}}',    label: 'Country',         example: 'Australia',            group: 'Contact' },
  { token: '{{contact.tags}}',       label: 'Tags',            example: 'hot-lead, vip',        group: 'Contact' },
  { token: '{{agent.name}}',         label: 'Agent name',      example: 'Alex',                 group: 'Agent'   },
  // Assigned team member — CRM "owner" of the contact, resolved from
  // contact.assignedTo via the adapter. Empty if nothing is assigned.
  { token: '{{user.name}}',          label: 'Assigned user',   example: 'Jamie Lee',            group: 'User'    },
  { token: '{{user.first_name}}',    label: 'Assigned first',  example: 'Jamie',                group: 'User'    },
  { token: '{{user.last_name}}',     label: 'Assigned last',   example: 'Lee',                  group: 'User'    },
  { token: '{{user.email}}',         label: 'Assigned email',  example: 'jamie@acme.com',       group: 'User'    },
  { token: '{{user.phone}}',         label: 'Assigned phone',  example: '+14155559876',         group: 'User'    },
  { token: '{{date.today}}',         label: 'Today',           example: 'Saturday, November 8', group: 'Date'    },
  { token: '{{date.tomorrow}}',      label: 'Tomorrow',        example: 'Sunday, November 9',   group: 'Date'    },
]
