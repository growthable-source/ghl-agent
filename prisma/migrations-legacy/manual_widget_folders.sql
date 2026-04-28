-- Folders for organizing widgets, plus folderId on ChatWidget. Additive.

CREATE TABLE IF NOT EXISTS "WidgetFolder" (
  "id"          TEXT PRIMARY KEY,
  "workspaceId" TEXT NOT NULL,
  "name"        TEXT NOT NULL,
  "color"       TEXT,
  "order"       INTEGER NOT NULL DEFAULT 0,
  "createdAt"   TIMESTAMP NOT NULL DEFAULT NOW(),
  "updatedAt"   TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS "WidgetFolder_workspaceId_order_idx"
  ON "WidgetFolder"("workspaceId", "order");

ALTER TABLE "ChatWidget"
  ADD COLUMN IF NOT EXISTS "folderId" TEXT;
CREATE INDEX IF NOT EXISTS "ChatWidget_folderId_idx" ON "ChatWidget"("folderId");
