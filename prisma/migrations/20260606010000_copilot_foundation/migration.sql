-- Real-time screen-share Co-Pilot — foundation schema (v0 PR 1).
--
-- See /Users/ryan/Downloads/vox-ai-realtime-copilot-spec.md (Appendix A).
-- Translated from the spec's brand_id-tenanted shape to our codebase's
-- workspaceId tenancy + application-layer scoping (no RLS).
--
-- All idempotent. Safe to re-run.

-- ─── CopilotSession ───────────────────────────────────────────────
-- One row per live co-pilot session. Status tracks the lifecycle the
-- session API and webhook flip between (active → ended | error).
-- `channel` enum leaves the recall_meeting_bot seam open without
-- building into it (spec §9, P2). `model` records which RealtimeModel
-- Provider actually answered the session (gemini-live | gpt-realtime).
-- Cost telemetry columns let us query unit cost per session from day
-- one without scrambling later (spec §8).
CREATE TABLE IF NOT EXISTS "CopilotSession" (
  "id"             TEXT NOT NULL,
  "workspaceId"    TEXT NOT NULL,
  "startedByUserId" TEXT,
  "channel"        TEXT NOT NULL DEFAULT 'in_app_webrtc',
  "status"         TEXT NOT NULL DEFAULT 'active',
  "model"          TEXT,
  "roomId"         TEXT,
  "locale"         TEXT NOT NULL DEFAULT 'en-AU',
  "workflowKey"    TEXT,
  "startedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "endedAt"        TIMESTAMP(3),
  "durationSecs"   INTEGER,
  "endedReason"    TEXT,
  -- cost telemetry (spec §8)
  "audioInSecs"    DECIMAL(10,2) NOT NULL DEFAULT 0,
  "audioOutSecs"   DECIMAL(10,2) NOT NULL DEFAULT 0,
  "videoFrames"    INTEGER NOT NULL DEFAULT 0,
  "toolCallCount"  INTEGER NOT NULL DEFAULT 0,
  "metadata"       JSONB NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT "CopilotSession_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "CopilotSession_workspaceId_startedAt_idx"
  ON "CopilotSession"("workspaceId", "startedAt" DESC);

-- ─── CopilotTranscriptTurn ────────────────────────────────────────
-- Turn-by-turn transcript. role covers all four producers Vapi-style
-- (user | agent | system | tool).
CREATE TABLE IF NOT EXISTS "CopilotTranscriptTurn" (
  "id"          TEXT NOT NULL,
  "sessionId"   TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "role"        TEXT NOT NULL,
  "text"        TEXT,
  "tokens"      INTEGER,
  "ts"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CopilotTranscriptTurn_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CopilotTranscriptTurn_sessionId_fkey"
    FOREIGN KEY ("sessionId") REFERENCES "CopilotSession"("id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "CopilotTranscriptTurn_sessionId_ts_idx"
  ON "CopilotTranscriptTurn"("sessionId", "ts");

-- ─── CopilotScreenEvent ───────────────────────────────────────────
-- Screen-grounding events. Default policy (spec §11) stores ONLY
-- vision summaries + detected context — NOT raw frames. The frameRef
-- column stays NULL unless raw retention is explicitly enabled by env
-- on a per-workspace basis.
CREATE TABLE IF NOT EXISTS "CopilotScreenEvent" (
  "id"              TEXT NOT NULL,
  "sessionId"       TEXT NOT NULL,
  "workspaceId"     TEXT NOT NULL,
  "visionSummary"   TEXT,
  "detectedContext" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "frameRef"        TEXT,
  "ts"              TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CopilotScreenEvent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CopilotScreenEvent_sessionId_fkey"
    FOREIGN KEY ("sessionId") REFERENCES "CopilotSession"("id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "CopilotScreenEvent_sessionId_ts_idx"
  ON "CopilotScreenEvent"("sessionId", "ts");

-- ─── CopilotToolCall ──────────────────────────────────────────────
-- Read-only tool invocations + latency. `isWrite` defaults false; it's
-- the seam for the future write-path (spec §9, P2) — every column
-- needed for confirmation gating is already present so adding that
-- behaviour later requires zero schema migration.
CREATE TABLE IF NOT EXISTS "CopilotToolCall" (
  "id"            TEXT NOT NULL,
  "sessionId"     TEXT NOT NULL,
  "workspaceId"   TEXT NOT NULL,
  "toolName"      TEXT NOT NULL,
  "args"          JSONB NOT NULL DEFAULT '{}'::jsonb,
  "resultSummary" TEXT,
  "isWrite"       BOOLEAN NOT NULL DEFAULT false,
  "confirmedBy"   TEXT,
  "latencyMs"     INTEGER,
  "ts"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CopilotToolCall_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CopilotToolCall_sessionId_fkey"
    FOREIGN KEY ("sessionId") REFERENCES "CopilotSession"("id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "CopilotToolCall_sessionId_ts_idx"
  ON "CopilotToolCall"("sessionId", "ts");

-- ─── CopilotEvalRecord ────────────────────────────────────────────
-- Per-turn and per-session eval signals. Reuses the labelling rubric
-- already in RetrievalEvalResult (helpful | neutral | harmful) so the
-- co-pilot work composes with the existing eval surface rather than
-- standing up a parallel one.
CREATE TABLE IF NOT EXISTS "CopilotEvalRecord" (
  "id"                    TEXT NOT NULL,
  "sessionId"             TEXT NOT NULL,
  "workspaceId"           TEXT NOT NULL,
  "turnId"                TEXT,
  "scope"                 TEXT NOT NULL,
  "groundingFaithfulness" TEXT,
  "taskSuccess"           BOOLEAN,
  "notes"                 TEXT,
  "ts"                    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CopilotEvalRecord_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CopilotEvalRecord_sessionId_fkey"
    FOREIGN KEY ("sessionId") REFERENCES "CopilotSession"("id") ON DELETE CASCADE,
  CONSTRAINT "CopilotEvalRecord_turnId_fkey"
    FOREIGN KEY ("turnId") REFERENCES "CopilotTranscriptTurn"("id") ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS "CopilotEvalRecord_sessionId_idx"
  ON "CopilotEvalRecord"("sessionId");
