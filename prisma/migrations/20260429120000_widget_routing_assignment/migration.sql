-- Operator assignment + routing for widget conversations.
-- All additive — existing rows get safe defaults so nothing in the inbox
-- needs migrating before this lands.

-- WorkspaceMember: presence flag for the inbox routing engine.
ALTER TABLE "WorkspaceMember"
  ADD COLUMN IF NOT EXISTS "isAvailable" BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS "availabilityChangedAt" TIMESTAMP;

CREATE INDEX IF NOT EXISTS "WorkspaceMember_workspaceId_isAvailable_idx"
  ON "WorkspaceMember"("workspaceId", "isAvailable");

-- ChatWidget: routing config — mode, eligible users, round-robin cursor.
ALTER TABLE "ChatWidget"
  ADD COLUMN IF NOT EXISTS "routingMode" TEXT NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS "routingTargetUserIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN IF NOT EXISTS "routingLastAssignedUserId" TEXT;

-- WidgetConversation: assignee + audit fields.
ALTER TABLE "WidgetConversation"
  ADD COLUMN IF NOT EXISTS "assignedUserId" TEXT,
  ADD COLUMN IF NOT EXISTS "assignedAt" TIMESTAMP,
  ADD COLUMN IF NOT EXISTS "assignmentReason" TEXT;

CREATE INDEX IF NOT EXISTS "WidgetConversation_assignedUserId_status_idx"
  ON "WidgetConversation"("assignedUserId", "status");

-- FK on assignedUserId → User.id with SET NULL so deleting a user doesn't
-- delete their open conversations; they just become unassigned.
DO $$ BEGIN
  ALTER TABLE "WidgetConversation"
    ADD CONSTRAINT "WidgetConversation_assignedUserId_fkey"
    FOREIGN KEY ("assignedUserId") REFERENCES "User"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
