-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "ConversationState" AS ENUM ('ACTIVE', 'PAUSED', 'COMPLETED');

-- CreateEnum
CREATE TYPE "StopConditionType" AS ENUM ('APPOINTMENT_BOOKED', 'KEYWORD', 'MESSAGE_COUNT', 'OPPORTUNITY_STAGE', 'SENTIMENT');

-- CreateEnum
CREATE TYPE "FollowUpStatus" AS ENUM ('SCHEDULED', 'SENT', 'CANCELLED', 'FAILED');

-- CreateEnum
CREATE TYPE "ResponseLength" AS ENUM ('BRIEF', 'MODERATE', 'DETAILED');

-- CreateEnum
CREATE TYPE "FormalityLevel" AS ENUM ('CASUAL', 'NEUTRAL', 'FORMAL');

-- CreateEnum
CREATE TYPE "RuleType" AS ENUM ('ALL', 'TAG', 'PIPELINE_STAGE', 'KEYWORD');

-- CreateEnum
CREATE TYPE "LogStatus" AS ENUM ('PENDING', 'SUCCESS', 'ERROR', 'SKIPPED');

-- CreateTable
CREATE TABLE "User" (
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

-- CreateTable
CREATE TABLE "Account" (
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

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "sessionToken" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VerificationToken" (
    "identifier" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL
);

-- CreateTable
CREATE TABLE "UserLocation" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'owner',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserLocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Workspace" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "icon" TEXT NOT NULL DEFAULT '🚀',
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
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Workspace_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UsageRecord" (
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

-- CreateTable
CREATE TABLE "WorkspaceMember" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'owner',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkspaceMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkspaceInvite" (
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

-- CreateTable
CREATE TABLE "Location" (
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

-- CreateTable
CREATE TABLE "Agent" (
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

-- CreateTable
CREATE TABLE "KnowledgeEntry" (
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

-- CreateTable
CREATE TABLE "CrawlSchedule" (
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

-- CreateTable
CREATE TABLE "RoutingRule" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 10,
    "ruleType" "RuleType" NOT NULL,
    "value" TEXT,
    "conditions" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RoutingRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentRule" (
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

-- CreateTable
CREATE TABLE "MessageLog" (
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

-- CreateTable
CREATE TABLE "MessageCorrection" (
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

-- CreateTable
CREATE TABLE "AgentPromptVersion" (
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

-- CreateTable
CREATE TABLE "AgentEvaluation" (
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

-- CreateTable
CREATE TABLE "AgentEvaluationRun" (
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

-- CreateTable
CREATE TABLE "AgentGoal" (
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

-- CreateTable
CREATE TABLE "AgentGoalEvent" (
    "id" TEXT NOT NULL,
    "goalId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "conversationId" TEXT,
    "achievedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "turnsToAchieve" INTEGER,

    CONSTRAINT "AgentGoalEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
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

-- CreateTable
CREATE TABLE "ContactConsent" (
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

-- CreateTable
CREATE TABLE "LiveTakeover" (
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

-- CreateTable
CREATE TABLE "WebhookSubscription" (
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

-- CreateTable
CREATE TABLE "WebhookDelivery" (
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

-- CreateTable
CREATE TABLE "AgentTemplate" (
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

-- CreateTable
CREATE TABLE "NotificationChannel" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "config" JSONB NOT NULL,
    "events" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NotificationChannel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StopCondition" (
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

-- CreateTable
CREATE TABLE "FollowUpSequence" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "triggerType" TEXT NOT NULL DEFAULT 'always',
    "triggerValue" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FollowUpSequence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FollowUpStep" (
    "id" TEXT NOT NULL,
    "sequenceId" TEXT NOT NULL,
    "stepNumber" INTEGER NOT NULL,
    "delayHours" INTEGER NOT NULL,
    "message" TEXT NOT NULL,

    CONSTRAINT "FollowUpStep_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FollowUpJob" (
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

-- CreateTable
CREATE TABLE "QualifyingQuestion" (
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

-- CreateTable
CREATE TABLE "ConversationStateRecord" (
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

-- CreateTable
CREATE TABLE "ConversationMessage" (
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

-- CreateTable
CREATE TABLE "AgentListeningRule" (
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

-- CreateTable
CREATE TABLE "ContactMemory" (
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

-- CreateTable
CREATE TABLE "AgentTrigger" (
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

-- CreateTable
CREATE TABLE "ChannelDeployment" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "config" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChannelDeployment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VapiConfig" (
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

-- CreateTable
CREATE TABLE "CallLog" (
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

-- CreateTable
CREATE TABLE "ScheduledMessage" (
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

-- CreateTable
CREATE TABLE "LeadScore" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeadScore_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MessageBuffer" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "processed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MessageBuffer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Integration" (
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

-- CreateTable
CREATE TABLE "ChatWidget" (
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

-- CreateTable
CREATE TABLE "WidgetVisitor" (
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

-- CreateTable
CREATE TABLE "WidgetConversation" (
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

-- CreateTable
CREATE TABLE "WidgetMessage" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'text',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WidgetMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WidgetVoiceCall" (
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

-- CreateTable
CREATE TABLE "HelpCategory" (
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

-- CreateTable
CREATE TABLE "HelpArticle" (
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

-- CreateTable
CREATE TABLE "SuperAdmin" (
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

-- CreateTable
CREATE TABLE "SystemSetting" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SystemSetting_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "AdminAuditLog" (
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

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Account_provider_providerAccountId_key" ON "Account"("provider", "providerAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "Session_sessionToken_key" ON "Session"("sessionToken");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationToken_token_key" ON "VerificationToken"("token");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationToken_identifier_token_key" ON "VerificationToken"("identifier", "token");

-- CreateIndex
CREATE UNIQUE INDEX "UserLocation_userId_locationId_key" ON "UserLocation"("userId", "locationId");

-- CreateIndex
CREATE UNIQUE INDEX "Workspace_slug_key" ON "Workspace"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Workspace_stripeCustomerId_key" ON "Workspace"("stripeCustomerId");

-- CreateIndex
CREATE UNIQUE INDEX "Workspace_stripeSubscriptionId_key" ON "Workspace"("stripeSubscriptionId");

-- CreateIndex
CREATE INDEX "UsageRecord_workspaceId_billingPeriod_idx" ON "UsageRecord"("workspaceId", "billingPeriod");

-- CreateIndex
CREATE INDEX "UsageRecord_workspaceId_type_createdAt_idx" ON "UsageRecord"("workspaceId", "type", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "WorkspaceMember_userId_workspaceId_key" ON "WorkspaceMember"("userId", "workspaceId");

-- CreateIndex
CREATE INDEX "WorkspaceInvite_email_idx" ON "WorkspaceInvite"("email");

-- CreateIndex
CREATE UNIQUE INDEX "WorkspaceInvite_workspaceId_email_key" ON "WorkspaceInvite"("workspaceId", "email");

-- CreateIndex
CREATE INDEX "Location_companyId_idx" ON "Location"("companyId");

-- CreateIndex
CREATE INDEX "Location_workspaceId_idx" ON "Location"("workspaceId");

-- CreateIndex
CREATE INDEX "Agent_locationId_isActive_idx" ON "Agent"("locationId", "isActive");

-- CreateIndex
CREATE INDEX "Agent_workspaceId_idx" ON "Agent"("workspaceId");

-- CreateIndex
CREATE INDEX "KnowledgeEntry_agentId_idx" ON "KnowledgeEntry"("agentId");

-- CreateIndex
CREATE INDEX "KnowledgeEntry_agentId_status_idx" ON "KnowledgeEntry"("agentId", "status");

-- CreateIndex
CREATE INDEX "CrawlSchedule_agentId_idx" ON "CrawlSchedule"("agentId");

-- CreateIndex
CREATE INDEX "CrawlSchedule_isActive_nextRunAt_idx" ON "CrawlSchedule"("isActive", "nextRunAt");

-- CreateIndex
CREATE INDEX "RoutingRule_agentId_priority_idx" ON "RoutingRule"("agentId", "priority");

-- CreateIndex
CREATE INDEX "AgentRule_agentId_isActive_order_idx" ON "AgentRule"("agentId", "isActive", "order");

-- CreateIndex
CREATE INDEX "MessageLog_locationId_createdAt_idx" ON "MessageLog"("locationId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "MessageLog_agentId_createdAt_idx" ON "MessageLog"("agentId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "MessageLog_needsApproval_approvalStatus_idx" ON "MessageLog"("needsApproval", "approvalStatus");

-- CreateIndex
CREATE INDEX "MessageCorrection_messageLogId_idx" ON "MessageCorrection"("messageLogId");

-- CreateIndex
CREATE INDEX "MessageCorrection_correctedBy_createdAt_idx" ON "MessageCorrection"("correctedBy", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "AgentPromptVersion_agentId_createdAt_idx" ON "AgentPromptVersion"("agentId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "AgentEvaluation_agentId_idx" ON "AgentEvaluation"("agentId");

-- CreateIndex
CREATE INDEX "AgentEvaluationRun_evaluationId_runAt_idx" ON "AgentEvaluationRun"("evaluationId", "runAt" DESC);

-- CreateIndex
CREATE INDEX "AgentGoal_agentId_idx" ON "AgentGoal"("agentId");

-- CreateIndex
CREATE INDEX "AgentGoal_agentId_isPrimary_priority_idx" ON "AgentGoal"("agentId", "isPrimary", "priority");

-- CreateIndex
CREATE INDEX "AgentGoalEvent_goalId_achievedAt_idx" ON "AgentGoalEvent"("goalId", "achievedAt" DESC);

-- CreateIndex
CREATE INDEX "AgentGoalEvent_contactId_idx" ON "AgentGoalEvent"("contactId");

-- CreateIndex
CREATE INDEX "AuditLog_workspaceId_createdAt_idx" ON "AuditLog"("workspaceId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "AuditLog_actorId_createdAt_idx" ON "AuditLog"("actorId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "ContactConsent_workspaceId_status_idx" ON "ContactConsent"("workspaceId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ContactConsent_contactId_channel_workspaceId_key" ON "ContactConsent"("contactId", "channel", "workspaceId");

-- CreateIndex
CREATE INDEX "LiveTakeover_agentId_endedAt_idx" ON "LiveTakeover"("agentId", "endedAt");

-- CreateIndex
CREATE INDEX "LiveTakeover_contactId_endedAt_idx" ON "LiveTakeover"("contactId", "endedAt");

-- CreateIndex
CREATE INDEX "WebhookSubscription_workspaceId_idx" ON "WebhookSubscription"("workspaceId");

-- CreateIndex
CREATE INDEX "WebhookDelivery_subscriptionId_deliveredAt_idx" ON "WebhookDelivery"("subscriptionId", "deliveredAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "AgentTemplate_slug_key" ON "AgentTemplate"("slug");

-- CreateIndex
CREATE INDEX "AgentTemplate_category_idx" ON "AgentTemplate"("category");

-- CreateIndex
CREATE INDEX "AgentTemplate_workspaceId_idx" ON "AgentTemplate"("workspaceId");

-- CreateIndex
CREATE INDEX "NotificationChannel_workspaceId_type_idx" ON "NotificationChannel"("workspaceId", "type");

-- CreateIndex
CREATE INDEX "StopCondition_agentId_idx" ON "StopCondition"("agentId");

-- CreateIndex
CREATE INDEX "FollowUpSequence_agentId_idx" ON "FollowUpSequence"("agentId");

-- CreateIndex
CREATE INDEX "FollowUpStep_sequenceId_stepNumber_idx" ON "FollowUpStep"("sequenceId", "stepNumber");

-- CreateIndex
CREATE INDEX "FollowUpJob_status_scheduledAt_idx" ON "FollowUpJob"("status", "scheduledAt");

-- CreateIndex
CREATE INDEX "FollowUpJob_locationId_contactId_idx" ON "FollowUpJob"("locationId", "contactId");

-- CreateIndex
CREATE INDEX "QualifyingQuestion_agentId_order_idx" ON "QualifyingQuestion"("agentId", "order");

-- CreateIndex
CREATE INDEX "ConversationStateRecord_locationId_state_idx" ON "ConversationStateRecord"("locationId", "state");

-- CreateIndex
CREATE UNIQUE INDEX "ConversationStateRecord_agentId_contactId_key" ON "ConversationStateRecord"("agentId", "contactId");

-- CreateIndex
CREATE INDEX "ConversationMessage_agentId_contactId_createdAt_idx" ON "ConversationMessage"("agentId", "contactId", "createdAt" ASC);

-- CreateIndex
CREATE INDEX "ConversationMessage_conversationId_createdAt_idx" ON "ConversationMessage"("conversationId", "createdAt" ASC);

-- CreateIndex
CREATE INDEX "AgentListeningRule_agentId_isActive_order_idx" ON "AgentListeningRule"("agentId", "isActive", "order");

-- CreateIndex
CREATE UNIQUE INDEX "ContactMemory_agentId_contactId_key" ON "ContactMemory"("agentId", "contactId");

-- CreateIndex
CREATE INDEX "AgentTrigger_agentId_idx" ON "AgentTrigger"("agentId");

-- CreateIndex
CREATE INDEX "AgentTrigger_eventType_isActive_idx" ON "AgentTrigger"("eventType", "isActive");

-- CreateIndex
CREATE INDEX "ChannelDeployment_channel_isActive_idx" ON "ChannelDeployment"("channel", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "ChannelDeployment_agentId_channel_key" ON "ChannelDeployment"("agentId", "channel");

-- CreateIndex
CREATE UNIQUE INDEX "VapiConfig_agentId_key" ON "VapiConfig"("agentId");

-- CreateIndex
CREATE UNIQUE INDEX "CallLog_vapiCallId_key" ON "CallLog"("vapiCallId");

-- CreateIndex
CREATE INDEX "CallLog_locationId_createdAt_idx" ON "CallLog"("locationId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "CallLog_agentId_createdAt_idx" ON "CallLog"("agentId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "ScheduledMessage_status_scheduledAt_idx" ON "ScheduledMessage"("status", "scheduledAt");

-- CreateIndex
CREATE INDEX "ScheduledMessage_locationId_contactId_idx" ON "ScheduledMessage"("locationId", "contactId");

-- CreateIndex
CREATE INDEX "LeadScore_locationId_score_idx" ON "LeadScore"("locationId", "score" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "LeadScore_agentId_contactId_key" ON "LeadScore"("agentId", "contactId");

-- CreateIndex
CREATE INDEX "MessageBuffer_locationId_contactId_processed_createdAt_idx" ON "MessageBuffer"("locationId", "contactId", "processed", "createdAt" ASC);

-- CreateIndex
CREATE INDEX "Integration_locationId_type_idx" ON "Integration"("locationId", "type");

-- CreateIndex
CREATE UNIQUE INDEX "ChatWidget_publicKey_key" ON "ChatWidget"("publicKey");

-- CreateIndex
CREATE INDEX "ChatWidget_workspaceId_idx" ON "ChatWidget"("workspaceId");

-- CreateIndex
CREATE INDEX "WidgetVisitor_widgetId_lastSeenAt_idx" ON "WidgetVisitor"("widgetId", "lastSeenAt");

-- CreateIndex
CREATE UNIQUE INDEX "WidgetVisitor_widgetId_cookieId_key" ON "WidgetVisitor"("widgetId", "cookieId");

-- CreateIndex
CREATE INDEX "WidgetConversation_widgetId_lastMessageAt_idx" ON "WidgetConversation"("widgetId", "lastMessageAt" DESC);

-- CreateIndex
CREATE INDEX "WidgetConversation_visitorId_idx" ON "WidgetConversation"("visitorId");

-- CreateIndex
CREATE INDEX "WidgetConversation_agentId_status_idx" ON "WidgetConversation"("agentId", "status");

-- CreateIndex
CREATE INDEX "WidgetMessage_conversationId_createdAt_idx" ON "WidgetMessage"("conversationId", "createdAt" ASC);

-- CreateIndex
CREATE INDEX "WidgetVoiceCall_conversationId_idx" ON "WidgetVoiceCall"("conversationId");

-- CreateIndex
CREATE UNIQUE INDEX "HelpCategory_slug_key" ON "HelpCategory"("slug");

-- CreateIndex
CREATE INDEX "HelpCategory_order_idx" ON "HelpCategory"("order");

-- CreateIndex
CREATE UNIQUE INDEX "HelpArticle_slug_key" ON "HelpArticle"("slug");

-- CreateIndex
CREATE INDEX "HelpArticle_categoryId_order_idx" ON "HelpArticle"("categoryId", "order");

-- CreateIndex
CREATE INDEX "HelpArticle_status_publishedAt_idx" ON "HelpArticle"("status", "publishedAt");

-- CreateIndex
CREATE UNIQUE INDEX "SuperAdmin_email_key" ON "SuperAdmin"("email");

-- CreateIndex
CREATE INDEX "SuperAdmin_email_idx" ON "SuperAdmin"("email");

-- CreateIndex
CREATE INDEX "AdminAuditLog_adminId_createdAt_idx" ON "AdminAuditLog"("adminId", "createdAt");

-- CreateIndex
CREATE INDEX "AdminAuditLog_action_createdAt_idx" ON "AdminAuditLog"("action", "createdAt");

-- CreateIndex
CREATE INDEX "AdminAuditLog_createdAt_idx" ON "AdminAuditLog"("createdAt");

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserLocation" ADD CONSTRAINT "UserLocation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserLocation" ADD CONSTRAINT "UserLocation_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UsageRecord" ADD CONSTRAINT "UsageRecord_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkspaceMember" ADD CONSTRAINT "WorkspaceMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkspaceMember" ADD CONSTRAINT "WorkspaceMember_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkspaceInvite" ADD CONSTRAINT "WorkspaceInvite_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Location" ADD CONSTRAINT "Location_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Agent" ADD CONSTRAINT "Agent_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Agent" ADD CONSTRAINT "Agent_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeEntry" ADD CONSTRAINT "KnowledgeEntry_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoutingRule" ADD CONSTRAINT "RoutingRule_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentRule" ADD CONSTRAINT "AgentRule_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MessageLog" ADD CONSTRAINT "MessageLog_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MessageLog" ADD CONSTRAINT "MessageLog_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MessageCorrection" ADD CONSTRAINT "MessageCorrection_messageLogId_fkey" FOREIGN KEY ("messageLogId") REFERENCES "MessageLog"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentEvaluationRun" ADD CONSTRAINT "AgentEvaluationRun_evaluationId_fkey" FOREIGN KEY ("evaluationId") REFERENCES "AgentEvaluation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentGoalEvent" ADD CONSTRAINT "AgentGoalEvent_goalId_fkey" FOREIGN KEY ("goalId") REFERENCES "AgentGoal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebhookDelivery" ADD CONSTRAINT "WebhookDelivery_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "WebhookSubscription"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentTemplate" ADD CONSTRAINT "AgentTemplate_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StopCondition" ADD CONSTRAINT "StopCondition_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FollowUpSequence" ADD CONSTRAINT "FollowUpSequence_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FollowUpStep" ADD CONSTRAINT "FollowUpStep_sequenceId_fkey" FOREIGN KEY ("sequenceId") REFERENCES "FollowUpSequence"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FollowUpJob" ADD CONSTRAINT "FollowUpJob_sequenceId_fkey" FOREIGN KEY ("sequenceId") REFERENCES "FollowUpSequence"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QualifyingQuestion" ADD CONSTRAINT "QualifyingQuestion_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConversationStateRecord" ADD CONSTRAINT "ConversationStateRecord_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConversationMessage" ADD CONSTRAINT "ConversationMessage_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentListeningRule" ADD CONSTRAINT "AgentListeningRule_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContactMemory" ADD CONSTRAINT "ContactMemory_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentTrigger" ADD CONSTRAINT "AgentTrigger_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChannelDeployment" ADD CONSTRAINT "ChannelDeployment_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VapiConfig" ADD CONSTRAINT "VapiConfig_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WidgetVisitor" ADD CONSTRAINT "WidgetVisitor_widgetId_fkey" FOREIGN KEY ("widgetId") REFERENCES "ChatWidget"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WidgetConversation" ADD CONSTRAINT "WidgetConversation_widgetId_fkey" FOREIGN KEY ("widgetId") REFERENCES "ChatWidget"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WidgetConversation" ADD CONSTRAINT "WidgetConversation_visitorId_fkey" FOREIGN KEY ("visitorId") REFERENCES "WidgetVisitor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WidgetMessage" ADD CONSTRAINT "WidgetMessage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "WidgetConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WidgetVoiceCall" ADD CONSTRAINT "WidgetVoiceCall_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "WidgetConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HelpArticle" ADD CONSTRAINT "HelpArticle_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "HelpCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdminAuditLog" ADD CONSTRAINT "AdminAuditLog_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "SuperAdmin"("id") ON DELETE SET NULL ON UPDATE CASCADE;

