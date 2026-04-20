import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'
import { processContactTrigger } from '@/lib/triggers'
import { getCrmAdapter } from '@/lib/crm/factory'

/**
 * POST /api/workspaces/:ws/agents/:agentId/triggers/:triggerId/test-fire
 *
 * Dry-run a single trigger against a specific contact. Used by the
 * "Test fire" button on the triggers page so operators can verify their
 * setup (channel deployment, tag filter, fixed-message merge fields,
 * AI-generation logic) without waiting for a real GHL webhook.
 *
 * Body:
 *   { contact: "<contactId|phoneNumber|email>" }
 *
 * If the input doesn't look like a contact ID (no "ghl" prefix / not a
 * cuid-ish string), we resolve it via the CRM adapter's searchContacts.
 * Phone numbers are looked up without country-code normalisation — caller
 * should pass E.164 or match how the contact is stored in GHL.
 *
 * Returns the same shape processContactTrigger returns — fired count,
 * skipped count, and human-readable skip reasons — so the UI can surface
 * why a fire didn't happen (tag mismatch, channel not deployed, etc.).
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ workspaceId: string; agentId: string; triggerId: string }> },
) {
  const { workspaceId, agentId, triggerId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  let body: { contact?: string } = {}
  try { body = await req.json() } catch {}
  const rawContact = (body.contact ?? '').trim()
  if (!rawContact) {
    return NextResponse.json({ error: 'contact (id, phone, or email) required' }, { status: 400 })
  }

  // Load the trigger + its agent so we know the locationId + eventType.
  const trigger = await db.agentTrigger.findFirst({
    where: { id: triggerId, agentId, agent: { workspaceId } },
    include: { agent: { select: { locationId: true, isActive: true } } },
  })
  if (!trigger) return NextResponse.json({ error: 'Trigger not found' }, { status: 404 })
  if (!trigger.isActive) return NextResponse.json({ error: 'Trigger is disabled — turn it on before testing' }, { status: 400 })
  if (!trigger.agent.isActive) return NextResponse.json({ error: 'Agent is paused — activate it before testing' }, { status: 400 })

  const locationId = trigger.agent.locationId
  if (locationId.startsWith('placeholder:')) {
    return NextResponse.json({ error: 'This workspace has not connected a CRM yet. Connect GoHighLevel to test triggers.' }, { status: 400 })
  }

  // Resolve the contact. Bare id path is a GHL cuid-ish; anything else
  // gets funneled through search so "+14155551234" or "jane@acme.com" work.
  // We only hit search when the input doesn't look like a raw id to save a
  // round-trip when the user already has one.
  let contactId = rawContact
  let resolvedTags: string[] = []
  const looksLikeId = /^[a-zA-Z0-9]{20,}$/.test(rawContact)
  try {
    if (!looksLikeId) {
      const crm = await getCrmAdapter(locationId)
      const matches = await crm.searchContacts(rawContact)
      if (!matches.length) {
        return NextResponse.json({
          error: `No contact found matching "${rawContact}". Try the raw contact id, an exact phone (E.164), or the email on file.`,
        }, { status: 404 })
      }
      contactId = matches[0].id
      resolvedTags = matches[0].tags ?? []
    } else {
      // Even with an id, fetch tags so the tag-filter dry-run matches
      // what a real ContactTagUpdate event would carry.
      const crm = await getCrmAdapter(locationId)
      const contact = await crm.getContact(contactId).catch(() => null)
      resolvedTags = contact?.tags ?? []
    }
  } catch (err: any) {
    return NextResponse.json({ error: `Contact lookup failed: ${err.message || 'unknown error'}` }, { status: 500 })
  }

  // For a ContactTagUpdate test, synthesise the tag array that would come
  // in on the webhook — include the trigger's tagFilter so the filter check
  // passes. Users expect "Test fire on contact X" to reach the send step,
  // not be skipped at the tag gate.
  const tagsForEvent = trigger.eventType === 'ContactTagUpdate' && trigger.tagFilter
    ? Array.from(new Set([...(resolvedTags || []), trigger.tagFilter]))
    : (resolvedTags || [])

  const result = await processContactTrigger({
    eventType: trigger.eventType as 'ContactCreate' | 'ContactTagUpdate',
    locationId,
    contactId,
    tags: tagsForEvent,
    triggerIds: [triggerId],
    isTest: true,
  })

  return NextResponse.json({
    ok: true,
    contactId,
    resolvedTags,
    ...result,
  })
}
