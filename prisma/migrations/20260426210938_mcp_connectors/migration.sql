-- MCP connectors: workspace-scoped server registry + per-agent tool attachments
-- Additive — safe on prod.

CREATE TABLE IF NOT EXISTS "McpServer" (
  "id"               TEXT PRIMARY KEY,
  "workspaceId"      TEXT NOT NULL,
  "name"             TEXT NOT NULL,
  "registrySlug"     TEXT,
  "description"      TEXT,
  "iconUrl"          TEXT,
  "transport"        TEXT NOT NULL DEFAULT 'http',
  "url"              TEXT NOT NULL,
  "authType"         TEXT NOT NULL DEFAULT 'bearer',
  "authSecretEnc"    TEXT,
  "headers"          JSONB,
  "isActive"         BOOLEAN NOT NULL DEFAULT TRUE,
  "lastDiscoveredAt" TIMESTAMP,
  "discoveredTools"  JSONB,
  "createdAt"        TIMESTAMP NOT NULL DEFAULT NOW(),
  "updatedAt"        TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS "McpServer_workspaceId_idx" ON "McpServer"("workspaceId");

CREATE TABLE IF NOT EXISTS "AgentMcpTool" (
  "id"                  TEXT PRIMARY KEY,
  "agentId"             TEXT NOT NULL,
  "mcpServerId"         TEXT NOT NULL,
  "toolName"            TEXT NOT NULL,
  "enabled"             BOOLEAN NOT NULL DEFAULT TRUE,
  "whenToUse"           TEXT,
  "mustIncludeKeywords" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "requireApproval"     BOOLEAN NOT NULL DEFAULT FALSE,
  "createdAt"           TIMESTAMP NOT NULL DEFAULT NOW(),
  "updatedAt"           TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT "AgentMcpTool_mcpServerId_fkey" FOREIGN KEY ("mcpServerId") REFERENCES "McpServer"("id") ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "AgentMcpTool_agentId_mcpServerId_toolName_key"
  ON "AgentMcpTool"("agentId", "mcpServerId", "toolName");
CREATE INDEX IF NOT EXISTS "AgentMcpTool_agentId_idx" ON "AgentMcpTool"("agentId");
