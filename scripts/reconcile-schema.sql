-- ═══════════════════════════════════════════════════════════════════
-- Idempotent schema reconciliation — generated from `prisma migrate
-- diff --from-empty --to-schema prisma/schema.prisma` and transformed
-- into IF-NOT-EXISTS form for safe re-run against a partially
-- populated DB. Every statement is a no-op if the object already
-- exists in the target shape.
-- ═══════════════════════════════════════════════════════════════════

CREATE SCHEMA IF NOT EXISTS "public";

-- Enum: ConversationState
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ConversationState') THEN
    CREATE TYPE "ConversationState" AS ENUM ('ACTIVE', 'PAUSED', 'COMPLETED');
  END IF;
END $$;

-- Enum: StopConditionType
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'StopConditionType') THEN
    CREATE TYPE "StopConditionType" AS ENUM ('APPOINTMENT_BOOKED', 'KEYWORD', 'MESSAGE_COUNT', 'OPPORTUNITY_STAGE', 'SENTIMENT');
  END IF;
END $$;

-- Enum: FollowUpStatus
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'FollowUpStatus') THEN
    CREATE TYPE "FollowUpStatus" AS ENUM ('SCHEDULED', 'SENT', 'CANCELLED', 'FAILED');
  END IF;
END $$;

-- Enum: ResponseLength
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ResponseLength') THEN
    CREATE TYPE "ResponseLength" AS ENUM ('BRIEF', 'MODERATE', 'DETAILED');
  END IF;
END $$;

-- Enum: FormalityLevel
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'FormalityLevel') THEN
    CREATE TYPE "FormalityLevel" AS ENUM ('CASUAL', 'NEUTRAL', 'FORMAL');
  END IF;
END $$;

-- Enum: RuleType
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'RuleType') THEN
    CREATE TYPE "RuleType" AS ENUM ('ALL', 'TAG', 'PIPELINE_STAGE', 'KEYWORD');
  END IF;
END $$;

-- Enum: LogStatus
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'LogStatus') THEN
    CREATE TYPE "LogStatus" AS ENUM ('PENDING', 'SUCCESS', 'ERROR', 'SKIPPED');
  END IF;
END $$;

