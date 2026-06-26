/**
 * Resolve the best deep link for a human-handover notification.
 *
 * Routing rules:
 *   - Widget locationId (starts with `widget:`) OR Live_Chat channel
 *       → Xovera inbox (the only place widget conversations exist).
 *   - GHL-backed location (crmProvider === 'ghl')
 *       → LeadConnector conversations UI with the conversationId, or
 *         the GHL contact detail page when we don't have a conversation.
 *   - Native / HubSpot / unknown
 *       → Xovera's own contacts/inbox surface. Sending these to
 *         app.gohighlevel.com 404s, which is what we fix here.
 *
 * Pure function — callers pass what they have, we pick what works.
 *
 * Callers that don't yet pass `crmProvider` get the old behaviour
 * (assume GHL when locationId is non-widget) for backward compat —
 * but every call site shipped after 2026-05-28 should set it.
 */

export interface HandoverLinkContext {
  workspaceId?: string | null
  /**
   * The raw location id we stored. For widget traffic this is
   * `widget:<widgetId>`; for GHL/HubSpot/native it's the provider-
   * specific or workspace-prefixed location id.
   */
  locationId?: string | null
  contactId?: string | null
  conversationId?: string | null
  /** Where the public user is coming from — set by runAgent callers. */
  channel?: string | null
  /**
   * The Location.crmProvider value. Required to disambiguate native /
   * hubspot / ghl when locationId alone isn't a strong enough signal.
   * Optional for backward-compat with old callers — they get the
   * assume-GHL behaviour from before this field existed.
   */
  crmProvider?: 'ghl' | 'hubspot' | 'native' | 'none' | null
}

export function resolveHandoverLink(ctx: HandoverLinkContext): string {
  const appUrl = (process.env.APP_URL || '').replace(/\/$/, '')
  const { workspaceId, locationId, contactId, conversationId, channel, crmProvider } = ctx

  // Widget conversations aren't in any CRM — the inbox page is the only
  // place to pick them up.
  if (locationId?.startsWith('widget:') || channel === 'Live_Chat') {
    if (workspaceId && conversationId) {
      return `${appUrl}/dashboard/${workspaceId}/inbox/${conversationId}`
    }
    if (workspaceId) return `${appUrl}/dashboard/${workspaceId}/inbox`
    return `${appUrl}/dashboard`
  }

  // GHL: explicit crmProvider win, OR legacy callers without the field
  // (treated as GHL for backward compat — pre-2026-05-28 behaviour).
  const isGhl = crmProvider === 'ghl' || (crmProvider == null && !!locationId)
  if (isGhl && locationId && conversationId) {
    return `https://app.gohighlevel.com/v2/location/${locationId}/conversations/conversations/${conversationId}`
  }
  if (isGhl && locationId && contactId) {
    return `https://app.gohighlevel.com/v2/location/${locationId}/contacts/detail/${contactId}`
  }

  // Native / HubSpot / unknown: Xovera-side contacts page is the
  // operator's actual destination. Sending these to GHL 404s.
  if (workspaceId && contactId) {
    return `${appUrl}/dashboard/${workspaceId}/contacts/${contactId}`
  }
  if (workspaceId) return `${appUrl}/dashboard/${workspaceId}/inbox`
  return `${appUrl}/dashboard`
}
