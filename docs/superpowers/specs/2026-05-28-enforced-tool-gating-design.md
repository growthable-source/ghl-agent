# Enforced Tool Gating for High-Stakes Tools (Phase B3)

**Status:** Approved (consolidated design, executing immediately)
**Date:** 2026-05-28
**Predecessor:** Phase B1 — Per-Tool Config Core

## Goal

For high-stakes tools (booking, marking opportunities won/lost, sending email, creating Shopify checkouts, etc.), don't trust the structured prompt-injection alone. Before dispatching the tool call, run a small LLM gate that evaluates "does the conversation satisfy the rule for this tool?" If NO, block the call and return a synthetic "rule not satisfied" result to the model.

This is the Hybrid mode's "enforced" half (Ryan picked C — Hybrid — at the very start of this thread).

## Decisions (locked)

| Decision | Choice | Why |
|---|---|---|
| Which tools are enforced | Per-tool `enforcement: 'structured' \| 'enforced'` field in `AGENT_TOOLS` (catalog) | Inherent property of the tool, not per-agent config. Same tool always enforces or doesn't. |
| Default enforcement | `'structured'` (prompt-injection only) | Most tools don't need the extra latency. |
| Tools flagged enforced at ship | `book_appointment`, `mark_opportunity_won`, `mark_opportunity_lost`, `create_shopify_checkout`, `create_shopify_discount`, `send_email` | Money/calendar/external-comm changes — the costly mistakes. |
| Gate model | **Haiku** (claude-haiku-4-5) via `claude-haiku-4-5-20250929` model id | Cheap (~$0.001/check), fast (~300ms p50). Same provider, no new auth. |
| Gate prompt | Compact: conversation summary + tool name + rule + tool input → YES/NO + one-line reason | Small surface to abuse. |
| When gate is SKIPPED | (a) `Agent.toolAutonomyMode = 'autonomous'`, OR (b) resolved `useWhen` is empty | Autonomy bypasses rules entirely. Empty rule = no rule to enforce. |
| Block behaviour | Return `{ success: false, blocked: true, reason }` to the model — tool not executed | Model can recover (try a different approach, ask the contact a clarifying question, etc.). |
| Logging | New `ToolGateDecision` table for every enforced call — agentId, toolName, decision, reason, latency, model, tokens | Phase 4+ analytics, debugging, audit. |

## Schema change

```prisma
model ToolGateDecision {
  id           String   @id @default(cuid())
  agentId      String
  agent        Agent    @relation(fields: [agentId], references: [id], onDelete: Cascade)
  conversationId String? // null in sandbox
  contactId    String?
  toolName     String
  decision     String   // 'allowed' | 'blocked'
  reason       String?  // gate's one-line explanation
  latencyMs    Int
  inputTokens  Int?
  outputTokens Int?
  createdAt    DateTime @default(now())
  
  @@index([agentId, createdAt])
  @@index([toolName, decision])
}
```

SQL:
```sql
CREATE TABLE IF NOT EXISTS "ToolGateDecision" (
  "id" TEXT NOT NULL,
  "agentId" TEXT NOT NULL,
  "conversationId" TEXT,
  "contactId" TEXT,
  "toolName" TEXT NOT NULL,
  "decision" TEXT NOT NULL,
  "reason" TEXT,
  "latencyMs" INTEGER NOT NULL,
  "inputTokens" INTEGER,
  "outputTokens" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ToolGateDecision_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "ToolGateDecision_agentId_createdAt_idx"
  ON "ToolGateDecision"("agentId", "createdAt");
CREATE INDEX IF NOT EXISTS "ToolGateDecision_toolName_decision_idx"
  ON "ToolGateDecision"("toolName", "decision");
DO $$ BEGIN
  ALTER TABLE "ToolGateDecision"
    ADD CONSTRAINT "ToolGateDecision_agentId_fkey"
    FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
```

## Catalog change

Extend `AgentToolDef`:
```ts
interface AgentToolDef {
  // ...existing...
  /** When 'enforced', a Haiku gate evaluates the rule before dispatch. Default 'structured'. */
  enforcement?: 'structured' | 'enforced'
}
```