-- Table: User
CREATE TABLE IF NOT EXISTS "User" (
  "id" TEXT NOT NULL,
  "name" TEXT,
  "email" TEXT,
  "emailVerified" TIMESTAMP(3),
  "image" TEXT,
  "theme" TEXT NOT NULL DEFAULT 'midnight',
  "companyName" TEXT,
  "companySize" TEXT,
  "role" TEXT,
  "onboardingCompletedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "id" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "name" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "email" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "emailVerified" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "image" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "theme" TEXT NOT NULL DEFAULT 'midnight';
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "companyName" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "companySize" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "role" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "onboardingCompletedAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3);

-- Table: Account
CREATE TABLE IF NOT EXISTS "Account" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "providerAccountId" TEXT NOT NULL,
  "refresh_token" TEXT,
  "access_token" TEXT,
  "expires_at" INTEGER,
  "token_type" TEXT,
  "scope" TEXT,
  "id_token" TEXT,
  "session_state" TEXT,
  CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "Account" ADD COLUMN IF NOT EXISTS "id" TEXT;
ALTER TABLE "Account" ADD COLUMN IF NOT EXISTS "userId" TEXT;
ALTER TABLE "Account" ADD COLUMN IF NOT EXISTS "type" TEXT;
ALTER TABLE "Account" ADD COLUMN IF NOT EXISTS "provider" TEXT;
ALTER TABLE "Account" ADD COLUMN IF NOT EXISTS "providerAccountId" TEXT;
ALTER TABLE "Account" ADD COLUMN IF NOT EXISTS "refresh_token" TEXT;
ALTER TABLE "Account" ADD COLUMN IF NOT EXISTS "access_token" TEXT;
ALTER TABLE "Account" ADD COLUMN IF NOT EXISTS "expires_at" INTEGER;
ALTER TABLE "Account" ADD COLUMN IF NOT EXISTS "token_type" TEXT;
ALTER TABLE "Account" ADD COLUMN IF NOT EXISTS "scope" TEXT;
ALTER TABLE "Account" ADD COLUMN IF NOT EXISTS "id_token" TEXT;
ALTER TABLE "Account" ADD COLUMN IF NOT EXISTS "session_state" TEXT;

-- Table: Session
CREATE TABLE IF NOT EXISTS "Session" (
  "id" TEXT NOT NULL,
  "sessionToken" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "expires" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "Session" ADD COLUMN IF NOT EXISTS "id" TEXT;
ALTER TABLE "Session" ADD COLUMN IF NOT EXISTS "sessionToken" TEXT;
ALTER TABLE "Session" ADD COLUMN IF NOT EXISTS "userId" TEXT;
ALTER TABLE "Session" ADD COLUMN IF NOT EXISTS "expires" TIMESTAMP(3);

-- Table: VerificationToken
CREATE TABLE IF NOT EXISTS "VerificationToken" (
  "identifier" TEXT NOT NULL,
  "token" TEXT NOT NULL,
  "expires" TIMESTAMP(3) NOT NULL
);
ALTER TABLE "VerificationToken" ADD COLUMN IF NOT EXISTS "identifier" TEXT;
ALTER TABLE "VerificationToken" ADD COLUMN IF NOT EXISTS "token" TEXT;
ALTER TABLE "VerificationToken" ADD COLUMN IF NOT EXISTS "expires" TIMESTAMP(3);

-- Table: UserLocation
CREATE TABLE IF NOT EXISTS "UserLocation" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "locationId" TEXT NOT NULL,
  "role" TEXT NOT NULL DEFAULT 'owner',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "UserLocation_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "UserLocation" ADD COLUMN IF NOT EXISTS "id" TEXT;
ALTER TABLE "UserLocation" ADD COLUMN IF NOT EXISTS "userId" TEXT;
ALTER TABLE "UserLocation" ADD COLUMN IF NOT EXISTS "locationId" TEXT;
ALTER TABLE "UserLocation" ADD COLUMN IF NOT EXISTS "role" TEXT NOT NULL DEFAULT 'owner';
ALTER TABLE "UserLocation" ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Table: Workspace
CREATE TABLE IF NOT EXISTS "Workspace" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "icon" TEXT NOT NULL DEFAULT '🚀',
  "logoUrl" TEXT,
  "domain" TEXT,
  "plan" TEXT NOT NULL DEFAULT 'trial',
  "planSelectedDuringTrial" TEXT,
  "billingPeriod" TEXT NOT NULL DEFAULT 'monthly',
  "agentLimit" INTEGER NOT NULL DEFAULT 3,
  "messageLimit" INTEGER NOT NULL DEFAULT 1500,
  "messageUsage" INTEGER NOT NULL DEFAULT 0,
  "voiceMinuteLimit" INTEGER NOT NULL DEFAULT 0,
  "voiceMinuteUsage" INTEGER NOT NULL DEFAULT 0,
  "extraAgentCount" INTEGER NOT NULL DEFAULT 0,
  "trialEndsAt" TIMESTAMP(3),
  "stripeCustomerId" TEXT,
  "stripeSubscriptionId" TEXT,
  "stripePriceId" TEXT,
  "stripeCurrentPeriodEnd" TIMESTAMP(3),
  "isPaused" BOOLEAN NOT NULL DEFAULT false,
  "pausedAt" TIMESTAMP(3),
  "pausedBy" TEXT,
  "disableGlobalLearnings" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Workspace_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "Workspace" ADD COLUMN IF NOT EXISTS "id" TEXT;
ALTER TABLE "Workspace" ADD COLUMN IF NOT EXISTS "name" TEXT;
ALTER TABLE "Workspace" ADD COLUMN IF NOT EXISTS "slug" TEXT;
ALTER TABLE "Workspace" ADD COLUMN IF NOT EXISTS "icon" TEXT NOT NULL DEFAULT '🚀';
ALTER TABLE "Workspace" ADD COLUMN IF NOT EXISTS "logoUrl" TEXT;
ALTER TABLE "Workspace" ADD COLUMN IF NOT EXISTS "domain" TEXT;
ALTER TABLE "Workspace" ADD COLUMN IF NOT EXISTS "plan" TEXT NOT NULL DEFAULT 'trial';
ALTER TABLE "Workspace" ADD COLUMN IF NOT EXISTS "planSelectedDuringTrial" TEXT;
ALTER TABLE "Workspace" ADD COLUMN IF NOT EXISTS "billingPeriod" TEXT NOT NULL DEFAULT 'monthly';
ALTER TABLE "Workspace" ADD COLUMN IF NOT EXISTS "agentLimit" INTEGER NOT NULL DEFAULT 3;
ALTER TABLE "Workspace" ADD COLUMN IF NOT EXISTS "messageLimit" INTEGER NOT NULL DEFAULT 1500;
ALTER TABLE "Workspace" ADD COLUMN IF NOT EXISTS "messageUsage" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Workspace" ADD COLUMN IF NOT EXISTS "voiceMinuteLimit" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Workspace" ADD COLUMN IF NOT EXISTS "voiceMinuteUsage" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Workspace" ADD COLUMN IF NOT EXISTS "extraAgentCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Workspace" ADD COLUMN IF NOT EXISTS "trialEndsAt" TIMESTAMP(3);
ALTER TABLE "Workspace" ADD COLUMN IF NOT EXISTS "stripeCustomerId" TEXT;
ALTER TABLE "Workspace" ADD COLUMN IF NOT EXISTS "stripeSubscriptionId" TEXT;
ALTER TABLE "Workspace" ADD COLUMN IF NOT EXISTS "stripePriceId" TEXT;
ALTER TABLE "Workspace" ADD COLUMN IF NOT EXISTS "stripeCurrentPeriodEnd" TIMESTAMP(3);
ALTER TABLE "Workspace" ADD COLUMN IF NOT EXISTS "isPaused" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Workspace" ADD COLUMN IF NOT EXISTS "pausedAt" TIMESTAMP(3);
ALTER TABLE "Workspace" ADD COLUMN IF NOT EXISTS "pausedBy" TEXT;
ALTER TABLE "Workspace" ADD COLUMN IF NOT EXISTS "disableGlobalLearnings" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Workspace" ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "Workspace" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3);

-- Table: UsageRecord
CREATE TABLE IF NOT EXISTS "UsageRecord" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "quantity" INTEGER NOT NULL,
  "agentId" TEXT,
  "billingPeriod" TEXT NOT NULL,
  "stripeUsageRecordId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "UsageRecord_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "UsageRecord" ADD COLUMN IF NOT EXISTS "id" TEXT;
ALTER TABLE "UsageRecord" ADD COLUMN IF NOT EXISTS "workspaceId" TEXT;
ALTER TABLE "UsageRecord" ADD COLUMN IF NOT EXISTS "type" TEXT;
ALTER TABLE "UsageRecord" ADD COLUMN IF NOT EXISTS "quantity" INTEGER;
ALTER TABLE "UsageRecord" ADD COLUMN IF NOT EXISTS "agentId" TEXT;
ALTER TABLE "UsageRecord" ADD COLUMN IF NOT EXISTS "billingPeriod" TEXT;
ALTER TABLE "UsageRecord" ADD COLUMN IF NOT EXISTS "stripeUsageRecordId" TEXT;
ALTER TABLE "UsageRecord" ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Table: WorkspaceMember
CREATE TABLE IF NOT EXISTS "WorkspaceMember" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "role" TEXT NOT NULL DEFAULT 'owner',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WorkspaceMember_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "WorkspaceMember" ADD COLUMN IF NOT EXISTS "id" TEXT;
ALTER TABLE "WorkspaceMember" ADD COLUMN IF NOT EXISTS "userId" TEXT;
ALTER TABLE "WorkspaceMember" ADD COLUMN IF NOT EXISTS "workspaceId" TEXT;
ALTER TABLE "WorkspaceMember" ADD COLUMN IF NOT EXISTS "role" TEXT NOT NULL DEFAULT 'owner';
ALTER TABLE "WorkspaceMember" ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Table: WorkspaceInvite
CREATE TABLE IF NOT EXISTS "WorkspaceInvite" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "role" TEXT NOT NULL DEFAULT 'member',
  "invitedBy" TEXT NOT NULL,
  "acceptedAt" TIMESTAMP(3),
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WorkspaceInvite_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "WorkspaceInvite" ADD COLUMN IF NOT EXISTS "id" TEXT;
ALTER TABLE "WorkspaceInvite" ADD COLUMN IF NOT EXISTS "workspaceId" TEXT;
ALTER TABLE "WorkspaceInvite" ADD COLUMN IF NOT EXISTS "email" TEXT;
ALTER TABLE "WorkspaceInvite" ADD COLUMN IF NOT EXISTS "role" TEXT NOT NULL DEFAULT 'member';
ALTER TABLE "WorkspaceInvite" ADD COLUMN IF NOT EXISTS "invitedBy" TEXT;
ALTER TABLE "WorkspaceInvite" ADD COLUMN IF NOT EXISTS "acceptedAt" TIMESTAMP(3);
ALTER TABLE "WorkspaceInvite" ADD COLUMN IF NOT EXISTS "expiresAt" TIMESTAMP(3);
ALTER TABLE "WorkspaceInvite" ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Table: Location
CREATE TABLE IF NOT EXISTS "Location" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT,
  "companyId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "userType" TEXT NOT NULL,
  "scope" TEXT NOT NULL,
  "accessToken" TEXT NOT NULL,
  "refreshToken" TEXT NOT NULL,
  "refreshTokenId" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "crmProvider" TEXT NOT NULL DEFAULT 'ghl',
  "installedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "onboardingCompletedAt" TIMESTAMP(3),
  CONSTRAINT "Location_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "Location" ADD COLUMN IF NOT EXISTS "id" TEXT;
ALTER TABLE "Location" ADD COLUMN IF NOT EXISTS "workspaceId" TEXT;
ALTER TABLE "Location" ADD COLUMN IF NOT EXISTS "companyId" TEXT;
ALTER TABLE "Location" ADD COLUMN IF NOT EXISTS "userId" TEXT;
ALTER TABLE "Location" ADD COLUMN IF NOT EXISTS "userType" TEXT;
ALTER TABLE "Location" ADD COLUMN IF NOT EXISTS "scope" TEXT;
ALTER TABLE "Location" ADD COLUMN IF NOT EXISTS "accessToken" TEXT;
ALTER TABLE "Location" ADD COLUMN IF NOT EXISTS "refreshToken" TEXT;
ALTER TABLE "Location" ADD COLUMN IF NOT EXISTS "refreshTokenId" TEXT;
ALTER TABLE "Location" ADD COLUMN IF NOT EXISTS "expiresAt" TIMESTAMP(3);
ALTER TABLE "Location" ADD COLUMN IF NOT EXISTS "crmProvider" TEXT NOT NULL DEFAULT 'ghl';
ALTER TABLE "Location" ADD COLUMN IF NOT EXISTS "installedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "Location" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3);
ALTER TABLE "Location" ADD COLUMN IF NOT EXISTS "onboardingCompletedAt" TIMESTAMP(3);

-- Table: Agent
CREATE TABLE IF NOT EXISTS "Agent" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT,
  "locationId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "systemPrompt" TEXT NOT NULL,
  "instructions" TEXT,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "enabledTools" TEXT[] DEFAULT ARRAY['get_contact_details', 'send_reply', 'send_sms', 'send_email', 'update_contact_tags', 'remove_contact_tags', 'get_opportunities', 'move_opportunity_stage', 'add_contact_note', 'get_available_slots', 'book_appointment', 'cancel_appointment', 'reschedule_appointment', 'create_appointment_note', 'get_calendar_events', 'find_contact_by_email_or_phone', 'upsert_contact', 'create_task', 'add_to_workflow', 'remove_from_workflow', 'cancel_scheduled_message', 'list_contact_conversations', 'mark_opportunity_won', 'mark_opportunity_lost', 'upsert_opportunity', 'list_pipelines']::TEXT[],
  "calendarId" TEXT,
  "addToWorkflowsPick" JSONB,
  "removeFromWorkflowsPick" JSONB,
  "qualifyingStyle" TEXT NOT NULL DEFAULT 'strict',
  "fallbackBehavior" TEXT NOT NULL DEFAULT 'message',
  "fallbackMessage" TEXT,
  "agentPersonaName" TEXT,
  "responseLength" "ResponseLength" NOT NULL DEFAULT 'MODERATE',
  "formalityLevel" "FormalityLevel" NOT NULL DEFAULT 'NEUTRAL',
  "useEmojis" BOOLEAN NOT NULL DEFAULT false,
  "neverSayList" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "simulateTypos" BOOLEAN NOT NULL DEFAULT false,
  "typingDelayEnabled" BOOLEAN NOT NULL DEFAULT false,
  "typingDelayMinMs" INTEGER NOT NULL DEFAULT 500,
  "typingDelayMaxMs" INTEGER NOT NULL DEFAULT 3000,
  "languages" TEXT[] DEFAULT ARRAY['en']::TEXT[],
  "workingHoursEnabled" BOOLEAN NOT NULL DEFAULT false,
  "workingHoursStart" INTEGER NOT NULL DEFAULT 0,
  "workingHoursEnd" INTEGER NOT NULL DEFAULT 24,
  "workingDays" TEXT[] DEFAULT ARRAY['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']::TEXT[],
  "timezone" TEXT,
  "isPaused" BOOLEAN NOT NULL DEFAULT false,
  "pausedAt" TIMESTAMP(3),
  "requireApproval" BOOLEAN NOT NULL DEFAULT false,
  "approvalRules" JSONB,
  "agentType" TEXT NOT NULL DEFAULT 'SIMPLE',
  "businessContext" TEXT,
  CONSTRAINT "Agent_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "Agent" ADD COLUMN IF NOT EXISTS "id" TEXT;
ALTER TABLE "Agent" ADD COLUMN IF NOT EXISTS "workspaceId" TEXT;
ALTER TABLE "Agent" ADD COLUMN IF NOT EXISTS "locationId" TEXT;
ALTER TABLE "Agent" ADD COLUMN IF NOT EXISTS "name" TEXT;
ALTER TABLE "Agent" ADD COLUMN IF NOT EXISTS "systemPrompt" TEXT;
ALTER TABLE "Agent" ADD COLUMN IF NOT EXISTS "instructions" TEXT;
ALTER TABLE "Agent" ADD COLUMN IF NOT EXISTS "isActive" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Agent" ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "Agent" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3);
ALTER TABLE "Agent" ADD COLUMN IF NOT EXISTS "enabledTools" TEXT[] DEFAULT ARRAY['get_contact_details', 'send_reply', 'send_sms', 'send_email', 'update_contact_tags', 'remove_contact_tags', 'get_opportunities', 'move_opportunity_stage', 'add_contact_note', 'get_available_slots', 'book_appointment', 'cancel_appointment', 'reschedule_appointment', 'create_appointment_note', 'get_calendar_events', 'find_contact_by_email_or_phone', 'upsert_contact', 'create_task', 'add_to_workflow', 'remove_from_workflow', 'cancel_scheduled_message', 'list_contact_conversations', 'mark_opportunity_won', 'mark_opportunity_lost', 'upsert_opportunity', 'list_pipelines']::TEXT[];
ALTER TABLE "Agent" ADD COLUMN IF NOT EXISTS "calendarId" TEXT;
ALTER TABLE "Agent" ADD COLUMN IF NOT EXISTS "addToWorkflowsPick" JSONB;
ALTER TABLE "Agent" ADD COLUMN IF NOT EXISTS "removeFromWorkflowsPick" JSONB;
ALTER TABLE "Agent" ADD COLUMN IF NOT EXISTS "qualifyingStyle" TEXT NOT NULL DEFAULT 'strict';
ALTER TABLE "Agent" ADD COLUMN IF NOT EXISTS "fallbackBehavior" TEXT NOT NULL DEFAULT 'message';
ALTER TABLE "Agent" ADD COLUMN IF NOT EXISTS "fallbackMessage" TEXT;
ALTER TABLE "Agent" ADD COLUMN IF NOT EXISTS "agentPersonaName" TEXT;
ALTER TABLE "Agent" ADD COLUMN IF NOT EXISTS "responseLength" "ResponseLength" NOT NULL DEFAULT 'MODERATE';
ALTER TABLE "Agent" ADD COLUMN IF NOT EXISTS "formalityLevel" "FormalityLevel" NOT NULL DEFAULT 'NEUTRAL';
ALTER TABLE "Agent" ADD COLUMN IF NOT EXISTS "useEmojis" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Agent" ADD COLUMN IF NOT EXISTS "neverSayList" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "Agent" ADD COLUMN IF NOT EXISTS "simulateTypos" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Agent" ADD COLUMN IF NOT EXISTS "typingDelayEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Agent" ADD COLUMN IF NOT EXISTS "typingDelayMinMs" INTEGER NOT NULL DEFAULT 500;
ALTER TABLE "Agent" ADD COLUMN IF NOT EXISTS "typingDelayMaxMs" INTEGER NOT NULL DEFAULT 3000;
ALTER TABLE "Agent" ADD COLUMN IF NOT EXISTS "languages" TEXT[] DEFAULT ARRAY['en']::TEXT[];
ALTER TABLE "Agent" ADD COLUMN IF NOT EXISTS "workingHoursEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Agent" ADD COLUMN IF NOT EXISTS "workingHoursStart" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Agent" ADD COLUMN IF NOT EXISTS "workingHoursEnd" INTEGER NOT NULL DEFAULT 24;
ALTER TABLE "Agent" ADD COLUMN IF NOT EXISTS "workingDays" TEXT[] DEFAULT ARRAY['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']::TEXT[];
ALTER TABLE "Agent" ADD COLUMN IF NOT EXISTS "timezone" TEXT;
ALTER TABLE "Agent" ADD COLUMN IF NOT EXISTS "isPaused" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Agent" ADD COLUMN IF NOT EXISTS "pausedAt" TIMESTAMP(3);
ALTER TABLE "Agent" ADD COLUMN IF NOT EXISTS "requireApproval" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Agent" ADD COLUMN IF NOT EXISTS "approvalRules" JSONB;
ALTER TABLE "Agent" ADD COLUMN IF NOT EXISTS "agentType" TEXT NOT NULL DEFAULT 'SIMPLE';
ALTER TABLE "Agent" ADD COLUMN IF NOT EXISTS "businessContext" TEXT;

-- Table: KnowledgeEntry
CREATE TABLE IF NOT EXISTS "KnowledgeEntry" (
  "id" TEXT NOT NULL,
  "agentId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "content" TEXT NOT NULL,
  "source" TEXT NOT NULL DEFAULT 'manual',
  "sourceUrl" TEXT,
  "tokenEstimate" INTEGER NOT NULL DEFAULT 0,
  "status" TEXT NOT NULL DEFAULT 'ready',
  "contentHash" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "KnowledgeEntry_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "KnowledgeEntry" ADD COLUMN IF NOT EXISTS "id" TEXT;
ALTER TABLE "KnowledgeEntry" ADD COLUMN IF NOT EXISTS "agentId" TEXT;
ALTER TABLE "KnowledgeEntry" ADD COLUMN IF NOT EXISTS "title" TEXT;
ALTER TABLE "KnowledgeEntry" ADD COLUMN IF NOT EXISTS "content" TEXT;
ALTER TABLE "KnowledgeEntry" ADD COLUMN IF NOT EXISTS "source" TEXT NOT NULL DEFAULT 'manual';
ALTER TABLE "KnowledgeEntry" ADD COLUMN IF NOT EXISTS "sourceUrl" TEXT;
ALTER TABLE "KnowledgeEntry" ADD COLUMN IF NOT EXISTS "tokenEstimate" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "KnowledgeEntry" ADD COLUMN IF NOT EXISTS "status" TEXT NOT NULL DEFAULT 'ready';
ALTER TABLE "KnowledgeEntry" ADD COLUMN IF NOT EXISTS "contentHash" TEXT;
ALTER TABLE "KnowledgeEntry" ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "KnowledgeEntry" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3);

-- Table: CrawlSchedule
CREATE TABLE IF NOT EXISTS "CrawlSchedule" (
  "id" TEXT NOT NULL,
  "agentId" TEXT NOT NULL,
  "url" TEXT NOT NULL,
  "frequency" TEXT NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "lastRunAt" TIMESTAMP(3),
  "nextRunAt" TIMESTAMP(3) NOT NULL,
  "lastStatus" TEXT,
  "lastError" TEXT,
  "newChunks" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CrawlSchedule_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "CrawlSchedule" ADD COLUMN IF NOT EXISTS "id" TEXT;
ALTER TABLE "CrawlSchedule" ADD COLUMN IF NOT EXISTS "agentId" TEXT;
ALTER TABLE "CrawlSchedule" ADD COLUMN IF NOT EXISTS "url" TEXT;
ALTER TABLE "CrawlSchedule" ADD COLUMN IF NOT EXISTS "frequency" TEXT;
ALTER TABLE "CrawlSchedule" ADD COLUMN IF NOT EXISTS "isActive" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "CrawlSchedule" ADD COLUMN IF NOT EXISTS "lastRunAt" TIMESTAMP(3);
ALTER TABLE "CrawlSchedule" ADD COLUMN IF NOT EXISTS "nextRunAt" TIMESTAMP(3);
ALTER TABLE "CrawlSchedule" ADD COLUMN IF NOT EXISTS "lastStatus" TEXT;
ALTER TABLE "CrawlSchedule" ADD COLUMN IF NOT EXISTS "lastError" TEXT;
ALTER TABLE "CrawlSchedule" ADD COLUMN IF NOT EXISTS "newChunks" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "CrawlSchedule" ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "CrawlSchedule" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3);

-- Table: RoutingRule
CREATE TABLE IF NOT EXISTS "RoutingRule" (
  "id" TEXT NOT NULL,
  "agentId" TEXT NOT NULL,
  "priority" INTEGER NOT NULL DEFAULT 10,
  "ruleType" "RuleType" NOT NULL,
  "value" TEXT,
  "conditions" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RoutingRule_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "RoutingRule" ADD COLUMN IF NOT EXISTS "id" TEXT;
ALTER TABLE "RoutingRule" ADD COLUMN IF NOT EXISTS "agentId" TEXT;
ALTER TABLE "RoutingRule" ADD COLUMN IF NOT EXISTS "priority" INTEGER NOT NULL DEFAULT 10;
ALTER TABLE "RoutingRule" ADD COLUMN IF NOT EXISTS "ruleType" "RuleType";
ALTER TABLE "RoutingRule" ADD COLUMN IF NOT EXISTS "value" TEXT;
ALTER TABLE "RoutingRule" ADD COLUMN IF NOT EXISTS "conditions" JSONB;
ALTER TABLE "RoutingRule" ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Table: AgentRule
CREATE TABLE IF NOT EXISTS "AgentRule" (
  "id" TEXT NOT NULL,
  "agentId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "conditionDescription" TEXT NOT NULL,
  "examples" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "actionType" TEXT NOT NULL DEFAULT 'update_contact_field',
  "actionParams" JSONB,
  "targetFieldKey" TEXT NOT NULL,
  "targetValue" TEXT NOT NULL,
  "overwrite" BOOLEAN NOT NULL DEFAULT false,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "order" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AgentRule_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "AgentRule" ADD COLUMN IF NOT EXISTS "id" TEXT;
ALTER TABLE "AgentRule" ADD COLUMN IF NOT EXISTS "agentId" TEXT;
ALTER TABLE "AgentRule" ADD COLUMN IF NOT EXISTS "name" TEXT;
ALTER TABLE "AgentRule" ADD COLUMN IF NOT EXISTS "conditionDescription" TEXT;
ALTER TABLE "AgentRule" ADD COLUMN IF NOT EXISTS "examples" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "AgentRule" ADD COLUMN IF NOT EXISTS "actionType" TEXT NOT NULL DEFAULT 'update_contact_field';
ALTER TABLE "AgentRule" ADD COLUMN IF NOT EXISTS "actionParams" JSONB;
ALTER TABLE "AgentRule" ADD COLUMN IF NOT EXISTS "targetFieldKey" TEXT;
ALTER TABLE "AgentRule" ADD COLUMN IF NOT EXISTS "targetValue" TEXT;
ALTER TABLE "AgentRule" ADD COLUMN IF NOT EXISTS "overwrite" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "AgentRule" ADD COLUMN IF NOT EXISTS "isActive" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "AgentRule" ADD COLUMN IF NOT EXISTS "order" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "AgentRule" ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "AgentRule" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3);

-- Table: MessageLog
CREATE TABLE IF NOT EXISTS "MessageLog" (
  "id" TEXT NOT NULL,
  "locationId" TEXT NOT NULL,
  "agentId" TEXT,
  "contactId" TEXT NOT NULL,
  "conversationId" TEXT NOT NULL,
  "inboundMessage" TEXT NOT NULL,
  "outboundReply" TEXT,
  "actionsPerformed" TEXT[],
  "tokensUsed" INTEGER NOT NULL DEFAULT 0,
  "toolCallTrace" JSONB,
  "status" "LogStatus" NOT NULL DEFAULT 'PENDING',
  "errorMessage" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "needsApproval" BOOLEAN NOT NULL DEFAULT false,
  "approvalStatus" TEXT,
  "approvedBy" TEXT,
  "approvedAt" TIMESTAMP(3),
  "approvalReason" TEXT,
  "approvalChannel" TEXT,
  "approvalConversationProviderId" TEXT,
  CONSTRAINT "MessageLog_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "MessageLog" ADD COLUMN IF NOT EXISTS "id" TEXT;
ALTER TABLE "MessageLog" ADD COLUMN IF NOT EXISTS "locationId" TEXT;
ALTER TABLE "MessageLog" ADD COLUMN IF NOT EXISTS "agentId" TEXT;
ALTER TABLE "MessageLog" ADD COLUMN IF NOT EXISTS "contactId" TEXT;
ALTER TABLE "MessageLog" ADD COLUMN IF NOT EXISTS "conversationId" TEXT;
ALTER TABLE "MessageLog" ADD COLUMN IF NOT EXISTS "inboundMessage" TEXT;
ALTER TABLE "MessageLog" ADD COLUMN IF NOT EXISTS "outboundReply" TEXT;
ALTER TABLE "MessageLog" ADD COLUMN IF NOT EXISTS "actionsPerformed" TEXT[];
ALTER TABLE "MessageLog" ADD COLUMN IF NOT EXISTS "tokensUsed" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "MessageLog" ADD COLUMN IF NOT EXISTS "toolCallTrace" JSONB;
ALTER TABLE "MessageLog" ADD COLUMN IF NOT EXISTS "status" "LogStatus" NOT NULL DEFAULT 'PENDING';
ALTER TABLE "MessageLog" ADD COLUMN IF NOT EXISTS "errorMessage" TEXT;
ALTER TABLE "MessageLog" ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "MessageLog" ADD COLUMN IF NOT EXISTS "needsApproval" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "MessageLog" ADD COLUMN IF NOT EXISTS "approvalStatus" TEXT;
ALTER TABLE "MessageLog" ADD COLUMN IF NOT EXISTS "approvedBy" TEXT;
ALTER TABLE "MessageLog" ADD COLUMN IF NOT EXISTS "approvedAt" TIMESTAMP(3);
ALTER TABLE "MessageLog" ADD COLUMN IF NOT EXISTS "approvalReason" TEXT;
ALTER TABLE "MessageLog" ADD COLUMN IF NOT EXISTS "approvalChannel" TEXT;
ALTER TABLE "MessageLog" ADD COLUMN IF NOT EXISTS "approvalConversationProviderId" TEXT;

-- Table: MessageCorrection
CREATE TABLE IF NOT EXISTS "MessageCorrection" (
  "id" TEXT NOT NULL,
  "messageLogId" TEXT NOT NULL,
  "originalText" TEXT NOT NULL,
  "correctedText" TEXT NOT NULL,
  "correctedBy" TEXT NOT NULL,
  "reason" TEXT,
  "savedAsKnowledge" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MessageCorrection_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "MessageCorrection" ADD COLUMN IF NOT EXISTS "id" TEXT;
ALTER TABLE "MessageCorrection" ADD COLUMN IF NOT EXISTS "messageLogId" TEXT;
ALTER TABLE "MessageCorrection" ADD COLUMN IF NOT EXISTS "originalText" TEXT;
ALTER TABLE "MessageCorrection" ADD COLUMN IF NOT EXISTS "correctedText" TEXT;
ALTER TABLE "MessageCorrection" ADD COLUMN IF NOT EXISTS "correctedBy" TEXT;
ALTER TABLE "MessageCorrection" ADD COLUMN IF NOT EXISTS "reason" TEXT;
ALTER TABLE "MessageCorrection" ADD COLUMN IF NOT EXISTS "savedAsKnowledge" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "MessageCorrection" ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Table: AgentPromptVersion
CREATE TABLE IF NOT EXISTS "AgentPromptVersion" (
  "id" TEXT NOT NULL,
  "agentId" TEXT NOT NULL,
  "systemPrompt" TEXT NOT NULL,
  "instructions" TEXT,
  "changeNote" TEXT,
  "editedBy" TEXT NOT NULL,
  "isRollback" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AgentPromptVersion_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "AgentPromptVersion" ADD COLUMN IF NOT EXISTS "id" TEXT;
ALTER TABLE "AgentPromptVersion" ADD COLUMN IF NOT EXISTS "agentId" TEXT;
ALTER TABLE "AgentPromptVersion" ADD COLUMN IF NOT EXISTS "systemPrompt" TEXT;
ALTER TABLE "AgentPromptVersion" ADD COLUMN IF NOT EXISTS "instructions" TEXT;
ALTER TABLE "AgentPromptVersion" ADD COLUMN IF NOT EXISTS "changeNote" TEXT;
ALTER TABLE "AgentPromptVersion" ADD COLUMN IF NOT EXISTS "editedBy" TEXT;
ALTER TABLE "AgentPromptVersion" ADD COLUMN IF NOT EXISTS "isRollback" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "AgentPromptVersion" ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Table: AgentEvaluation
CREATE TABLE IF NOT EXISTS "AgentEvaluation" (
  "id" TEXT NOT NULL,
  "agentId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "scenario" TEXT NOT NULL,
  "expectedContains" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "expectedNotContains" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "expectedTool" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AgentEvaluation_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "AgentEvaluation" ADD COLUMN IF NOT EXISTS "id" TEXT;
ALTER TABLE "AgentEvaluation" ADD COLUMN IF NOT EXISTS "agentId" TEXT;
ALTER TABLE "AgentEvaluation" ADD COLUMN IF NOT EXISTS "name" TEXT;
ALTER TABLE "AgentEvaluation" ADD COLUMN IF NOT EXISTS "scenario" TEXT;
ALTER TABLE "AgentEvaluation" ADD COLUMN IF NOT EXISTS "expectedContains" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "AgentEvaluation" ADD COLUMN IF NOT EXISTS "expectedNotContains" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "AgentEvaluation" ADD COLUMN IF NOT EXISTS "expectedTool" TEXT;
ALTER TABLE "AgentEvaluation" ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Table: AgentEvaluationRun
CREATE TABLE IF NOT EXISTS "AgentEvaluationRun" (
  "id" TEXT NOT NULL,
  "evaluationId" TEXT NOT NULL,
  "actualResponse" TEXT,
  "passed" BOOLEAN NOT NULL,
  "failureReasons" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "toolsCalled" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "runBy" TEXT NOT NULL,
  "runAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AgentEvaluationRun_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "AgentEvaluationRun" ADD COLUMN IF NOT EXISTS "id" TEXT;
ALTER TABLE "AgentEvaluationRun" ADD COLUMN IF NOT EXISTS "evaluationId" TEXT;
ALTER TABLE "AgentEvaluationRun" ADD COLUMN IF NOT EXISTS "actualResponse" TEXT;
ALTER TABLE "AgentEvaluationRun" ADD COLUMN IF NOT EXISTS "passed" BOOLEAN;
ALTER TABLE "AgentEvaluationRun" ADD COLUMN IF NOT EXISTS "failureReasons" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "AgentEvaluationRun" ADD COLUMN IF NOT EXISTS "toolsCalled" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "AgentEvaluationRun" ADD COLUMN IF NOT EXISTS "runBy" TEXT;
ALTER TABLE "AgentEvaluationRun" ADD COLUMN IF NOT EXISTS "runAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Table: AgentGoal
CREATE TABLE IF NOT EXISTS "AgentGoal" (
  "id" TEXT NOT NULL,
  "agentId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "goalType" TEXT NOT NULL,
  "value" TEXT,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "maxTurns" INTEGER,
  "isPrimary" BOOLEAN NOT NULL DEFAULT false,
  "priority" INTEGER NOT NULL DEFAULT 10,
  "aggressiveness" TEXT NOT NULL DEFAULT 'moderate',
  "triggerPhrases" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "preferredTool" TEXT,
  "instruction" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AgentGoal_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "AgentGoal" ADD COLUMN IF NOT EXISTS "id" TEXT;
ALTER TABLE "AgentGoal" ADD COLUMN IF NOT EXISTS "agentId" TEXT;
ALTER TABLE "AgentGoal" ADD COLUMN IF NOT EXISTS "name" TEXT;
ALTER TABLE "AgentGoal" ADD COLUMN IF NOT EXISTS "goalType" TEXT;
ALTER TABLE "AgentGoal" ADD COLUMN IF NOT EXISTS "value" TEXT;
ALTER TABLE "AgentGoal" ADD COLUMN IF NOT EXISTS "isActive" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "AgentGoal" ADD COLUMN IF NOT EXISTS "maxTurns" INTEGER;
ALTER TABLE "AgentGoal" ADD COLUMN IF NOT EXISTS "isPrimary" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "AgentGoal" ADD COLUMN IF NOT EXISTS "priority" INTEGER NOT NULL DEFAULT 10;
ALTER TABLE "AgentGoal" ADD COLUMN IF NOT EXISTS "aggressiveness" TEXT NOT NULL DEFAULT 'moderate';
ALTER TABLE "AgentGoal" ADD COLUMN IF NOT EXISTS "triggerPhrases" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "AgentGoal" ADD COLUMN IF NOT EXISTS "preferredTool" TEXT;
ALTER TABLE "AgentGoal" ADD COLUMN IF NOT EXISTS "instruction" TEXT;
ALTER TABLE "AgentGoal" ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Table: AgentGoalEvent
CREATE TABLE IF NOT EXISTS "AgentGoalEvent" (
  "id" TEXT NOT NULL,
  "goalId" TEXT NOT NULL,
  "contactId" TEXT NOT NULL,
  "conversationId" TEXT,
  "achievedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "turnsToAchieve" INTEGER,
  CONSTRAINT "AgentGoalEvent_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "AgentGoalEvent" ADD COLUMN IF NOT EXISTS "id" TEXT;
ALTER TABLE "AgentGoalEvent" ADD COLUMN IF NOT EXISTS "goalId" TEXT;
ALTER TABLE "AgentGoalEvent" ADD COLUMN IF NOT EXISTS "contactId" TEXT;
ALTER TABLE "AgentGoalEvent" ADD COLUMN IF NOT EXISTS "conversationId" TEXT;
ALTER TABLE "AgentGoalEvent" ADD COLUMN IF NOT EXISTS "achievedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "AgentGoalEvent" ADD COLUMN IF NOT EXISTS "turnsToAchieve" INTEGER;

-- Table: AuditLog
CREATE TABLE IF NOT EXISTS "AuditLog" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "actorId" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "targetType" TEXT,
  "targetId" TEXT,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "AuditLog" ADD COLUMN IF NOT EXISTS "id" TEXT;
ALTER TABLE "AuditLog" ADD COLUMN IF NOT EXISTS "workspaceId" TEXT;
ALTER TABLE "AuditLog" ADD COLUMN IF NOT EXISTS "actorId" TEXT;
ALTER TABLE "AuditLog" ADD COLUMN IF NOT EXISTS "action" TEXT;
ALTER TABLE "AuditLog" ADD COLUMN IF NOT EXISTS "targetType" TEXT;
ALTER TABLE "AuditLog" ADD COLUMN IF NOT EXISTS "targetId" TEXT;
ALTER TABLE "AuditLog" ADD COLUMN IF NOT EXISTS "metadata" JSONB;
ALTER TABLE "AuditLog" ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Table: ContactConsent
CREATE TABLE IF NOT EXISTS "ContactConsent" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "locationId" TEXT NOT NULL,
  "contactId" TEXT NOT NULL,
  "channel" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "source" TEXT,
  "detail" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ContactConsent_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "ContactConsent" ADD COLUMN IF NOT EXISTS "id" TEXT;
ALTER TABLE "ContactConsent" ADD COLUMN IF NOT EXISTS "workspaceId" TEXT;
ALTER TABLE "ContactConsent" ADD COLUMN IF NOT EXISTS "locationId" TEXT;
ALTER TABLE "ContactConsent" ADD COLUMN IF NOT EXISTS "contactId" TEXT;
ALTER TABLE "ContactConsent" ADD COLUMN IF NOT EXISTS "channel" TEXT;
ALTER TABLE "ContactConsent" ADD COLUMN IF NOT EXISTS "status" TEXT;
ALTER TABLE "ContactConsent" ADD COLUMN IF NOT EXISTS "source" TEXT;
ALTER TABLE "ContactConsent" ADD COLUMN IF NOT EXISTS "detail" TEXT;
ALTER TABLE "ContactConsent" ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "ContactConsent" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3);

-- Table: LiveTakeover
CREATE TABLE IF NOT EXISTS "LiveTakeover" (
  "id" TEXT NOT NULL,
  "agentId" TEXT NOT NULL,
  "contactId" TEXT NOT NULL,
  "conversationId" TEXT,
  "locationId" TEXT NOT NULL,
  "takenOverBy" TEXT NOT NULL,
  "reason" TEXT,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "endedAt" TIMESTAMP(3),
  CONSTRAINT "LiveTakeover_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "LiveTakeover" ADD COLUMN IF NOT EXISTS "id" TEXT;
ALTER TABLE "LiveTakeover" ADD COLUMN IF NOT EXISTS "agentId" TEXT;
ALTER TABLE "LiveTakeover" ADD COLUMN IF NOT EXISTS "contactId" TEXT;
ALTER TABLE "LiveTakeover" ADD COLUMN IF NOT EXISTS "conversationId" TEXT;
ALTER TABLE "LiveTakeover" ADD COLUMN IF NOT EXISTS "locationId" TEXT;
ALTER TABLE "LiveTakeover" ADD COLUMN IF NOT EXISTS "takenOverBy" TEXT;
ALTER TABLE "LiveTakeover" ADD COLUMN IF NOT EXISTS "reason" TEXT;
ALTER TABLE "LiveTakeover" ADD COLUMN IF NOT EXISTS "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "LiveTakeover" ADD COLUMN IF NOT EXISTS "endedAt" TIMESTAMP(3);

-- Table: WebhookSubscription
CREATE TABLE IF NOT EXISTS "WebhookSubscription" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "url" TEXT NOT NULL,
  "events" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "secret" TEXT NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "WebhookSubscription_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "WebhookSubscription" ADD COLUMN IF NOT EXISTS "id" TEXT;
ALTER TABLE "WebhookSubscription" ADD COLUMN IF NOT EXISTS "workspaceId" TEXT;
ALTER TABLE "WebhookSubscription" ADD COLUMN IF NOT EXISTS "url" TEXT;
ALTER TABLE "WebhookSubscription" ADD COLUMN IF NOT EXISTS "events" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "WebhookSubscription" ADD COLUMN IF NOT EXISTS "secret" TEXT;
ALTER TABLE "WebhookSubscription" ADD COLUMN IF NOT EXISTS "isActive" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "WebhookSubscription" ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "WebhookSubscription" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3);

-- Table: WebhookDelivery
CREATE TABLE IF NOT EXISTS "WebhookDelivery" (
  "id" TEXT NOT NULL,
  "subscriptionId" TEXT NOT NULL,
  "event" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "statusCode" INTEGER,
  "responseBody" TEXT,
  "attempts" INTEGER NOT NULL DEFAULT 1,
  "succeeded" BOOLEAN NOT NULL DEFAULT false,
  "deliveredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WebhookDelivery_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "WebhookDelivery" ADD COLUMN IF NOT EXISTS "id" TEXT;
ALTER TABLE "WebhookDelivery" ADD COLUMN IF NOT EXISTS "subscriptionId" TEXT;
ALTER TABLE "WebhookDelivery" ADD COLUMN IF NOT EXISTS "event" TEXT;
ALTER TABLE "WebhookDelivery" ADD COLUMN IF NOT EXISTS "payload" JSONB;
ALTER TABLE "WebhookDelivery" ADD COLUMN IF NOT EXISTS "statusCode" INTEGER;
ALTER TABLE "WebhookDelivery" ADD COLUMN IF NOT EXISTS "responseBody" TEXT;
ALTER TABLE "WebhookDelivery" ADD COLUMN IF NOT EXISTS "attempts" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "WebhookDelivery" ADD COLUMN IF NOT EXISTS "succeeded" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "WebhookDelivery" ADD COLUMN IF NOT EXISTS "deliveredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Table: AgentTemplate
CREATE TABLE IF NOT EXISTS "AgentTemplate" (
  "id" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  "icon" TEXT NOT NULL DEFAULT '🤖',
  "systemPrompt" TEXT NOT NULL,
  "suggestedTools" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "suggestedChannels" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "sampleQualifyingQuestions" JSONB,
  "isOfficial" BOOLEAN NOT NULL DEFAULT false,
  "installCount" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "workspaceId" TEXT,
  "config" JSONB,
  "sourceAgentId" TEXT,
  CONSTRAINT "AgentTemplate_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "AgentTemplate" ADD COLUMN IF NOT EXISTS "id" TEXT;
ALTER TABLE "AgentTemplate" ADD COLUMN IF NOT EXISTS "slug" TEXT;
ALTER TABLE "AgentTemplate" ADD COLUMN IF NOT EXISTS "name" TEXT;
ALTER TABLE "AgentTemplate" ADD COLUMN IF NOT EXISTS "description" TEXT;
ALTER TABLE "AgentTemplate" ADD COLUMN IF NOT EXISTS "category" TEXT;
ALTER TABLE "AgentTemplate" ADD COLUMN IF NOT EXISTS "icon" TEXT NOT NULL DEFAULT '🤖';
ALTER TABLE "AgentTemplate" ADD COLUMN IF NOT EXISTS "systemPrompt" TEXT;
ALTER TABLE "AgentTemplate" ADD COLUMN IF NOT EXISTS "suggestedTools" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "AgentTemplate" ADD COLUMN IF NOT EXISTS "suggestedChannels" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "AgentTemplate" ADD COLUMN IF NOT EXISTS "sampleQualifyingQuestions" JSONB;
ALTER TABLE "AgentTemplate" ADD COLUMN IF NOT EXISTS "isOfficial" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "AgentTemplate" ADD COLUMN IF NOT EXISTS "installCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "AgentTemplate" ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "AgentTemplate" ADD COLUMN IF NOT EXISTS "workspaceId" TEXT;
ALTER TABLE "AgentTemplate" ADD COLUMN IF NOT EXISTS "config" JSONB;
ALTER TABLE "AgentTemplate" ADD COLUMN IF NOT EXISTS "sourceAgentId" TEXT;

-- Table: NotificationChannel
CREATE TABLE IF NOT EXISTS "NotificationChannel" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "config" JSONB NOT NULL,
  "events" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "NotificationChannel_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "NotificationChannel" ADD COLUMN IF NOT EXISTS "id" TEXT;
ALTER TABLE "NotificationChannel" ADD COLUMN IF NOT EXISTS "workspaceId" TEXT;
ALTER TABLE "NotificationChannel" ADD COLUMN IF NOT EXISTS "type" TEXT;
ALTER TABLE "NotificationChannel" ADD COLUMN IF NOT EXISTS "config" JSONB;
ALTER TABLE "NotificationChannel" ADD COLUMN IF NOT EXISTS "events" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "NotificationChannel" ADD COLUMN IF NOT EXISTS "isActive" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "NotificationChannel" ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Table: StopCondition
CREATE TABLE IF NOT EXISTS "StopCondition" (
  "id" TEXT NOT NULL,
  "agentId" TEXT NOT NULL,
  "conditionType" "StopConditionType" NOT NULL,
  "value" TEXT,
  "pauseAgent" BOOLEAN NOT NULL DEFAULT true,
  "tagNeedsAttention" BOOLEAN NOT NULL DEFAULT true,
  "enrollWorkflowId" TEXT,
  "removeWorkflowId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "StopCondition_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "StopCondition" ADD COLUMN IF NOT EXISTS "id" TEXT;
ALTER TABLE "StopCondition" ADD COLUMN IF NOT EXISTS "agentId" TEXT;
ALTER TABLE "StopCondition" ADD COLUMN IF NOT EXISTS "conditionType" "StopConditionType";
ALTER TABLE "StopCondition" ADD COLUMN IF NOT EXISTS "value" TEXT;
ALTER TABLE "StopCondition" ADD COLUMN IF NOT EXISTS "pauseAgent" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "StopCondition" ADD COLUMN IF NOT EXISTS "tagNeedsAttention" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "StopCondition" ADD COLUMN IF NOT EXISTS "enrollWorkflowId" TEXT;
ALTER TABLE "StopCondition" ADD COLUMN IF NOT EXISTS "removeWorkflowId" TEXT;
ALTER TABLE "StopCondition" ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Table: FollowUpSequence
CREATE TABLE IF NOT EXISTS "FollowUpSequence" (
  "id" TEXT NOT NULL,
  "agentId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "triggerType" TEXT NOT NULL DEFAULT 'always',
  "triggerValue" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FollowUpSequence_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "FollowUpSequence" ADD COLUMN IF NOT EXISTS "id" TEXT;
ALTER TABLE "FollowUpSequence" ADD COLUMN IF NOT EXISTS "agentId" TEXT;
ALTER TABLE "FollowUpSequence" ADD COLUMN IF NOT EXISTS "name" TEXT;
ALTER TABLE "FollowUpSequence" ADD COLUMN IF NOT EXISTS "isActive" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "FollowUpSequence" ADD COLUMN IF NOT EXISTS "triggerType" TEXT NOT NULL DEFAULT 'always';
ALTER TABLE "FollowUpSequence" ADD COLUMN IF NOT EXISTS "triggerValue" TEXT;
ALTER TABLE "FollowUpSequence" ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Table: FollowUpStep
CREATE TABLE IF NOT EXISTS "FollowUpStep" (
  "id" TEXT NOT NULL,
  "sequenceId" TEXT NOT NULL,
  "stepNumber" INTEGER NOT NULL,
  "delayHours" INTEGER NOT NULL,
  "message" TEXT NOT NULL,
  CONSTRAINT "FollowUpStep_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "FollowUpStep" ADD COLUMN IF NOT EXISTS "id" TEXT;
ALTER TABLE "FollowUpStep" ADD COLUMN IF NOT EXISTS "sequenceId" TEXT;
ALTER TABLE "FollowUpStep" ADD COLUMN IF NOT EXISTS "stepNumber" INTEGER;
ALTER TABLE "FollowUpStep" ADD COLUMN IF NOT EXISTS "delayHours" INTEGER;
ALTER TABLE "FollowUpStep" ADD COLUMN IF NOT EXISTS "message" TEXT;

-- Table: FollowUpJob
CREATE TABLE IF NOT EXISTS "FollowUpJob" (
  "id" TEXT NOT NULL,
  "sequenceId" TEXT NOT NULL,
  "locationId" TEXT NOT NULL,
  "contactId" TEXT NOT NULL,
  "conversationId" TEXT,
  "channel" TEXT NOT NULL DEFAULT 'SMS',
  "currentStep" INTEGER NOT NULL DEFAULT 1,
  "status" "FollowUpStatus" NOT NULL DEFAULT 'SCHEDULED',
  "scheduledAt" TIMESTAMP(3) NOT NULL,
  "lastSentAt" TIMESTAMP(3),
  "cancelledAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FollowUpJob_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "FollowUpJob" ADD COLUMN IF NOT EXISTS "id" TEXT;
ALTER TABLE "FollowUpJob" ADD COLUMN IF NOT EXISTS "sequenceId" TEXT;
ALTER TABLE "FollowUpJob" ADD COLUMN IF NOT EXISTS "locationId" TEXT;
ALTER TABLE "FollowUpJob" ADD COLUMN IF NOT EXISTS "contactId" TEXT;
ALTER TABLE "FollowUpJob" ADD COLUMN IF NOT EXISTS "conversationId" TEXT;
ALTER TABLE "FollowUpJob" ADD COLUMN IF NOT EXISTS "channel" TEXT NOT NULL DEFAULT 'SMS';
ALTER TABLE "FollowUpJob" ADD COLUMN IF NOT EXISTS "currentStep" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "FollowUpJob" ADD COLUMN IF NOT EXISTS "status" "FollowUpStatus" NOT NULL DEFAULT 'SCHEDULED';
ALTER TABLE "FollowUpJob" ADD COLUMN IF NOT EXISTS "scheduledAt" TIMESTAMP(3);
ALTER TABLE "FollowUpJob" ADD COLUMN IF NOT EXISTS "lastSentAt" TIMESTAMP(3);
ALTER TABLE "FollowUpJob" ADD COLUMN IF NOT EXISTS "cancelledAt" TIMESTAMP(3);
ALTER TABLE "FollowUpJob" ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Table: QualifyingQuestion
CREATE TABLE IF NOT EXISTS "QualifyingQuestion" (
  "id" TEXT NOT NULL,
  "agentId" TEXT NOT NULL,
  "question" TEXT NOT NULL,
  "fieldKey" TEXT NOT NULL,
  "required" BOOLEAN NOT NULL DEFAULT true,
  "order" INTEGER NOT NULL DEFAULT 0,
  "answerType" TEXT NOT NULL DEFAULT 'text',
  "choices" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "conditionOp" TEXT,
  "conditionVal" TEXT,
  "conditionValues" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "actionType" TEXT,
  "actionValue" TEXT,
  "actionParams" JSONB,
  "crmFieldKey" TEXT,
  "overwrite" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "QualifyingQuestion_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "QualifyingQuestion" ADD COLUMN IF NOT EXISTS "id" TEXT;
ALTER TABLE "QualifyingQuestion" ADD COLUMN IF NOT EXISTS "agentId" TEXT;
ALTER TABLE "QualifyingQuestion" ADD COLUMN IF NOT EXISTS "question" TEXT;
ALTER TABLE "QualifyingQuestion" ADD COLUMN IF NOT EXISTS "fieldKey" TEXT;
ALTER TABLE "QualifyingQuestion" ADD COLUMN IF NOT EXISTS "required" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "QualifyingQuestion" ADD COLUMN IF NOT EXISTS "order" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "QualifyingQuestion" ADD COLUMN IF NOT EXISTS "answerType" TEXT NOT NULL DEFAULT 'text';
ALTER TABLE "QualifyingQuestion" ADD COLUMN IF NOT EXISTS "choices" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "QualifyingQuestion" ADD COLUMN IF NOT EXISTS "conditionOp" TEXT;
ALTER TABLE "QualifyingQuestion" ADD COLUMN IF NOT EXISTS "conditionVal" TEXT;
ALTER TABLE "QualifyingQuestion" ADD COLUMN IF NOT EXISTS "conditionValues" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "QualifyingQuestion" ADD COLUMN IF NOT EXISTS "actionType" TEXT;
ALTER TABLE "QualifyingQuestion" ADD COLUMN IF NOT EXISTS "actionValue" TEXT;
ALTER TABLE "QualifyingQuestion" ADD COLUMN IF NOT EXISTS "actionParams" JSONB;
ALTER TABLE "QualifyingQuestion" ADD COLUMN IF NOT EXISTS "crmFieldKey" TEXT;
ALTER TABLE "QualifyingQuestion" ADD COLUMN IF NOT EXISTS "overwrite" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "QualifyingQuestion" ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Table: ConversationStateRecord
CREATE TABLE IF NOT EXISTS "ConversationStateRecord" (
  "id" TEXT NOT NULL,
  "agentId" TEXT NOT NULL,
  "locationId" TEXT NOT NULL,
  "contactId" TEXT NOT NULL,
  "conversationId" TEXT,
  "state" "ConversationState" NOT NULL DEFAULT 'ACTIVE',
  "messageCount" INTEGER NOT NULL DEFAULT 0,
  "pauseReason" TEXT,
  "pausedAt" TIMESTAMP(3),
  "resumedAt" TIMESTAMP(3),
  "qualifyingAnswers" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ConversationStateRecord_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "ConversationStateRecord" ADD COLUMN IF NOT EXISTS "id" TEXT;
ALTER TABLE "ConversationStateRecord" ADD COLUMN IF NOT EXISTS "agentId" TEXT;
ALTER TABLE "ConversationStateRecord" ADD COLUMN IF NOT EXISTS "locationId" TEXT;
ALTER TABLE "ConversationStateRecord" ADD COLUMN IF NOT EXISTS "contactId" TEXT;
ALTER TABLE "ConversationStateRecord" ADD COLUMN IF NOT EXISTS "conversationId" TEXT;
ALTER TABLE "ConversationStateRecord" ADD COLUMN IF NOT EXISTS "state" "ConversationState" NOT NULL DEFAULT 'ACTIVE';
ALTER TABLE "ConversationStateRecord" ADD COLUMN IF NOT EXISTS "messageCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "ConversationStateRecord" ADD COLUMN IF NOT EXISTS "pauseReason" TEXT;
ALTER TABLE "ConversationStateRecord" ADD COLUMN IF NOT EXISTS "pausedAt" TIMESTAMP(3);
ALTER TABLE "ConversationStateRecord" ADD COLUMN IF NOT EXISTS "resumedAt" TIMESTAMP(3);
ALTER TABLE "ConversationStateRecord" ADD COLUMN IF NOT EXISTS "qualifyingAnswers" JSONB;
ALTER TABLE "ConversationStateRecord" ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "ConversationStateRecord" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3);

-- Table: ConversationMessage
CREATE TABLE IF NOT EXISTS "ConversationMessage" (
  "id" TEXT NOT NULL,
  "agentId" TEXT NOT NULL,
  "locationId" TEXT NOT NULL,
  "contactId" TEXT NOT NULL,
  "conversationId" TEXT NOT NULL,
  "role" TEXT NOT NULL,
  "content" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ConversationMessage_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "ConversationMessage" ADD COLUMN IF NOT EXISTS "id" TEXT;
ALTER TABLE "ConversationMessage" ADD COLUMN IF NOT EXISTS "agentId" TEXT;
ALTER TABLE "ConversationMessage" ADD COLUMN IF NOT EXISTS "locationId" TEXT;
ALTER TABLE "ConversationMessage" ADD COLUMN IF NOT EXISTS "contactId" TEXT;
ALTER TABLE "ConversationMessage" ADD COLUMN IF NOT EXISTS "conversationId" TEXT;
ALTER TABLE "ConversationMessage" ADD COLUMN IF NOT EXISTS "role" TEXT;
ALTER TABLE "ConversationMessage" ADD COLUMN IF NOT EXISTS "content" TEXT;
ALTER TABLE "ConversationMessage" ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Table: AgentListeningRule
CREATE TABLE IF NOT EXISTS "AgentListeningRule" (
  "id" TEXT NOT NULL,
  "agentId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "examples" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "order" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AgentListeningRule_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "AgentListeningRule" ADD COLUMN IF NOT EXISTS "id" TEXT;
ALTER TABLE "AgentListeningRule" ADD COLUMN IF NOT EXISTS "agentId" TEXT;
ALTER TABLE "AgentListeningRule" ADD COLUMN IF NOT EXISTS "name" TEXT;
ALTER TABLE "AgentListeningRule" ADD COLUMN IF NOT EXISTS "description" TEXT;
ALTER TABLE "AgentListeningRule" ADD COLUMN IF NOT EXISTS "examples" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "AgentListeningRule" ADD COLUMN IF NOT EXISTS "isActive" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "AgentListeningRule" ADD COLUMN IF NOT EXISTS "order" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "AgentListeningRule" ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "AgentListeningRule" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3);

-- Table: ContactMemory
CREATE TABLE IF NOT EXISTS "ContactMemory" (
  "id" TEXT NOT NULL,
  "agentId" TEXT NOT NULL,
  "locationId" TEXT NOT NULL,
  "contactId" TEXT NOT NULL,
  "summary" TEXT,
  "categories" JSONB,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ContactMemory_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "ContactMemory" ADD COLUMN IF NOT EXISTS "id" TEXT;
ALTER TABLE "ContactMemory" ADD COLUMN IF NOT EXISTS "agentId" TEXT;
ALTER TABLE "ContactMemory" ADD COLUMN IF NOT EXISTS "locationId" TEXT;
ALTER TABLE "ContactMemory" ADD COLUMN IF NOT EXISTS "contactId" TEXT;
ALTER TABLE "ContactMemory" ADD COLUMN IF NOT EXISTS "summary" TEXT;
ALTER TABLE "ContactMemory" ADD COLUMN IF NOT EXISTS "categories" JSONB;
ALTER TABLE "ContactMemory" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3);
ALTER TABLE "ContactMemory" ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Table: AgentTrigger
CREATE TABLE IF NOT EXISTS "AgentTrigger" (
  "id" TEXT NOT NULL,
  "agentId" TEXT NOT NULL,
  "eventType" TEXT NOT NULL,
  "tagFilter" TEXT,
  "channel" TEXT NOT NULL DEFAULT 'SMS',
  "messageMode" TEXT NOT NULL DEFAULT 'AI_GENERATE',
  "fixedMessage" TEXT,
  "aiInstructions" TEXT,
  "delaySeconds" INTEGER NOT NULL DEFAULT 0,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AgentTrigger_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "AgentTrigger" ADD COLUMN IF NOT EXISTS "id" TEXT;
ALTER TABLE "AgentTrigger" ADD COLUMN IF NOT EXISTS "agentId" TEXT;
ALTER TABLE "AgentTrigger" ADD COLUMN IF NOT EXISTS "eventType" TEXT;
ALTER TABLE "AgentTrigger" ADD COLUMN IF NOT EXISTS "tagFilter" TEXT;
ALTER TABLE "AgentTrigger" ADD COLUMN IF NOT EXISTS "channel" TEXT NOT NULL DEFAULT 'SMS';
ALTER TABLE "AgentTrigger" ADD COLUMN IF NOT EXISTS "messageMode" TEXT NOT NULL DEFAULT 'AI_GENERATE';
ALTER TABLE "AgentTrigger" ADD COLUMN IF NOT EXISTS "fixedMessage" TEXT;
ALTER TABLE "AgentTrigger" ADD COLUMN IF NOT EXISTS "aiInstructions" TEXT;
ALTER TABLE "AgentTrigger" ADD COLUMN IF NOT EXISTS "delaySeconds" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "AgentTrigger" ADD COLUMN IF NOT EXISTS "isActive" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "AgentTrigger" ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "AgentTrigger" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3);

-- Table: ChannelDeployment
CREATE TABLE IF NOT EXISTS "ChannelDeployment" (
  "id" TEXT NOT NULL,
  "agentId" TEXT NOT NULL,
  "channel" TEXT NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "config" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ChannelDeployment_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "ChannelDeployment" ADD COLUMN IF NOT EXISTS "id" TEXT;
ALTER TABLE "ChannelDeployment" ADD COLUMN IF NOT EXISTS "agentId" TEXT;
ALTER TABLE "ChannelDeployment" ADD COLUMN IF NOT EXISTS "channel" TEXT;
ALTER TABLE "ChannelDeployment" ADD COLUMN IF NOT EXISTS "isActive" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "ChannelDeployment" ADD COLUMN IF NOT EXISTS "config" JSONB;
ALTER TABLE "ChannelDeployment" ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "ChannelDeployment" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3);

-- Table: VapiConfig
CREATE TABLE IF NOT EXISTS "VapiConfig" (
  "id" TEXT NOT NULL,
  "agentId" TEXT NOT NULL,
  "phoneNumberId" TEXT,
  "phoneNumber" TEXT,
  "ttsProvider" TEXT NOT NULL DEFAULT 'vapi',
  "voiceProvider" TEXT NOT NULL DEFAULT 'elevenlabs',
  "voiceId" TEXT NOT NULL DEFAULT 'EXAVITQu4vr4xnSDxMaL',
  "voiceName" TEXT,
  "stability" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
  "similarityBoost" DOUBLE PRECISION NOT NULL DEFAULT 0.75,
  "speed" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
  "style" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
  "firstMessage" TEXT,
  "endCallMessage" TEXT,
  "maxDurationSecs" INTEGER NOT NULL DEFAULT 600,
  "recordCalls" BOOLEAN NOT NULL DEFAULT true,
  "backgroundSound" TEXT,
  "endCallPhrases" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "language" TEXT,
  "voiceTools" JSONB,
  "isActive" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "VapiConfig_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "VapiConfig" ADD COLUMN IF NOT EXISTS "id" TEXT;
ALTER TABLE "VapiConfig" ADD COLUMN IF NOT EXISTS "agentId" TEXT;
ALTER TABLE "VapiConfig" ADD COLUMN IF NOT EXISTS "phoneNumberId" TEXT;
ALTER TABLE "VapiConfig" ADD COLUMN IF NOT EXISTS "phoneNumber" TEXT;
ALTER TABLE "VapiConfig" ADD COLUMN IF NOT EXISTS "ttsProvider" TEXT NOT NULL DEFAULT 'vapi';
ALTER TABLE "VapiConfig" ADD COLUMN IF NOT EXISTS "voiceProvider" TEXT NOT NULL DEFAULT 'elevenlabs';
ALTER TABLE "VapiConfig" ADD COLUMN IF NOT EXISTS "voiceId" TEXT NOT NULL DEFAULT 'EXAVITQu4vr4xnSDxMaL';
ALTER TABLE "VapiConfig" ADD COLUMN IF NOT EXISTS "voiceName" TEXT;
ALTER TABLE "VapiConfig" ADD COLUMN IF NOT EXISTS "stability" DOUBLE PRECISION NOT NULL DEFAULT 0.5;
ALTER TABLE "VapiConfig" ADD COLUMN IF NOT EXISTS "similarityBoost" DOUBLE PRECISION NOT NULL DEFAULT 0.75;
ALTER TABLE "VapiConfig" ADD COLUMN IF NOT EXISTS "speed" DOUBLE PRECISION NOT NULL DEFAULT 1.0;
ALTER TABLE "VapiConfig" ADD COLUMN IF NOT EXISTS "style" DOUBLE PRECISION NOT NULL DEFAULT 0.0;
ALTER TABLE "VapiConfig" ADD COLUMN IF NOT EXISTS "firstMessage" TEXT;
ALTER TABLE "VapiConfig" ADD COLUMN IF NOT EXISTS "endCallMessage" TEXT;
ALTER TABLE "VapiConfig" ADD COLUMN IF NOT EXISTS "maxDurationSecs" INTEGER NOT NULL DEFAULT 600;
ALTER TABLE "VapiConfig" ADD COLUMN IF NOT EXISTS "recordCalls" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "VapiConfig" ADD COLUMN IF NOT EXISTS "backgroundSound" TEXT;
ALTER TABLE "VapiConfig" ADD COLUMN IF NOT EXISTS "endCallPhrases" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "VapiConfig" ADD COLUMN IF NOT EXISTS "language" TEXT;
ALTER TABLE "VapiConfig" ADD COLUMN IF NOT EXISTS "voiceTools" JSONB;
ALTER TABLE "VapiConfig" ADD COLUMN IF NOT EXISTS "isActive" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "VapiConfig" ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "VapiConfig" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3);

-- Table: CallLog
CREATE TABLE IF NOT EXISTS "CallLog" (
  "id" TEXT NOT NULL,
  "locationId" TEXT NOT NULL,
  "agentId" TEXT,
  "contactId" TEXT,
  "contactPhone" TEXT,
  "vapiCallId" TEXT,
  "direction" TEXT NOT NULL DEFAULT 'inbound',
  "status" TEXT NOT NULL DEFAULT 'completed',
  "durationSecs" INTEGER,
  "transcript" TEXT,
  "summary" TEXT,
  "recordingUrl" TEXT,
  "tokensUsed" INTEGER NOT NULL DEFAULT 0,
  "endedReason" TEXT,
  "triggerSource" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CallLog_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "CallLog" ADD COLUMN IF NOT EXISTS "id" TEXT;
ALTER TABLE "CallLog" ADD COLUMN IF NOT EXISTS "locationId" TEXT;
ALTER TABLE "CallLog" ADD COLUMN IF NOT EXISTS "agentId" TEXT;
ALTER TABLE "CallLog" ADD COLUMN IF NOT EXISTS "contactId" TEXT;
ALTER TABLE "CallLog" ADD COLUMN IF NOT EXISTS "contactPhone" TEXT;
ALTER TABLE "CallLog" ADD COLUMN IF NOT EXISTS "vapiCallId" TEXT;
ALTER TABLE "CallLog" ADD COLUMN IF NOT EXISTS "direction" TEXT NOT NULL DEFAULT 'inbound';
ALTER TABLE "CallLog" ADD COLUMN IF NOT EXISTS "status" TEXT NOT NULL DEFAULT 'completed';
ALTER TABLE "CallLog" ADD COLUMN IF NOT EXISTS "durationSecs" INTEGER;
ALTER TABLE "CallLog" ADD COLUMN IF NOT EXISTS "transcript" TEXT;
ALTER TABLE "CallLog" ADD COLUMN IF NOT EXISTS "summary" TEXT;
ALTER TABLE "CallLog" ADD COLUMN IF NOT EXISTS "recordingUrl" TEXT;
ALTER TABLE "CallLog" ADD COLUMN IF NOT EXISTS "tokensUsed" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "CallLog" ADD COLUMN IF NOT EXISTS "endedReason" TEXT;
ALTER TABLE "CallLog" ADD COLUMN IF NOT EXISTS "triggerSource" TEXT;
ALTER TABLE "CallLog" ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Table: ScheduledMessage
CREATE TABLE IF NOT EXISTS "ScheduledMessage" (
  "id" TEXT NOT NULL,
  "locationId" TEXT NOT NULL,
  "agentId" TEXT,
  "contactId" TEXT NOT NULL,
  "channel" TEXT NOT NULL DEFAULT 'SMS',
  "message" TEXT NOT NULL,
  "scheduledAt" TIMESTAMP(3) NOT NULL,
  "sentAt" TIMESTAMP(3),
  "status" TEXT NOT NULL DEFAULT 'pending',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ScheduledMessage_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "ScheduledMessage" ADD COLUMN IF NOT EXISTS "id" TEXT;
ALTER TABLE "ScheduledMessage" ADD COLUMN IF NOT EXISTS "locationId" TEXT;
ALTER TABLE "ScheduledMessage" ADD COLUMN IF NOT EXISTS "agentId" TEXT;
ALTER TABLE "ScheduledMessage" ADD COLUMN IF NOT EXISTS "contactId" TEXT;
ALTER TABLE "ScheduledMessage" ADD COLUMN IF NOT EXISTS "channel" TEXT NOT NULL DEFAULT 'SMS';
ALTER TABLE "ScheduledMessage" ADD COLUMN IF NOT EXISTS "message" TEXT;
ALTER TABLE "ScheduledMessage" ADD COLUMN IF NOT EXISTS "scheduledAt" TIMESTAMP(3);
ALTER TABLE "ScheduledMessage" ADD COLUMN IF NOT EXISTS "sentAt" TIMESTAMP(3);
ALTER TABLE "ScheduledMessage" ADD COLUMN IF NOT EXISTS "status" TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE "ScheduledMessage" ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Table: LeadScore
CREATE TABLE IF NOT EXISTS "LeadScore" (
  "id" TEXT NOT NULL,
  "locationId" TEXT NOT NULL,
  "agentId" TEXT NOT NULL,
  "contactId" TEXT NOT NULL,
  "score" INTEGER NOT NULL,
  "reason" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LeadScore_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "LeadScore" ADD COLUMN IF NOT EXISTS "id" TEXT;
ALTER TABLE "LeadScore" ADD COLUMN IF NOT EXISTS "locationId" TEXT;
ALTER TABLE "LeadScore" ADD COLUMN IF NOT EXISTS "agentId" TEXT;
ALTER TABLE "LeadScore" ADD COLUMN IF NOT EXISTS "contactId" TEXT;
ALTER TABLE "LeadScore" ADD COLUMN IF NOT EXISTS "score" INTEGER;
ALTER TABLE "LeadScore" ADD COLUMN IF NOT EXISTS "reason" TEXT;
ALTER TABLE "LeadScore" ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Table: MessageBuffer
CREATE TABLE IF NOT EXISTS "MessageBuffer" (
  "id" TEXT NOT NULL,
  "locationId" TEXT NOT NULL,
  "contactId" TEXT NOT NULL,
  "conversationId" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "processed" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MessageBuffer_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "MessageBuffer" ADD COLUMN IF NOT EXISTS "id" TEXT;
ALTER TABLE "MessageBuffer" ADD COLUMN IF NOT EXISTS "locationId" TEXT;
ALTER TABLE "MessageBuffer" ADD COLUMN IF NOT EXISTS "contactId" TEXT;
ALTER TABLE "MessageBuffer" ADD COLUMN IF NOT EXISTS "conversationId" TEXT;
ALTER TABLE "MessageBuffer" ADD COLUMN IF NOT EXISTS "body" TEXT;
ALTER TABLE "MessageBuffer" ADD COLUMN IF NOT EXISTS "processed" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "MessageBuffer" ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Table: Integration
CREATE TABLE IF NOT EXISTS "Integration" (
  "id" TEXT NOT NULL,
  "locationId" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "credentials" JSONB NOT NULL,
  "config" JSONB,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Integration_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "Integration" ADD COLUMN IF NOT EXISTS "id" TEXT;
ALTER TABLE "Integration" ADD COLUMN IF NOT EXISTS "locationId" TEXT;
ALTER TABLE "Integration" ADD COLUMN IF NOT EXISTS "type" TEXT;
ALTER TABLE "Integration" ADD COLUMN IF NOT EXISTS "name" TEXT;
ALTER TABLE "Integration" ADD COLUMN IF NOT EXISTS "credentials" JSONB;
ALTER TABLE "Integration" ADD COLUMN IF NOT EXISTS "config" JSONB;
ALTER TABLE "Integration" ADD COLUMN IF NOT EXISTS "isActive" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Integration" ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "Integration" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3);

-- Table: ChatWidget
CREATE TABLE IF NOT EXISTS "ChatWidget" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "publicKey" TEXT NOT NULL,
  "primaryColor" TEXT NOT NULL DEFAULT '#fa4d2e',
  "logoUrl" TEXT,
  "title" TEXT NOT NULL DEFAULT 'Chat with us',
  "subtitle" TEXT NOT NULL DEFAULT 'We typically reply within a minute',
  "welcomeMessage" TEXT NOT NULL DEFAULT 'Hi! How can we help?',
  "position" TEXT NOT NULL DEFAULT 'bottom-right',
  "requireEmail" BOOLEAN NOT NULL DEFAULT false,
  "askForNameEmail" BOOLEAN NOT NULL DEFAULT true,
  "voiceEnabled" BOOLEAN NOT NULL DEFAULT false,
  "voiceAgentId" TEXT,
  "defaultAgentId" TEXT,
  "allowedDomains" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ChatWidget_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "ChatWidget" ADD COLUMN IF NOT EXISTS "id" TEXT;
ALTER TABLE "ChatWidget" ADD COLUMN IF NOT EXISTS "workspaceId" TEXT;
ALTER TABLE "ChatWidget" ADD COLUMN IF NOT EXISTS "name" TEXT;
ALTER TABLE "ChatWidget" ADD COLUMN IF NOT EXISTS "publicKey" TEXT;
ALTER TABLE "ChatWidget" ADD COLUMN IF NOT EXISTS "primaryColor" TEXT NOT NULL DEFAULT '#fa4d2e';
ALTER TABLE "ChatWidget" ADD COLUMN IF NOT EXISTS "logoUrl" TEXT;
ALTER TABLE "ChatWidget" ADD COLUMN IF NOT EXISTS "title" TEXT NOT NULL DEFAULT 'Chat with us';
ALTER TABLE "ChatWidget" ADD COLUMN IF NOT EXISTS "subtitle" TEXT NOT NULL DEFAULT 'We typically reply within a minute';
ALTER TABLE "ChatWidget" ADD COLUMN IF NOT EXISTS "welcomeMessage" TEXT NOT NULL DEFAULT 'Hi! How can we help?';
ALTER TABLE "ChatWidget" ADD COLUMN IF NOT EXISTS "position" TEXT NOT NULL DEFAULT 'bottom-right';
ALTER TABLE "ChatWidget" ADD COLUMN IF NOT EXISTS "requireEmail" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "ChatWidget" ADD COLUMN IF NOT EXISTS "askForNameEmail" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "ChatWidget" ADD COLUMN IF NOT EXISTS "voiceEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "ChatWidget" ADD COLUMN IF NOT EXISTS "voiceAgentId" TEXT;
ALTER TABLE "ChatWidget" ADD COLUMN IF NOT EXISTS "defaultAgentId" TEXT;
ALTER TABLE "ChatWidget" ADD COLUMN IF NOT EXISTS "allowedDomains" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "ChatWidget" ADD COLUMN IF NOT EXISTS "isActive" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "ChatWidget" ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "ChatWidget" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3);

-- Table: WidgetVisitor
CREATE TABLE IF NOT EXISTS "WidgetVisitor" (
  "id" TEXT NOT NULL,
  "widgetId" TEXT NOT NULL,
  "cookieId" TEXT NOT NULL,
  "email" TEXT,
  "name" TEXT,
  "phone" TEXT,
  "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "crmContactId" TEXT,
  "userAgent" TEXT,
  "ipAddress" TEXT,
  CONSTRAINT "WidgetVisitor_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "WidgetVisitor" ADD COLUMN IF NOT EXISTS "id" TEXT;
ALTER TABLE "WidgetVisitor" ADD COLUMN IF NOT EXISTS "widgetId" TEXT;
ALTER TABLE "WidgetVisitor" ADD COLUMN IF NOT EXISTS "cookieId" TEXT;
ALTER TABLE "WidgetVisitor" ADD COLUMN IF NOT EXISTS "email" TEXT;
ALTER TABLE "WidgetVisitor" ADD COLUMN IF NOT EXISTS "name" TEXT;
ALTER TABLE "WidgetVisitor" ADD COLUMN IF NOT EXISTS "phone" TEXT;
ALTER TABLE "WidgetVisitor" ADD COLUMN IF NOT EXISTS "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "WidgetVisitor" ADD COLUMN IF NOT EXISTS "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "WidgetVisitor" ADD COLUMN IF NOT EXISTS "crmContactId" TEXT;
ALTER TABLE "WidgetVisitor" ADD COLUMN IF NOT EXISTS "userAgent" TEXT;
ALTER TABLE "WidgetVisitor" ADD COLUMN IF NOT EXISTS "ipAddress" TEXT;

-- Table: WidgetConversation
CREATE TABLE IF NOT EXISTS "WidgetConversation" (
  "id" TEXT NOT NULL,
  "widgetId" TEXT NOT NULL,
  "visitorId" TEXT NOT NULL,
  "agentId" TEXT,
  "status" TEXT NOT NULL DEFAULT 'active',
  "lastMessageAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "staleNotifiedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WidgetConversation_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "WidgetConversation" ADD COLUMN IF NOT EXISTS "id" TEXT;
ALTER TABLE "WidgetConversation" ADD COLUMN IF NOT EXISTS "widgetId" TEXT;
ALTER TABLE "WidgetConversation" ADD COLUMN IF NOT EXISTS "visitorId" TEXT;
ALTER TABLE "WidgetConversation" ADD COLUMN IF NOT EXISTS "agentId" TEXT;
ALTER TABLE "WidgetConversation" ADD COLUMN IF NOT EXISTS "status" TEXT NOT NULL DEFAULT 'active';
ALTER TABLE "WidgetConversation" ADD COLUMN IF NOT EXISTS "lastMessageAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "WidgetConversation" ADD COLUMN IF NOT EXISTS "staleNotifiedAt" TIMESTAMP(3);
ALTER TABLE "WidgetConversation" ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Table: WidgetMessage
CREATE TABLE IF NOT EXISTS "WidgetMessage" (
  "id" TEXT NOT NULL,
  "conversationId" TEXT NOT NULL,
  "role" TEXT NOT NULL,
  "content" TEXT NOT NULL,
  "kind" TEXT NOT NULL DEFAULT 'text',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WidgetMessage_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "WidgetMessage" ADD COLUMN IF NOT EXISTS "id" TEXT;
ALTER TABLE "WidgetMessage" ADD COLUMN IF NOT EXISTS "conversationId" TEXT;
ALTER TABLE "WidgetMessage" ADD COLUMN IF NOT EXISTS "role" TEXT;
ALTER TABLE "WidgetMessage" ADD COLUMN IF NOT EXISTS "content" TEXT;
ALTER TABLE "WidgetMessage" ADD COLUMN IF NOT EXISTS "kind" TEXT NOT NULL DEFAULT 'text';
ALTER TABLE "WidgetMessage" ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Table: WidgetVoiceCall
CREATE TABLE IF NOT EXISTS "WidgetVoiceCall" (
  "id" TEXT NOT NULL,
  "conversationId" TEXT NOT NULL,
  "vapiCallId" TEXT,
  "status" TEXT NOT NULL DEFAULT 'requested',
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "endedAt" TIMESTAMP(3),
  "durationSecs" INTEGER,
  "transcript" TEXT,
  CONSTRAINT "WidgetVoiceCall_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "WidgetVoiceCall" ADD COLUMN IF NOT EXISTS "id" TEXT;
ALTER TABLE "WidgetVoiceCall" ADD COLUMN IF NOT EXISTS "conversationId" TEXT;
ALTER TABLE "WidgetVoiceCall" ADD COLUMN IF NOT EXISTS "vapiCallId" TEXT;
ALTER TABLE "WidgetVoiceCall" ADD COLUMN IF NOT EXISTS "status" TEXT NOT NULL DEFAULT 'requested';
ALTER TABLE "WidgetVoiceCall" ADD COLUMN IF NOT EXISTS "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "WidgetVoiceCall" ADD COLUMN IF NOT EXISTS "endedAt" TIMESTAMP(3);
ALTER TABLE "WidgetVoiceCall" ADD COLUMN IF NOT EXISTS "durationSecs" INTEGER;
ALTER TABLE "WidgetVoiceCall" ADD COLUMN IF NOT EXISTS "transcript" TEXT;

-- Table: HelpCategory
CREATE TABLE IF NOT EXISTS "HelpCategory" (
  "id" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "icon" TEXT,
  "order" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "HelpCategory_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "HelpCategory" ADD COLUMN IF NOT EXISTS "id" TEXT;
ALTER TABLE "HelpCategory" ADD COLUMN IF NOT EXISTS "slug" TEXT;
ALTER TABLE "HelpCategory" ADD COLUMN IF NOT EXISTS "name" TEXT;
ALTER TABLE "HelpCategory" ADD COLUMN IF NOT EXISTS "description" TEXT;
ALTER TABLE "HelpCategory" ADD COLUMN IF NOT EXISTS "icon" TEXT;
ALTER TABLE "HelpCategory" ADD COLUMN IF NOT EXISTS "order" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "HelpCategory" ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "HelpCategory" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3);

-- Table: HelpArticle
CREATE TABLE IF NOT EXISTS "HelpArticle" (
  "id" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "summary" TEXT,
  "body" TEXT NOT NULL,
  "videoUrl" TEXT,
  "categoryId" TEXT,
  "status" TEXT NOT NULL DEFAULT 'draft',
  "publishedAt" TIMESTAMP(3),
  "authorEmail" TEXT,
  "order" INTEGER NOT NULL DEFAULT 0,
  "viewCount" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "HelpArticle_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "HelpArticle" ADD COLUMN IF NOT EXISTS "id" TEXT;
ALTER TABLE "HelpArticle" ADD COLUMN IF NOT EXISTS "slug" TEXT;
ALTER TABLE "HelpArticle" ADD COLUMN IF NOT EXISTS "title" TEXT;
ALTER TABLE "HelpArticle" ADD COLUMN IF NOT EXISTS "summary" TEXT;
ALTER TABLE "HelpArticle" ADD COLUMN IF NOT EXISTS "body" TEXT;
ALTER TABLE "HelpArticle" ADD COLUMN IF NOT EXISTS "videoUrl" TEXT;
ALTER TABLE "HelpArticle" ADD COLUMN IF NOT EXISTS "categoryId" TEXT;
ALTER TABLE "HelpArticle" ADD COLUMN IF NOT EXISTS "status" TEXT NOT NULL DEFAULT 'draft';
ALTER TABLE "HelpArticle" ADD COLUMN IF NOT EXISTS "publishedAt" TIMESTAMP(3);
ALTER TABLE "HelpArticle" ADD COLUMN IF NOT EXISTS "authorEmail" TEXT;
ALTER TABLE "HelpArticle" ADD COLUMN IF NOT EXISTS "order" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "HelpArticle" ADD COLUMN IF NOT EXISTS "viewCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "HelpArticle" ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "HelpArticle" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3);

-- Table: SuperAdmin
CREATE TABLE IF NOT EXISTS "SuperAdmin" (
  "id" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "passwordHash" TEXT NOT NULL,
  "name" TEXT,
  "lastLoginAt" TIMESTAMP(3),
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "role" TEXT NOT NULL DEFAULT 'admin',
  "twoFactorSecret" TEXT,
  "twoFactorVerifiedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SuperAdmin_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "SuperAdmin" ADD COLUMN IF NOT EXISTS "id" TEXT;
ALTER TABLE "SuperAdmin" ADD COLUMN IF NOT EXISTS "email" TEXT;
ALTER TABLE "SuperAdmin" ADD COLUMN IF NOT EXISTS "passwordHash" TEXT;
ALTER TABLE "SuperAdmin" ADD COLUMN IF NOT EXISTS "name" TEXT;
ALTER TABLE "SuperAdmin" ADD COLUMN IF NOT EXISTS "lastLoginAt" TIMESTAMP(3);
ALTER TABLE "SuperAdmin" ADD COLUMN IF NOT EXISTS "isActive" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "SuperAdmin" ADD COLUMN IF NOT EXISTS "role" TEXT NOT NULL DEFAULT 'admin';
ALTER TABLE "SuperAdmin" ADD COLUMN IF NOT EXISTS "twoFactorSecret" TEXT;
ALTER TABLE "SuperAdmin" ADD COLUMN IF NOT EXISTS "twoFactorVerifiedAt" TIMESTAMP(3);
ALTER TABLE "SuperAdmin" ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "SuperAdmin" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3);

-- Table: AgentReview
CREATE TABLE IF NOT EXISTS "AgentReview" (
  "id" TEXT NOT NULL,
  "agentId" TEXT NOT NULL,
  "contactId" TEXT NOT NULL,
  "conversationId" TEXT,
  "adminId" TEXT,
  "adminEmail" TEXT NOT NULL,
  "title" TEXT,
  "messages" JSONB NOT NULL DEFAULT '[]',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AgentReview_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "AgentReview" ADD COLUMN IF NOT EXISTS "id" TEXT;
ALTER TABLE "AgentReview" ADD COLUMN IF NOT EXISTS "agentId" TEXT;
ALTER TABLE "AgentReview" ADD COLUMN IF NOT EXISTS "contactId" TEXT;
ALTER TABLE "AgentReview" ADD COLUMN IF NOT EXISTS "conversationId" TEXT;
ALTER TABLE "AgentReview" ADD COLUMN IF NOT EXISTS "adminId" TEXT;
ALTER TABLE "AgentReview" ADD COLUMN IF NOT EXISTS "adminEmail" TEXT;
ALTER TABLE "AgentReview" ADD COLUMN IF NOT EXISTS "title" TEXT;
ALTER TABLE "AgentReview" ADD COLUMN IF NOT EXISTS "messages" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "AgentReview" ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "AgentReview" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3);

-- Table: PlatformLearning
CREATE TABLE IF NOT EXISTS "PlatformLearning" (
  "id" TEXT NOT NULL,
  "sourceReviewId" TEXT,
  "scope" TEXT NOT NULL DEFAULT 'this_agent',
  "workspaceId" TEXT,
  "agentId" TEXT,
  "type" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "content" TEXT NOT NULL,
  "rationale" TEXT,
  "status" TEXT NOT NULL DEFAULT 'proposed',
  "proposedByEmail" TEXT NOT NULL,
  "approvedByEmail" TEXT,
  "rejectedByEmail" TEXT,
  "rejectedReason" TEXT,
  "appliedAt" TIMESTAMP(3),
  "appliedTarget" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PlatformLearning_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "PlatformLearning" ADD COLUMN IF NOT EXISTS "id" TEXT;
ALTER TABLE "PlatformLearning" ADD COLUMN IF NOT EXISTS "sourceReviewId" TEXT;
ALTER TABLE "PlatformLearning" ADD COLUMN IF NOT EXISTS "scope" TEXT NOT NULL DEFAULT 'this_agent';
ALTER TABLE "PlatformLearning" ADD COLUMN IF NOT EXISTS "workspaceId" TEXT;
ALTER TABLE "PlatformLearning" ADD COLUMN IF NOT EXISTS "agentId" TEXT;
ALTER TABLE "PlatformLearning" ADD COLUMN IF NOT EXISTS "type" TEXT;
ALTER TABLE "PlatformLearning" ADD COLUMN IF NOT EXISTS "title" TEXT;
ALTER TABLE "PlatformLearning" ADD COLUMN IF NOT EXISTS "content" TEXT;
ALTER TABLE "PlatformLearning" ADD COLUMN IF NOT EXISTS "rationale" TEXT;
ALTER TABLE "PlatformLearning" ADD COLUMN IF NOT EXISTS "status" TEXT NOT NULL DEFAULT 'proposed';
ALTER TABLE "PlatformLearning" ADD COLUMN IF NOT EXISTS "proposedByEmail" TEXT;
ALTER TABLE "PlatformLearning" ADD COLUMN IF NOT EXISTS "approvedByEmail" TEXT;
ALTER TABLE "PlatformLearning" ADD COLUMN IF NOT EXISTS "rejectedByEmail" TEXT;
ALTER TABLE "PlatformLearning" ADD COLUMN IF NOT EXISTS "rejectedReason" TEXT;
ALTER TABLE "PlatformLearning" ADD COLUMN IF NOT EXISTS "appliedAt" TIMESTAMP(3);
ALTER TABLE "PlatformLearning" ADD COLUMN IF NOT EXISTS "appliedTarget" TEXT;
ALTER TABLE "PlatformLearning" ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "PlatformLearning" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3);

-- Table: Simulation
CREATE TABLE IF NOT EXISTS "Simulation" (
  "id" TEXT NOT NULL,
  "agentId" TEXT NOT NULL,
  "workspaceId" TEXT,
  "personaContext" TEXT NOT NULL,
  "channel" TEXT NOT NULL,
  "style" TEXT NOT NULL,
  "goal" TEXT,
  "maxTurns" INTEGER NOT NULL DEFAULT 10,
  "status" TEXT NOT NULL DEFAULT 'queued',
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "errorMessage" TEXT,
  "turnCount" INTEGER NOT NULL DEFAULT 0,
  "transcript" JSONB NOT NULL DEFAULT '[]',
  "reviewId" TEXT,
  "proposedLearningsCount" INTEGER NOT NULL DEFAULT 0,
  "createdByType" TEXT NOT NULL,
  "createdByEmail" TEXT,
  "swarmId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Simulation_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "Simulation" ADD COLUMN IF NOT EXISTS "id" TEXT;
ALTER TABLE "Simulation" ADD COLUMN IF NOT EXISTS "agentId" TEXT;
ALTER TABLE "Simulation" ADD COLUMN IF NOT EXISTS "workspaceId" TEXT;
ALTER TABLE "Simulation" ADD COLUMN IF NOT EXISTS "personaContext" TEXT;
ALTER TABLE "Simulation" ADD COLUMN IF NOT EXISTS "channel" TEXT;
ALTER TABLE "Simulation" ADD COLUMN IF NOT EXISTS "style" TEXT;
ALTER TABLE "Simulation" ADD COLUMN IF NOT EXISTS "goal" TEXT;
ALTER TABLE "Simulation" ADD COLUMN IF NOT EXISTS "maxTurns" INTEGER NOT NULL DEFAULT 10;
ALTER TABLE "Simulation" ADD COLUMN IF NOT EXISTS "status" TEXT NOT NULL DEFAULT 'queued';
ALTER TABLE "Simulation" ADD COLUMN IF NOT EXISTS "startedAt" TIMESTAMP(3);
ALTER TABLE "Simulation" ADD COLUMN IF NOT EXISTS "completedAt" TIMESTAMP(3);
ALTER TABLE "Simulation" ADD COLUMN IF NOT EXISTS "errorMessage" TEXT;
ALTER TABLE "Simulation" ADD COLUMN IF NOT EXISTS "turnCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Simulation" ADD COLUMN IF NOT EXISTS "transcript" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "Simulation" ADD COLUMN IF NOT EXISTS "reviewId" TEXT;
ALTER TABLE "Simulation" ADD COLUMN IF NOT EXISTS "proposedLearningsCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Simulation" ADD COLUMN IF NOT EXISTS "createdByType" TEXT;
ALTER TABLE "Simulation" ADD COLUMN IF NOT EXISTS "createdByEmail" TEXT;
ALTER TABLE "Simulation" ADD COLUMN IF NOT EXISTS "swarmId" TEXT;
ALTER TABLE "Simulation" ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "Simulation" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3);

-- Table: SimulationSwarm
CREATE TABLE IF NOT EXISTS "SimulationSwarm" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "agentIds" TEXT[],
  "personaProfiles" JSONB NOT NULL,
  "runsPerAgent" INTEGER NOT NULL DEFAULT 1,
  "status" TEXT NOT NULL DEFAULT 'queued',
  "createdByEmail" TEXT NOT NULL,
  "totalPlanned" INTEGER NOT NULL,
  "totalComplete" INTEGER NOT NULL DEFAULT 0,
  "totalFailed" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SimulationSwarm_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "SimulationSwarm" ADD COLUMN IF NOT EXISTS "id" TEXT;
ALTER TABLE "SimulationSwarm" ADD COLUMN IF NOT EXISTS "name" TEXT;
ALTER TABLE "SimulationSwarm" ADD COLUMN IF NOT EXISTS "agentIds" TEXT[];
ALTER TABLE "SimulationSwarm" ADD COLUMN IF NOT EXISTS "personaProfiles" JSONB;
ALTER TABLE "SimulationSwarm" ADD COLUMN IF NOT EXISTS "runsPerAgent" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "SimulationSwarm" ADD COLUMN IF NOT EXISTS "status" TEXT NOT NULL DEFAULT 'queued';
ALTER TABLE "SimulationSwarm" ADD COLUMN IF NOT EXISTS "createdByEmail" TEXT;
ALTER TABLE "SimulationSwarm" ADD COLUMN IF NOT EXISTS "totalPlanned" INTEGER;
ALTER TABLE "SimulationSwarm" ADD COLUMN IF NOT EXISTS "totalComplete" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "SimulationSwarm" ADD COLUMN IF NOT EXISTS "totalFailed" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "SimulationSwarm" ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "SimulationSwarm" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3);

-- Table: SystemSetting
CREATE TABLE IF NOT EXISTS "SystemSetting" (
  "key" TEXT NOT NULL,
  "value" JSONB NOT NULL,
  "updatedBy" TEXT,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SystemSetting_pkey" PRIMARY KEY ("key")
);
ALTER TABLE "SystemSetting" ADD COLUMN IF NOT EXISTS "key" TEXT;
ALTER TABLE "SystemSetting" ADD COLUMN IF NOT EXISTS "value" JSONB;
ALTER TABLE "SystemSetting" ADD COLUMN IF NOT EXISTS "updatedBy" TEXT;
ALTER TABLE "SystemSetting" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3);

-- Table: AdminAuditLog
CREATE TABLE IF NOT EXISTS "AdminAuditLog" (
  "id" TEXT NOT NULL,
  "adminId" TEXT,
  "adminEmail" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "target" TEXT,
  "meta" JSONB,
  "ipAddress" TEXT,
  "userAgent" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AdminAuditLog_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "AdminAuditLog" ADD COLUMN IF NOT EXISTS "id" TEXT;
ALTER TABLE "AdminAuditLog" ADD COLUMN IF NOT EXISTS "adminId" TEXT;
ALTER TABLE "AdminAuditLog" ADD COLUMN IF NOT EXISTS "adminEmail" TEXT;
ALTER TABLE "AdminAuditLog" ADD COLUMN IF NOT EXISTS "action" TEXT;
ALTER TABLE "AdminAuditLog" ADD COLUMN IF NOT EXISTS "target" TEXT;
ALTER TABLE "AdminAuditLog" ADD COLUMN IF NOT EXISTS "meta" JSONB;
ALTER TABLE "AdminAuditLog" ADD COLUMN IF NOT EXISTS "ipAddress" TEXT;
ALTER TABLE "AdminAuditLog" ADD COLUMN IF NOT EXISTS "userAgent" TEXT;
ALTER TABLE "AdminAuditLog" ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE UNIQUE INDEX IF NOT EXISTS "User_email_key" ON "User"("email");
CREATE UNIQUE INDEX IF NOT EXISTS "Account_provider_providerAccountId_key" ON "Account"("provider", "providerAccountId");
CREATE UNIQUE INDEX IF NOT EXISTS "Session_sessionToken_key" ON "Session"("sessionToken");
CREATE UNIQUE INDEX IF NOT EXISTS "VerificationToken_token_key" ON "VerificationToken"("token");
CREATE UNIQUE INDEX IF NOT EXISTS "VerificationToken_identifier_token_key" ON "VerificationToken"("identifier", "token");
CREATE UNIQUE INDEX IF NOT EXISTS "UserLocation_userId_locationId_key" ON "UserLocation"("userId", "locationId");
CREATE UNIQUE INDEX IF NOT EXISTS "Workspace_slug_key" ON "Workspace"("slug");
CREATE UNIQUE INDEX IF NOT EXISTS "Workspace_stripeCustomerId_key" ON "Workspace"("stripeCustomerId");
CREATE UNIQUE INDEX IF NOT EXISTS "Workspace_stripeSubscriptionId_key" ON "Workspace"("stripeSubscriptionId");
CREATE INDEX IF NOT EXISTS "UsageRecord_workspaceId_billingPeriod_idx" ON "UsageRecord"("workspaceId", "billingPeriod");
CREATE INDEX IF NOT EXISTS "UsageRecord_workspaceId_type_createdAt_idx" ON "UsageRecord"("workspaceId", "type", "createdAt");
CREATE UNIQUE INDEX IF NOT EXISTS "WorkspaceMember_userId_workspaceId_key" ON "WorkspaceMember"("userId", "workspaceId");
CREATE INDEX IF NOT EXISTS "WorkspaceInvite_email_idx" ON "WorkspaceInvite"("email");
CREATE UNIQUE INDEX IF NOT EXISTS "WorkspaceInvite_workspaceId_email_key" ON "WorkspaceInvite"("workspaceId", "email");
CREATE INDEX IF NOT EXISTS "Location_companyId_idx" ON "Location"("companyId");
CREATE INDEX IF NOT EXISTS "Location_workspaceId_idx" ON "Location"("workspaceId");
CREATE INDEX IF NOT EXISTS "Agent_locationId_isActive_idx" ON "Agent"("locationId", "isActive");
CREATE INDEX IF NOT EXISTS "Agent_workspaceId_idx" ON "Agent"("workspaceId");
CREATE INDEX IF NOT EXISTS "KnowledgeEntry_agentId_idx" ON "KnowledgeEntry"("agentId");
CREATE INDEX IF NOT EXISTS "KnowledgeEntry_agentId_status_idx" ON "KnowledgeEntry"("agentId", "status");
CREATE INDEX IF NOT EXISTS "CrawlSchedule_agentId_idx" ON "CrawlSchedule"("agentId");
CREATE INDEX IF NOT EXISTS "CrawlSchedule_isActive_nextRunAt_idx" ON "CrawlSchedule"("isActive", "nextRunAt");
CREATE INDEX IF NOT EXISTS "RoutingRule_agentId_priority_idx" ON "RoutingRule"("agentId", "priority");
CREATE INDEX IF NOT EXISTS "AgentRule_agentId_isActive_order_idx" ON "AgentRule"("agentId", "isActive", "order");
CREATE INDEX IF NOT EXISTS "MessageLog_locationId_createdAt_idx" ON "MessageLog"("locationId", "createdAt" DESC);
CREATE INDEX IF NOT EXISTS "MessageLog_agentId_createdAt_idx" ON "MessageLog"("agentId", "createdAt" DESC);
CREATE INDEX IF NOT EXISTS "MessageLog_needsApproval_approvalStatus_idx" ON "MessageLog"("needsApproval", "approvalStatus");
CREATE INDEX IF NOT EXISTS "MessageCorrection_messageLogId_idx" ON "MessageCorrection"("messageLogId");
CREATE INDEX IF NOT EXISTS "MessageCorrection_correctedBy_createdAt_idx" ON "MessageCorrection"("correctedBy", "createdAt" DESC);
CREATE INDEX IF NOT EXISTS "AgentPromptVersion_agentId_createdAt_idx" ON "AgentPromptVersion"("agentId", "createdAt" DESC);
CREATE INDEX IF NOT EXISTS "AgentEvaluation_agentId_idx" ON "AgentEvaluation"("agentId");
CREATE INDEX IF NOT EXISTS "AgentEvaluationRun_evaluationId_runAt_idx" ON "AgentEvaluationRun"("evaluationId", "runAt" DESC);
CREATE INDEX IF NOT EXISTS "AgentGoal_agentId_idx" ON "AgentGoal"("agentId");
CREATE INDEX IF NOT EXISTS "AgentGoal_agentId_isPrimary_priority_idx" ON "AgentGoal"("agentId", "isPrimary", "priority");
CREATE INDEX IF NOT EXISTS "AgentGoalEvent_goalId_achievedAt_idx" ON "AgentGoalEvent"("goalId", "achievedAt" DESC);
CREATE INDEX IF NOT EXISTS "AgentGoalEvent_contactId_idx" ON "AgentGoalEvent"("contactId");
CREATE INDEX IF NOT EXISTS "AuditLog_workspaceId_createdAt_idx" ON "AuditLog"("workspaceId", "createdAt" DESC);
CREATE INDEX IF NOT EXISTS "AuditLog_actorId_createdAt_idx" ON "AuditLog"("actorId", "createdAt" DESC);
CREATE INDEX IF NOT EXISTS "ContactConsent_workspaceId_status_idx" ON "ContactConsent"("workspaceId", "status");
CREATE UNIQUE INDEX IF NOT EXISTS "ContactConsent_contactId_channel_workspaceId_key" ON "ContactConsent"("contactId", "channel", "workspaceId");
CREATE INDEX IF NOT EXISTS "LiveTakeover_agentId_endedAt_idx" ON "LiveTakeover"("agentId", "endedAt");
CREATE INDEX IF NOT EXISTS "LiveTakeover_contactId_endedAt_idx" ON "LiveTakeover"("contactId", "endedAt");
CREATE INDEX IF NOT EXISTS "WebhookSubscription_workspaceId_idx" ON "WebhookSubscription"("workspaceId");
CREATE INDEX IF NOT EXISTS "WebhookDelivery_subscriptionId_deliveredAt_idx" ON "WebhookDelivery"("subscriptionId", "deliveredAt" DESC);
CREATE UNIQUE INDEX IF NOT EXISTS "AgentTemplate_slug_key" ON "AgentTemplate"("slug");
CREATE INDEX IF NOT EXISTS "AgentTemplate_category_idx" ON "AgentTemplate"("category");
CREATE INDEX IF NOT EXISTS "AgentTemplate_workspaceId_idx" ON "AgentTemplate"("workspaceId");
CREATE INDEX IF NOT EXISTS "NotificationChannel_workspaceId_type_idx" ON "NotificationChannel"("workspaceId", "type");
CREATE INDEX IF NOT EXISTS "StopCondition_agentId_idx" ON "StopCondition"("agentId");
CREATE INDEX IF NOT EXISTS "FollowUpSequence_agentId_idx" ON "FollowUpSequence"("agentId");
CREATE INDEX IF NOT EXISTS "FollowUpStep_sequenceId_stepNumber_idx" ON "FollowUpStep"("sequenceId", "stepNumber");
CREATE INDEX IF NOT EXISTS "FollowUpJob_status_scheduledAt_idx" ON "FollowUpJob"("status", "scheduledAt");
CREATE INDEX IF NOT EXISTS "FollowUpJob_locationId_contactId_idx" ON "FollowUpJob"("locationId", "contactId");
CREATE INDEX IF NOT EXISTS "QualifyingQuestion_agentId_order_idx" ON "QualifyingQuestion"("agentId", "order");
CREATE INDEX IF NOT EXISTS "ConversationStateRecord_locationId_state_idx" ON "ConversationStateRecord"("locationId", "state");
CREATE UNIQUE INDEX IF NOT EXISTS "ConversationStateRecord_agentId_contactId_key" ON "ConversationStateRecord"("agentId", "contactId");
CREATE INDEX IF NOT EXISTS "ConversationMessage_agentId_contactId_createdAt_idx" ON "ConversationMessage"("agentId", "contactId", "createdAt" ASC);
CREATE INDEX IF NOT EXISTS "ConversationMessage_conversationId_createdAt_idx" ON "ConversationMessage"("conversationId", "createdAt" ASC);
CREATE INDEX IF NOT EXISTS "AgentListeningRule_agentId_isActive_order_idx" ON "AgentListeningRule"("agentId", "isActive", "order");
CREATE UNIQUE INDEX IF NOT EXISTS "ContactMemory_agentId_contactId_key" ON "ContactMemory"("agentId", "contactId");
CREATE INDEX IF NOT EXISTS "AgentTrigger_agentId_idx" ON "AgentTrigger"("agentId");
CREATE INDEX IF NOT EXISTS "AgentTrigger_eventType_isActive_idx" ON "AgentTrigger"("eventType", "isActive");
CREATE INDEX IF NOT EXISTS "ChannelDeployment_channel_isActive_idx" ON "ChannelDeployment"("channel", "isActive");
CREATE UNIQUE INDEX IF NOT EXISTS "ChannelDeployment_agentId_channel_key" ON "ChannelDeployment"("agentId", "channel");
CREATE UNIQUE INDEX IF NOT EXISTS "VapiConfig_agentId_key" ON "VapiConfig"("agentId");
CREATE UNIQUE INDEX IF NOT EXISTS "CallLog_vapiCallId_key" ON "CallLog"("vapiCallId");
CREATE INDEX IF NOT EXISTS "CallLog_locationId_createdAt_idx" ON "CallLog"("locationId", "createdAt" DESC);
CREATE INDEX IF NOT EXISTS "CallLog_agentId_createdAt_idx" ON "CallLog"("agentId", "createdAt" DESC);
CREATE INDEX IF NOT EXISTS "ScheduledMessage_status_scheduledAt_idx" ON "ScheduledMessage"("status", "scheduledAt");
CREATE INDEX IF NOT EXISTS "ScheduledMessage_locationId_contactId_idx" ON "ScheduledMessage"("locationId", "contactId");
CREATE INDEX IF NOT EXISTS "LeadScore_locationId_score_idx" ON "LeadScore"("locationId", "score" DESC);
CREATE UNIQUE INDEX IF NOT EXISTS "LeadScore_agentId_contactId_key" ON "LeadScore"("agentId", "contactId");
CREATE INDEX IF NOT EXISTS "MessageBuffer_locationId_contactId_processed_createdAt_idx" ON "MessageBuffer"("locationId", "contactId", "processed", "createdAt" ASC);
CREATE INDEX IF NOT EXISTS "Integration_locationId_type_idx" ON "Integration"("locationId", "type");
CREATE UNIQUE INDEX IF NOT EXISTS "ChatWidget_publicKey_key" ON "ChatWidget"("publicKey");
CREATE INDEX IF NOT EXISTS "ChatWidget_workspaceId_idx" ON "ChatWidget"("workspaceId");
CREATE INDEX IF NOT EXISTS "WidgetVisitor_widgetId_lastSeenAt_idx" ON "WidgetVisitor"("widgetId", "lastSeenAt");
CREATE UNIQUE INDEX IF NOT EXISTS "WidgetVisitor_widgetId_cookieId_key" ON "WidgetVisitor"("widgetId", "cookieId");
CREATE INDEX IF NOT EXISTS "WidgetConversation_widgetId_lastMessageAt_idx" ON "WidgetConversation"("widgetId", "lastMessageAt" DESC);
CREATE INDEX IF NOT EXISTS "WidgetConversation_visitorId_idx" ON "WidgetConversation"("visitorId");
CREATE INDEX IF NOT EXISTS "WidgetConversation_agentId_status_idx" ON "WidgetConversation"("agentId", "status");
CREATE INDEX IF NOT EXISTS "WidgetMessage_conversationId_createdAt_idx" ON "WidgetMessage"("conversationId", "createdAt" ASC);
CREATE INDEX IF NOT EXISTS "WidgetVoiceCall_conversationId_idx" ON "WidgetVoiceCall"("conversationId");
CREATE UNIQUE INDEX IF NOT EXISTS "HelpCategory_slug_key" ON "HelpCategory"("slug");
CREATE INDEX IF NOT EXISTS "HelpCategory_order_idx" ON "HelpCategory"("order");
CREATE UNIQUE INDEX IF NOT EXISTS "HelpArticle_slug_key" ON "HelpArticle"("slug");
CREATE INDEX IF NOT EXISTS "HelpArticle_categoryId_order_idx" ON "HelpArticle"("categoryId", "order");
CREATE INDEX IF NOT EXISTS "HelpArticle_status_publishedAt_idx" ON "HelpArticle"("status", "publishedAt");
CREATE UNIQUE INDEX IF NOT EXISTS "SuperAdmin_email_key" ON "SuperAdmin"("email");
CREATE INDEX IF NOT EXISTS "SuperAdmin_email_idx" ON "SuperAdmin"("email");
CREATE INDEX IF NOT EXISTS "AgentReview_agentId_createdAt_idx" ON "AgentReview"("agentId", "createdAt" DESC);
CREATE INDEX IF NOT EXISTS "AgentReview_contactId_createdAt_idx" ON "AgentReview"("contactId", "createdAt" DESC);
CREATE INDEX IF NOT EXISTS "AgentReview_adminId_createdAt_idx" ON "AgentReview"("adminId", "createdAt" DESC);
CREATE INDEX IF NOT EXISTS "PlatformLearning_agentId_status_idx" ON "PlatformLearning"("agentId", "status");
CREATE INDEX IF NOT EXISTS "PlatformLearning_status_createdAt_idx" ON "PlatformLearning"("status", "createdAt" DESC);
CREATE INDEX IF NOT EXISTS "PlatformLearning_sourceReviewId_idx" ON "PlatformLearning"("sourceReviewId");
CREATE INDEX IF NOT EXISTS "PlatformLearning_scope_status_idx" ON "PlatformLearning"("scope", "status");
CREATE INDEX IF NOT EXISTS "PlatformLearning_workspaceId_status_idx" ON "PlatformLearning"("workspaceId", "status");
CREATE INDEX IF NOT EXISTS "Simulation_agentId_createdAt_idx" ON "Simulation"("agentId", "createdAt" DESC);
CREATE INDEX IF NOT EXISTS "Simulation_workspaceId_status_idx" ON "Simulation"("workspaceId", "status");
CREATE INDEX IF NOT EXISTS "Simulation_status_createdAt_idx" ON "Simulation"("status", "createdAt");
CREATE INDEX IF NOT EXISTS "Simulation_swarmId_idx" ON "Simulation"("swarmId");
CREATE INDEX IF NOT EXISTS "SimulationSwarm_status_createdAt_idx" ON "SimulationSwarm"("status", "createdAt");
CREATE INDEX IF NOT EXISTS "AdminAuditLog_adminId_createdAt_idx" ON "AdminAuditLog"("adminId", "createdAt");
CREATE INDEX IF NOT EXISTS "AdminAuditLog_action_createdAt_idx" ON "AdminAuditLog"("action", "createdAt");
CREATE INDEX IF NOT EXISTS "AdminAuditLog_createdAt_idx" ON "AdminAuditLog"("createdAt");
DO $$ BEGIN
  ALTER TABLE "Account" ADD CONSTRAINT "Account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "UserLocation" ADD CONSTRAINT "UserLocation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "UserLocation" ADD CONSTRAINT "UserLocation_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "UsageRecord" ADD CONSTRAINT "UsageRecord_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "WorkspaceMember" ADD CONSTRAINT "WorkspaceMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "WorkspaceMember" ADD CONSTRAINT "WorkspaceMember_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "WorkspaceInvite" ADD CONSTRAINT "WorkspaceInvite_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "Location" ADD CONSTRAINT "Location_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "Agent" ADD CONSTRAINT "Agent_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "Agent" ADD CONSTRAINT "Agent_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "KnowledgeEntry" ADD CONSTRAINT "KnowledgeEntry_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "RoutingRule" ADD CONSTRAINT "RoutingRule_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "AgentRule" ADD CONSTRAINT "AgentRule_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "MessageLog" ADD CONSTRAINT "MessageLog_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "MessageLog" ADD CONSTRAINT "MessageLog_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "MessageCorrection" ADD CONSTRAINT "MessageCorrection_messageLogId_fkey" FOREIGN KEY ("messageLogId") REFERENCES "MessageLog"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "AgentEvaluationRun" ADD CONSTRAINT "AgentEvaluationRun_evaluationId_fkey" FOREIGN KEY ("evaluationId") REFERENCES "AgentEvaluation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "AgentGoalEvent" ADD CONSTRAINT "AgentGoalEvent_goalId_fkey" FOREIGN KEY ("goalId") REFERENCES "AgentGoal"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "WebhookDelivery" ADD CONSTRAINT "WebhookDelivery_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "WebhookSubscription"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "AgentTemplate" ADD CONSTRAINT "AgentTemplate_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "StopCondition" ADD CONSTRAINT "StopCondition_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "FollowUpSequence" ADD CONSTRAINT "FollowUpSequence_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "FollowUpStep" ADD CONSTRAINT "FollowUpStep_sequenceId_fkey" FOREIGN KEY ("sequenceId") REFERENCES "FollowUpSequence"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "FollowUpJob" ADD CONSTRAINT "FollowUpJob_sequenceId_fkey" FOREIGN KEY ("sequenceId") REFERENCES "FollowUpSequence"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "QualifyingQuestion" ADD CONSTRAINT "QualifyingQuestion_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "ConversationStateRecord" ADD CONSTRAINT "ConversationStateRecord_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "ConversationMessage" ADD CONSTRAINT "ConversationMessage_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "AgentListeningRule" ADD CONSTRAINT "AgentListeningRule_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "ContactMemory" ADD CONSTRAINT "ContactMemory_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "AgentTrigger" ADD CONSTRAINT "AgentTrigger_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "ChannelDeployment" ADD CONSTRAINT "ChannelDeployment_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "VapiConfig" ADD CONSTRAINT "VapiConfig_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "WidgetVisitor" ADD CONSTRAINT "WidgetVisitor_widgetId_fkey" FOREIGN KEY ("widgetId") REFERENCES "ChatWidget"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "WidgetConversation" ADD CONSTRAINT "WidgetConversation_widgetId_fkey" FOREIGN KEY ("widgetId") REFERENCES "ChatWidget"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "WidgetConversation" ADD CONSTRAINT "WidgetConversation_visitorId_fkey" FOREIGN KEY ("visitorId") REFERENCES "WidgetVisitor"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "WidgetMessage" ADD CONSTRAINT "WidgetMessage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "WidgetConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "WidgetVoiceCall" ADD CONSTRAINT "WidgetVoiceCall_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "WidgetConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "HelpArticle" ADD CONSTRAINT "HelpArticle_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "HelpCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "AgentReview" ADD CONSTRAINT "AgentReview_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "AgentReview" ADD CONSTRAINT "AgentReview_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "SuperAdmin"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "PlatformLearning" ADD CONSTRAINT "PlatformLearning_sourceReviewId_fkey" FOREIGN KEY ("sourceReviewId") REFERENCES "AgentReview"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "PlatformLearning" ADD CONSTRAINT "PlatformLearning_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "Simulation" ADD CONSTRAINT "Simulation_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "Simulation" ADD CONSTRAINT "Simulation_swarmId_fkey" FOREIGN KEY ("swarmId") REFERENCES "SimulationSwarm"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "AdminAuditLog" ADD CONSTRAINT "AdminAuditLog_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "SuperAdmin"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;