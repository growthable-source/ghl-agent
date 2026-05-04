-- Native CRM: workspace-scoped contacts/lists/messaging for tenants who
-- don't connect an external CRM. Idempotent — every CREATE/ALTER guards
-- against re-application so it's safe to run more than once.

-- ─── NativeContact ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "NativeContact" (
  "id"               TEXT NOT NULL,
  "workspaceId"      TEXT NOT NULL,
  "firstName"        TEXT,
  "lastName"         TEXT,
  "email"            TEXT,
  "phone"            TEXT,
  "tags"             TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "source"           TEXT,
  "customFields"     JSONB,
  "assignedToUserId" TEXT,
  "isSuppressed"     BOOLEAN NOT NULL DEFAULT false,
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "NativeContact_pkey" PRIMARY KEY ("id")
);

DO $$ BEGIN
  ALTER TABLE "NativeContact"
    ADD CONSTRAINT "NativeContact_workspaceId_fkey"
    FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS "NativeContact_workspaceId_email_idx"
  ON "NativeContact"("workspaceId", "email");
CREATE INDEX IF NOT EXISTS "NativeContact_workspaceId_phone_idx"
  ON "NativeContact"("workspaceId", "phone");
CREATE INDEX IF NOT EXISTS "NativeContact_workspaceId_createdAt_idx"
  ON "NativeContact"("workspaceId", "createdAt" DESC);
CREATE INDEX IF NOT EXISTS "NativeContact_workspaceId_isSuppressed_idx"
  ON "NativeContact"("workspaceId", "isSuppressed");

-- ─── NativeContactList ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "NativeContactList" (
  "id"          TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "name"        TEXT NOT NULL,
  "description" TEXT,
  "type"        TEXT NOT NULL DEFAULT 'static',
  "filter"      JSONB,
  "createdBy"   TEXT,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "NativeContactList_pkey" PRIMARY KEY ("id")
);

DO $$ BEGIN
  ALTER TABLE "NativeContactList"
    ADD CONSTRAINT "NativeContactList_workspaceId_fkey"
    FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "NativeContactList_workspaceId_name_key"
  ON "NativeContactList"("workspaceId", "name");
CREATE INDEX IF NOT EXISTS "NativeContactList_workspaceId_createdAt_idx"
  ON "NativeContactList"("workspaceId", "createdAt" DESC);

-- ─── NativeContactListMember ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "NativeContactListMember" (
  "id"        TEXT NOT NULL,
  "listId"    TEXT NOT NULL,
  "contactId" TEXT NOT NULL,
  "addedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "NativeContactListMember_pkey" PRIMARY KEY ("id")
);

DO $$ BEGIN
  ALTER TABLE "NativeContactListMember"
    ADD CONSTRAINT "NativeContactListMember_listId_fkey"
    FOREIGN KEY ("listId") REFERENCES "NativeContactList"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "NativeContactListMember"
    ADD CONSTRAINT "NativeContactListMember_contactId_fkey"
    FOREIGN KEY ("contactId") REFERENCES "NativeContact"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "NativeContactListMember_listId_contactId_key"
  ON "NativeContactListMember"("listId", "contactId");
CREATE INDEX IF NOT EXISTS "NativeContactListMember_contactId_idx"
  ON "NativeContactListMember"("contactId");

-- ─── NativeContactImport ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "NativeContactImport" (
  "id"            TEXT NOT NULL,
  "workspaceId"   TEXT NOT NULL,
  "filename"      TEXT NOT NULL,
  "status"        TEXT NOT NULL DEFAULT 'pending',
  "totalRows"     INTEGER NOT NULL DEFAULT 0,
  "importedCount" INTEGER NOT NULL DEFAULT 0,
  "skippedCount"  INTEGER NOT NULL DEFAULT 0,
  "errorCount"    INTEGER NOT NULL DEFAULT 0,
  "columnMapping" JSONB,
  "listId"        TEXT,
  "createdBy"     TEXT,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt"   TIMESTAMP(3),
  CONSTRAINT "NativeContactImport_pkey" PRIMARY KEY ("id")
);

DO $$ BEGIN
  ALTER TABLE "NativeContactImport"
    ADD CONSTRAINT "NativeContactImport_workspaceId_fkey"
    FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "NativeContactImport"
    ADD CONSTRAINT "NativeContactImport_listId_fkey"
    FOREIGN KEY ("listId") REFERENCES "NativeContactList"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS "NativeContactImport_workspaceId_createdAt_idx"
  ON "NativeContactImport"("workspaceId", "createdAt" DESC);

-- ─── NativeContactImportRow ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "NativeContactImportRow" (
  "id"        TEXT NOT NULL,
  "importId"  TEXT NOT NULL,
  "rowNumber" INTEGER NOT NULL,
  "rawData"   JSONB NOT NULL,
  "error"     TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "NativeContactImportRow_pkey" PRIMARY KEY ("id")
);

