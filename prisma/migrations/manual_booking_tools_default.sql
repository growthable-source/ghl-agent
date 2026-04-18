-- ═══════════════════════════════════════════════════════════════════════════
-- Add booking tools to existing agents that are missing them.
-- New agents get these by default via Prisma schema.
-- Safe to run multiple times.
-- ═══════════════════════════════════════════════════════════════════════════

-- Append the three booking tools to any Agent whose enabledTools array
-- doesn't already contain them. array_append avoids duplicates when combined
-- with the NOT (...) @> ARRAY[...] check.
UPDATE "Agent"
SET "enabledTools" = (
  SELECT ARRAY(SELECT DISTINCT unnest("enabledTools" || ARRAY['get_available_slots','book_appointment','create_appointment_note']))
)
WHERE "calendarId" IS NOT NULL
  AND NOT ("enabledTools" @> ARRAY['get_available_slots','book_appointment']::text[]);
