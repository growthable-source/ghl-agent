-- ═══════════════════════════════════════════════════════════════════════════
-- Symbiosis Wave 2 Migration — adds tables for the second wave:
--   - Prompt versioning, Evaluations, Goals
--   - Audit log, Consent tracking
--   - Live Takeover, Webhooks, Templates, Notifications
-- ═══════════════════════════════════════════════════════════════════════════

-- Extend MessageCorrection
ALTER TABLE "MessageCorrection" ADD COLUMN IF NOT EXISTS "savedAsKnowledge" BOOLEAN NOT NULL DEFAULT false;

-- ─── AgentPromptVersion ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "AgentPromptVersion" (
  "id"            TEXT PRIMARY KEY,
  "agentId"       TEXT NOT NULL,
  "systemPrompt"  TEXT NOT NULL,
  "instructions"  TEXT,
  "changeNote"    TEXT,
  "editedBy"      TEXT NOT NULL,
  "isRollback"    BOOLEAN NOT NULL DEFAULT false,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "AgentPromptVersion_agentId_createdAt_idx" ON "AgentPromptVersion"("agentId", "createdAt" DESC);

-- ─── AgentEvaluation + runs ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "AgentEvaluation" (
  "id"                  TEXT PRIMARY KEY,
  "agentId"             TEXT NOT NULL,
  "name"                TEXT NOT NULL,
  "scenario"            TEXT NOT NULL,
  "expectedContains"    TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "expectedNotContains" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "expectedTool"        TEXT,
  "createdAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "AgentEvaluation_agentId_idx" ON "AgentEvaluation"("agentId");

CREATE TABLE IF NOT EXISTS "AgentEvaluationRun" (
  "id"             TEXT PRIMARY KEY,
  "evaluationId"   TEXT NOT NULL,
  "actualResponse" TEXT,
  "passed"         BOOLEAN NOT NULL,
  "failureReasons" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "toolsCalled"    TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "runBy"          TEXT NOT NULL,
  "runAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AgentEvaluationRun_evaluationId_fkey"
    FOREIGN KEY ("evaluationId") REFERENCES "AgentEvaluation"("id") ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "AgentEvaluationRun_evaluationId_runAt_idx" ON "AgentEvaluationRun"("evaluationId", "runAt" DESC);

-- ─── AgentGoal + events ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "AgentGoal" (
  "id"        TEXT PRIMARY KEY,
  "agentId"   TEXT NOT NULL,
  "name"      TEXT NOT NULL,
  "goalType"  TEXT NOT NULL,
  "value"     TEXT,
  "isActive"  BOOLEAN NOT NULL DEFAULT true,
  "maxTurns"  INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "AgentGoal_agentId_idx" ON "AgentGoal"("agentId");

CREATE TABLE IF NOT EXISTS "AgentGoalEvent" (
  "id"             TEXT PRIMARY KEY,
  "goalId"         TEXT NOT NULL,
  "contactId"      TEXT NOT NULL,
  "conversationId" TEXT,
  "achievedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "turnsToAchieve" INTEGER,
  CONSTRAINT "AgentGoalEvent_goalId_fkey"
    FOREIGN KEY ("goalId") REFERENCES "AgentGoal"("id") ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "AgentGoalEvent_goalId_achievedAt_idx" ON "AgentGoalEvent"("goalId", "achievedAt" DESC);
CREATE INDEX IF NOT EXISTS "AgentGoalEvent_contactId_idx" ON "AgentGoalEvent"("contactId");

-- ─── AuditLog ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "AuditLog" (
  "id"          TEXT PRIMARY KEY,
  "workspaceId" TEXT NOT NULL,
  "actorId"     TEXT NOT NULL,
  "action"      TEXT NOT NULL,
  "targetType"  TEXT,
  "targetId"    TEXT,
  "metadata"    JSONB,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "AuditLog_workspaceId_createdAt_idx" ON "AuditLog"("workspaceId", "createdAt" DESC);
CREATE INDEX IF NOT EXISTS "AuditLog_actorId_createdAt_idx" ON "AuditLog"("actorId", "createdAt" DESC);

-- ─── ContactConsent ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "ContactConsent" (
  "id"          TEXT PRIMARY KEY,
  "workspaceId" TEXT NOT NULL,
  "locationId"  TEXT NOT NULL,
  "contactId"   TEXT NOT NULL,
  "channel"     TEXT NOT NULL,
  "status"      TEXT NOT NULL,
  "source"      TEXT,
  "detail"      TEXT,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ContactConsent_contactId_channel_workspaceId_key" UNIQUE ("contactId","channel","workspaceId")
);
CREATE INDEX IF NOT EXISTS "ContactConsent_workspaceId_status_idx" ON "ContactConsent"("workspaceId","status");

-- ─── LiveTakeover ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "LiveTakeover" (
  "id"             TEXT PRIMARY KEY,
  "agentId"        TEXT NOT NULL,
  "contactId"      TEXT NOT NULL,
  "conversationId" TEXT,
  "locationId"     TEXT NOT NULL,
  "takenOverBy"    TEXT NOT NULL,
  "reason"         TEXT,
  "startedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "endedAt"        TIMESTAMP(3)
);
CREATE INDEX IF NOT EXISTS "LiveTakeover_agentId_endedAt_idx" ON "LiveTakeover"("agentId","endedAt");
CREATE INDEX IF NOT EXISTS "LiveTakeover_contactId_endedAt_idx" ON "LiveTakeover"("contactId","endedAt");

-- ─── WebhookSubscription + deliveries ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS "WebhookSubscription" (
  "id"          TEXT PRIMARY KEY,
  "workspaceId" TEXT NOT NULL,
  "url"         TEXT NOT NULL,
  "events"      TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "secret"      TEXT NOT NULL,
  "isActive"    BOOLEAN NOT NULL DEFAULT true,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "WebhookSubscription_workspaceId_idx" ON "WebhookSubscription"("workspaceId");

CREATE TABLE IF NOT EXISTS "WebhookDelivery" (
  "id"             TEXT PRIMARY KEY,
  "subscriptionId" TEXT NOT NULL,
  "event"          TEXT NOT NULL,
  "payload"        JSONB NOT NULL,
  "statusCode"     INTEGER,
  "responseBody"   TEXT,
  "attempts"       INTEGER NOT NULL DEFAULT 1,
  "succeeded"      BOOLEAN NOT NULL DEFAULT false,
  "deliveredAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WebhookDelivery_subscriptionId_fkey"
    FOREIGN KEY ("subscriptionId") REFERENCES "WebhookSubscription"("id") ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "WebhookDelivery_subscriptionId_deliveredAt_idx" ON "WebhookDelivery"("subscriptionId","deliveredAt" DESC);

-- ─── AgentTemplate ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "AgentTemplate" (
  "id"                        TEXT PRIMARY KEY,
  "slug"                      TEXT UNIQUE NOT NULL,
  "name"                      TEXT NOT NULL,
  "description"               TEXT NOT NULL,
  "category"                  TEXT NOT NULL,
  "icon"                      TEXT NOT NULL DEFAULT '🤖',
  "systemPrompt"              TEXT NOT NULL,
  "suggestedTools"            TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "suggestedChannels"         TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "sampleQualifyingQuestions" JSONB,
  "isOfficial"                BOOLEAN NOT NULL DEFAULT false,
  "installCount"              INTEGER NOT NULL DEFAULT 0,
  "createdAt"                 TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "AgentTemplate_category_idx" ON "AgentTemplate"("category");

-- ─── NotificationChannel ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "NotificationChannel" (
  "id"          TEXT PRIMARY KEY,
  "workspaceId" TEXT NOT NULL,
  "type"        TEXT NOT NULL,
  "config"      JSONB NOT NULL,
  "events"      TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "isActive"    BOOLEAN NOT NULL DEFAULT true,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "NotificationChannel_workspaceId_type_idx" ON "NotificationChannel"("workspaceId","type");

-- ─── Seed official agent templates ──────────────────────────────────────────
INSERT INTO "AgentTemplate" ("id","slug","name","description","category","icon","systemPrompt","suggestedTools","suggestedChannels","isOfficial")
VALUES
  ('tmpl_sales_sdr','sales-sdr','SaaS SDR','Qualifies inbound leads for B2B SaaS — asks about team size, use case, urgency, then books a demo.','sales','🎯',
   'You are an SDR qualifying inbound leads for a B2B SaaS product. Be concise and friendly. Ask 3 qualifying questions: team size, primary use case, and timeline. If qualified (team 10+, active need, timeline under 30 days), book a 30-minute demo using the calendar tool. If not qualified, offer a self-serve trial link and end the conversation politely.',
   ARRAY['get_contact_details','send_reply','update_contact_tags','get_available_slots','book_appointment','add_contact_note'],
   ARRAY['Email','SMS','Live_Chat'],
   true),
  ('tmpl_real_estate_buyer','real-estate-buyer','Real Estate Buyer Agent','Qualifies home buyer leads — budget, timeline, areas, financing status — then books a showing or consultation.','real_estate','🏡',
   'You are a friendly real estate buyer agent. Qualify the lead by asking about: budget range, preferred areas/zip codes, desired bedrooms/bathrooms, timeline to buy, and whether they have pre-approval. Once qualified, offer to schedule a showing or phone consultation.',
   ARRAY['get_contact_details','send_reply','send_sms','update_contact_tags','get_available_slots','book_appointment','add_contact_note'],
   ARRAY['SMS','WhatsApp','Email'],
   true),
  ('tmpl_dental_receptionist','dental-receptionist','Dental Office Receptionist','Handles new patient inquiries, insurance questions, and appointment scheduling.','healthcare','🦷',
   'You are the receptionist for a dental office. Answer questions about services, accepted insurance, and office hours using your knowledge base. For new patients, collect name and insurance, then offer to book a consultation. Never diagnose or give medical advice — always refer clinical questions to the dentist.',
   ARRAY['get_contact_details','send_reply','send_sms','update_contact_tags','get_available_slots','book_appointment'],
   ARRAY['SMS','Email','Live_Chat'],
   true),
  ('tmpl_restaurant_host','restaurant-host','Restaurant Host','Handles reservations, dietary questions, and hours — polite and efficient.','hospitality','🍽️',
   'You are the virtual host for a restaurant. Help with reservations, share menu highlights, and answer questions about hours, dress code, and dietary accommodations. When a guest wants to book, capture party size, date, and time preferences, then book the reservation.',
   ARRAY['get_contact_details','send_reply','get_available_slots','book_appointment'],
   ARRAY['SMS','Live_Chat','Email'],
   true),
  ('tmpl_support_tier1','support-tier1','Tier-1 Support Agent','Answers common product questions from knowledge base and escalates to humans for edge cases.','support','🛟',
   'You are a Tier-1 support agent. Answer questions using your knowledge base. Be empathetic and concise. If you cannot resolve the issue confidently, say "Let me connect you with a specialist" and flag the conversation for human handoff. Never guess at technical details.',
   ARRAY['get_contact_details','send_reply','send_email','update_contact_tags','add_contact_note'],
   ARRAY['Email','Live_Chat','SMS'],
   true),
  ('tmpl_lead_reengagement','lead-reengagement','Lead Re-engagement','Wakes up cold leads with a warm check-in and books a call if there''s new interest.','sales','🔥',
   'You are gently re-engaging a cold lead that has not responded in 30+ days. Open with a warm, non-pushy message referencing their original interest. If they respond with interest, qualify and book a call. If they say no or unsubscribe, politely acknowledge and tag them as cold.',
   ARRAY['get_contact_details','send_reply','send_sms','update_contact_tags','get_available_slots','book_appointment'],
   ARRAY['SMS','Email'],
   true)
ON CONFLICT ("slug") DO NOTHING;
