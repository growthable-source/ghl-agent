-- Portal knowledge, snippet library, negative keywords, and the ticket
-- reply approval workflow. Run by hand in production (Ryan's workflow —
-- nothing auto-runs).
--
-- Context: portal users can now (1) add knowledge sources into a lazily
-- created brand-scoped KnowledgeDomain (same ingest pipeline agents use),
-- (2) maintain a BrandSnippet library (calendar links, contact details)
-- surfaced in the ticket compose UI + suggest-reply prompt, (3) set
-- Brand.negativeKeywords the AI must never use, and (4) approve/reject
-- TicketReplyDraft rows that dashboard agents submit for sign-off before
-- anything is emailed to a customer.
--
-- Until this SQL runs, the app degrades safely: the portal Knowledge and
-- Approvals pages show an empty/uninitialised state, suggest-reply falls
-- back to today's behaviour (no brand context blocks), and Submit-for-
-- approval returns an operator-visible error instead of silently failing.
--
-- All statements are idempotent — safe to re-run.

BEGIN;

-- Brand-scoped knowledge domain (one per brand, portal-managed).
ALTER TABLE "KnowledgeDomain"
  ADD COLUMN IF NOT EXISTS "brandId" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "KnowledgeDomain_brandId_key"
  ON "KnowledgeDomain"("brandId");

DO $$ BEGIN
  ALTER TABLE "KnowledgeDomain"
    ADD CONSTRAINT "KnowledgeDomain_brandId_fkey"
    FOREIGN KEY ("brandId") REFERENCES "Brand"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Words/phrases the AI must never use for this brand.
ALTER TABLE "Brand"
  ADD COLUMN IF NOT EXISTS "negativeKeywords" TEXT[] NOT NULL DEFAULT '{}';

-- Brand snippet library.
CREATE TABLE IF NOT EXISTS "BrandSnippet" (
  "id" TEXT NOT NULL,
  "brandId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "content" TEXT NOT NULL,
  "kind" TEXT NOT NULL DEFAULT 'text',
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdByPortalUserId" TEXT,
  "createdByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "BrandSnippet_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "BrandSnippet_brandId_isActive_idx"
  ON "BrandSnippet"("brandId", "isActive");

DO $$ BEGIN
  ALTER TABLE "BrandSnippet"
    ADD CONSTRAINT "BrandSnippet_brandId_fkey"
    FOREIGN KEY ("brandId") REFERENCES "Brand"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Reply drafts awaiting portal sign-off.
CREATE TABLE IF NOT EXISTS "TicketReplyDraft" (
  "id" TEXT NOT NULL,
  "ticketId" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "submittedByUserId" TEXT,
  "reviewedByPortalUserId" TEXT,
  "reviewedByEmail" TEXT,
  "reviewedAt" TIMESTAMP(3),
  "reviewNote" TEXT,
  "sentMessageId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TicketReplyDraft_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "TicketReplyDraft_ticketId_status_idx"
  ON "TicketReplyDraft"("ticketId", "status");
CREATE INDEX IF NOT EXISTS "TicketReplyDraft_status_createdAt_idx"
  ON "TicketReplyDraft"("status", "createdAt");

DO $$ BEGIN
  ALTER TABLE "TicketReplyDraft"
    ADD CONSTRAINT "TicketReplyDraft_ticketId_fkey"
    FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "TicketReplyDraft"
    ADD CONSTRAINT "TicketReplyDraft_submittedByUserId_fkey"
    FOREIGN KEY ("submittedByUserId") REFERENCES "User"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "TicketReplyDraft"
    ADD CONSTRAINT "TicketReplyDraft_reviewedByPortalUserId_fkey"
    FOREIGN KEY ("reviewedByPortalUserId") REFERENCES "PortalUser"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

COMMIT;
