-- ═══════════════════════════════════════════════════════════════════════════
-- Full Tools Backfill — append all newly-added GHL Contacts/Conversations/
-- Opportunities tools to every existing agent's enabledTools array.
--
-- Safe: uses DISTINCT unnest so existing tools are preserved and no duplicates.
-- Idempotent — running twice is a no-op.
-- ═══════════════════════════════════════════════════════════════════════════

UPDATE "Agent"
SET "enabledTools" = (
  SELECT ARRAY(SELECT DISTINCT unnest("enabledTools" || ARRAY[
    'send_email',
    'remove_contact_tags',
    'find_contact_by_email_or_phone',
    'upsert_contact',
    'create_task',
    'add_to_workflow',
    'remove_from_workflow',
    'cancel_scheduled_message',
    'list_contact_conversations',
    'mark_opportunity_won',
    'mark_opportunity_lost',
    'upsert_opportunity',
    'list_pipelines'
  ]::text[]))
);
