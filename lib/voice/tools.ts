/**
 * Voice-safe tool allowlist.
 *
 * Read by /api/voice/agent-turn when filtering the agent's tool
 * catalogue down to what makes sense on a live voice call.
 *
 * Excluded by design:
 *   - send_reply / send_sms / send_email / send_sms_followup —
 *     voice IS the messaging modality on a call; an outgoing SMS
 *     belongs in a post-call follow-up, not mid-conversation.
 *   - update_contact_field / upsert_contact / create_task /
 *     add_to_workflow / remove_from_workflow / cancel_scheduled_message —
 *     non-trivial state mutations better authored as Plays
 *     (deterministic rules), not invoked from voice mishearings.
 *   - update_contact_tags / remove_contact_tags — same reasoning.
 *   - book_appointment / get_available_slots — voice has the
 *     existing hardcoded VAPI_TOOLS surface for booking; revisit
 *     when we unify the two paths.
 *
 * Included:
 *   - Pure read tools (contacts, opportunities, pipelines, calendar).
 *   - All Shopify reads + the three Shopify writes (which have
 *     adapter-side guardrails: 50%/$200 discount caps, draft-order
 *     line-item bounds, single-shop scoping on interest signals).
 */

export const VOICE_SAFE_TOOL_NAMES = new Set([
  'get_contact_details',
  'find_contact_by_email_or_phone',
  'get_opportunities',
  'list_pipelines',
  'get_calendar_events',
  'search_shopify_products',
  'check_shopify_inventory',
  'lookup_shopify_customer',
  'check_shopify_order_status',
  'create_shopify_checkout',
  'create_shopify_discount',
  'record_back_in_stock_interest',
])