DO $$ BEGIN
  ALTER TABLE "NativeContactImportRow"
    ADD CONSTRAINT "NativeContactImportRow_importId_fkey"
    FOREIGN KEY ("importId") REFERENCES "NativeContactImport"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS "NativeContactImportRow_importId_rowNumber_idx"
  ON "NativeContactImportRow"("importId", "rowNumber");

-- ─── NativeSuppression ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "NativeSuppression" (
  "id"          TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "type"        TEXT NOT NULL,
  "value"       TEXT NOT NULL,
  "reason"      TEXT,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "NativeSuppression_pkey" PRIMARY KEY ("id")
);

DO $$ BEGIN
  ALTER TABLE "NativeSuppression"
    ADD CONSTRAINT "NativeSuppression_workspaceId_fkey"
    FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "NativeSuppression_workspaceId_type_value_key"
  ON "NativeSuppression"("workspaceId", "type", "value");
CREATE INDEX IF NOT EXISTS "NativeSuppression_workspaceId_type_idx"
  ON "NativeSuppression"("workspaceId", "type");

-- ─── NativeConversation ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "NativeConversation" (
  "id"            TEXT NOT NULL,
  "workspaceId"   TEXT NOT NULL,
  "contactId"     TEXT NOT NULL,
  "channel"       TEXT NOT NULL,
  "unreadCount"   INTEGER NOT NULL DEFAULT 0,
  "lastMessageAt" TIMESTAMP(3),
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "NativeConversation_pkey" PRIMARY KEY ("id")
);

DO $$ BEGIN
  ALTER TABLE "NativeConversation"
    ADD CONSTRAINT "NativeConversation_workspaceId_fkey"
    FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "NativeConversation"
    ADD CONSTRAINT "NativeConversation_contactId_fkey"
    FOREIGN KEY ("contactId") REFERENCES "NativeContact"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS "NativeConversation_workspaceId_contactId_idx"
  ON "NativeConversation"("workspaceId", "contactId");
CREATE INDEX IF NOT EXISTS "NativeConversation_workspaceId_lastMessageAt_idx"
  ON "NativeConversation"("workspaceId", "lastMessageAt" DESC);
CREATE INDEX IF NOT EXISTS "NativeConversation_contactId_channel_idx"
  ON "NativeConversation"("contactId", "channel");

-- ─── NativeMessage ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "NativeMessage" (
  "id"                TEXT NOT NULL,
  "workspaceId"       TEXT NOT NULL,
  "conversationId"    TEXT NOT NULL,
  "contactId"         TEXT NOT NULL,
  "direction"         TEXT NOT NULL,
  "channel"           TEXT NOT NULL,
  "body"              TEXT NOT NULL,
  "subject"           TEXT,
  "status"            TEXT NOT NULL DEFAULT 'queued',
  "providerMessageId" TEXT,
  "providerError"     TEXT,
  "attachmentKind"    TEXT,
  "attachmentUrl"     TEXT,
  "attachmentName"    TEXT,
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "NativeMessage_pkey" PRIMARY KEY ("id")
);

DO $$ BEGIN
  ALTER TABLE "NativeMessage"
    ADD CONSTRAINT "NativeMessage_workspaceId_fkey"
    FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "NativeMessage"
    ADD CONSTRAINT "NativeMessage_conversationId_fkey"
    FOREIGN KEY ("conversationId") REFERENCES "NativeConversation"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "NativeMessage"
    ADD CONSTRAINT "NativeMessage_contactId_fkey"
    FOREIGN KEY ("contactId") REFERENCES "NativeContact"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS "NativeMessage_conversationId_createdAt_idx"
  ON "NativeMessage"("conversationId", "createdAt" DESC);
CREATE INDEX IF NOT EXISTS "NativeMessage_workspaceId_createdAt_idx"
  ON "NativeMessage"("workspaceId", "createdAt" DESC);
CREATE INDEX IF NOT EXISTS "NativeMessage_contactId_createdAt_idx"
  ON "NativeMessage"("contactId", "createdAt" DESC);

-- ─── NativeCustomField ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "NativeCustomField" (
  "id"          TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "name"        TEXT NOT NULL,
  "fieldKey"    TEXT NOT NULL,
  "dataType"    TEXT NOT NULL,
  "options"     JSONB,
  "placeholder" TEXT,
  "position"    INTEGER NOT NULL DEFAULT 0,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "NativeCustomField_pkey" PRIMARY KEY ("id")
);

DO $$ BEGIN
  ALTER TABLE "NativeCustomField"
    ADD CONSTRAINT "NativeCustomField_workspaceId_fkey"
    FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "NativeCustomField_workspaceId_fieldKey_key"
  ON "NativeCustomField"("workspaceId", "fieldKey");
CREATE INDEX IF NOT EXISTS "NativeCustomField_workspaceId_position_idx"
  ON "NativeCustomField"("workspaceId", "position");
