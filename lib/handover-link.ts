/**
 * Resolve the best deep link for a human-handover notification.
 *
 * What "best" means depends on where the conversation lives:
 *   - CRM-backed (GHL): link straight to the GHL conversations UI so the
 *     rep lands on the thread with the contact. Uses the public
 *     app.gohighlevel.com URL (v2 location scope).
 *   - Widget: link to the Voxility dashboard inbox — widget conversations
 *     don't exist in the CRM.
 *   - Twilio-direct / unknown: fall back to the dashboard inbox, filtered
 *     to the contact if we have an ID.
 *
 * Kept as a single pure function so the handover executor doesn't need to
 * know the URL shapes. Callers pass what they have; we pick what works.
 */

export interface HandoverLinkContext {
  workspaceId?: string | null
  /**
   * The raw location id we stored. For widget traffic this is
   * `widget:<widgetId>`; for GHL it's the GHL sub-account location id.
   */
  locationId?: string | null
  contactId?: string | null
  conversationId?: string | null
  /** Where the public user is coming from — set by runAgent callers. */
  channel?: string | null
}

export function resolveHandoverLink(ctx: HandoverLinkContext): string {
  const appUrl = (process.env.APP_URL || '').replace(/\/$/, '')
  const { workspaceId, locationId, contactId, conversationId, channel } = ctx

  // Widget conversations aren't in any CRM — the inbox page is the only
  // place to pick them up.
  if (locationId?.startsWith('widget:') || channel === 'Live_Chat') {
    if (workspaceId && conversationId) {
      return `${appUrl}/dashboard/${workspaceId}/inbox/${conversationId}`
    }
    if (workspaceId) return `${appUrl}/dashboard/${workspaceId}/inbox`
    return `${appUrl}/dashboard`
  }

  // GHL: if we have a conversationId go straight to the thread; otherwise
  // drop into the contact's conversations tab. Both URLs require the
  // recipient to already be signed into GHL — safe, just not useful for
  // someone without access.
  if (locationId && conversationId) {
    return `https://app.gohighlevel.com/v2/location/${locationId}/conversations/conversations/${conversationId}`
  }
  if (locationId && contactId) {
    return `https://app.gohighlevel.com/v2/location/${locationId}/contacts/detail/${contactId}`
  }

  // Unknown / Twilio-direct: dashboard fallback. Better than a dead link.
  if (workspaceId && contactId) {
    return `${appUrl}/dashboard/${workspaceId}/contacts/${contactId}`
  }
  if (workspaceId) return `${appUrl}/dashboard/${workspaceId}/inbox`
  return `${appUrl}/dashboard`
}