Flag these 6 tools as `enforcement: 'enforced'`:
- `book_appointment`
- `mark_opportunity_won`
- `mark_opportunity_lost`
- `create_shopify_checkout`
- `create_shopify_discount`
- `send_email`

## Gate logic — `lib/agent/tool-gate.ts`

```ts
interface GateInput {
  agentId: string
  conversationId: string | null
  contactId: string | null
  toolName: string
  useWhen: string
  toolInput: Record<string, unknown>
  recentMessages: Array<{ role: 'user'|'assistant'; content: string }>
}

interface GateDecision {
  allowed: boolean
  reason: string
  latencyMs: number
  inputTokens?: number
  outputTokens?: number
}

export async function runToolGate(input: GateInput): Promise<GateDecision>
```

The gate prompt (system):
```
You are a strict gating layer for a sales/support AI agent. Given a conversation and a proposed tool call, your job is to decide whether the tool's "Use when" rule is satisfied.

Rules:
- If the rule is clearly satisfied → ALLOW.
- If the rule is partially satisfied but key prerequisites are missing → BLOCK.
- If the conversation doesn't provide enough evidence → BLOCK.
- Err toward BLOCK. Wrong actions are more costly than missed actions.

Respond on a single line, in this exact format:
ALLOW: <one-line reason>
or
BLOCK: <one-line reason explaining what's missing>
```

User message:
```
Tool: book_appointment
Rule: <resolved useWhen>
Tool input: <JSON.stringify(toolInput)>

Recent conversation (last 10 turns):
<formatted recent messages>

Decision?
```

Model: `claude-haiku-4-5-20250929` (Haiku-class, cheapest currently usable). Max tokens: 100 (the response is one line). Timeout: 5s — if the gate times out, **fail-open** (allow with a logged warning). Don't punish the user for our gate being slow.

## Runtime integration

In `lib/agent/execute-tool.ts`, at the top of the tool-execution switch (BEFORE the case dispatch), for each call:

1. Resolve the tool's enforcement mode from the catalog.
2. If `'structured'` → no gate; existing behaviour.
3. If `'enforced'`:
   - Look up `resolvedToolConfig` (the runtime already has `resolvedToolConfigs` Map from B1 — plumb it through `executeTool`)
   - If `agentAutonomyMode === 'autonomous'` OR resolved `useWhen` is empty → skip gate (log `decision: 'allowed', reason: 'autonomous or empty rule'`)
   - Else → call `runToolGate(...)` with the recent conversation
   - Persist a `ToolGateDecision` row regardless of decision (fire-and-forget)
   - If blocked → return `JSON.stringify({ success: false, blocked: true, reason: '<gate reason>', hint: 'The current conversation does not satisfy the rule for this tool. Continue the conversation to gather what is missing before retrying.' })` to the model
   - If allowed → proceed with the existing tool dispatch

To get the recent conversation into `executeTool`, plumb `messageHistory` from `runAgent` (it already has it).

Sandbox runs skip the gate entirely (they're for testing prompts, not gating).

## Verification

1. Configure an agent with `book_appointment.useWhen = 'Only after the contact has picked a specific slot from get_available_slots'`. Send an inbound asking generally about times. The model tries `book_appointment` directly (without calling slots first) → gate BLOCKS → model receives the structured blocked response → model recovers by calling `get_available_slots` first or asking the contact for a preference.

2. Same agent, after the contact picks a slot. Model calls `book_appointment` → gate ALLOWS → tool runs.

3. Flip agent to `autonomous` → gate skipped → tool runs without the LLM check.

4. With `useWhen` empty (set explicitly to '') → gate skipped → tool runs.

5. Sandbox conversation in playground → gate skipped.

6. `ToolGateDecision` table populated with one row per enforced call. Confirm latency + token counts captured.

7. Gate timeout (mock by setting an impossible timeout) → fail-open + warning logged.

## Out of scope

- Per-workspace "force enforced for X tool" overrides — yes/no, future
- Multi-step gate (e.g. classifier + LLM) — single LLM call for V1
- Streaming the gate response — irrelevant for a one-line reply
- Caching gate decisions across turns — same conversation can change state quickly; cache adds bugs
