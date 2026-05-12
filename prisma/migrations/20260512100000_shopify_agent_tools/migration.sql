-- Shopify reflexes: extend Agent.enabledTools default for new agents
-- and backfill existing agents that live in a Shopify-connected workspace.
-- Strictly additive. Idempotent — safe to re-run.

-- 1. Extend column default. Affects NEW agents only.
ALTER TABLE "Agent" ALTER COLUMN "enabledTools" SET DEFAULT ARRAY[
  'get_contact_details','send_reply','send_sms','send_email',
  'update_contact_tags','remove_contact_tags','get_opportunities',
  'move_opportunity_stage','add_contact_note','get_available_slots',
  'book_appointment','cancel_appointment','reschedule_appointment',
  'create_appointment_note','get_calendar_events',
  'find_contact_by_email_or_phone','upsert_contact','create_task',
  'add_to_workflow','remove_from_workflow','cancel_scheduled_message',
  'list_contact_conversations','mark_opportunity_won','mark_opportunity_lost',
  'upsert_opportunity','list_pipelines',
  'search_shopify_products','check_shopify_inventory',
  'lookup_shopify_customer','check_shopify_order_status'
]::TEXT[];

-- 2. Backfill: only for agents in workspaces that already have a live
-- Shopify connection. Skip workspaces with no Shopify (HR/booking-only
-- agents don't need the tools cluttering their schema). Idempotent: only
-- adds keys that aren't already present.
UPDATE "Agent" a
SET "enabledTools" = a."enabledTools" || (
  SELECT COALESCE(ARRAY_AGG(t), ARRAY[]::TEXT[])
  FROM unnest(ARRAY[
    'search_shopify_products','check_shopify_inventory',
    'lookup_shopify_customer','check_shopify_order_status'
  ]::TEXT[]) t
  WHERE t <> ALL(a."enabledTools")
)
WHERE EXISTS (
  SELECT 1 FROM "ShopifyShop" s
  WHERE s."workspaceId" = a."workspaceId"
    AND s."uninstalledAt" IS NULL
);
