# Enforced Tool Gating (B3) Implementation Plan

**Goal:** Run a Haiku-class LLM gate before dispatching high-stakes tools. Block the call if the conversation doesn't satisfy the tool's rule.

**Architecture:** Catalog flag `enforcement: 'enforced' | 'structured'`. Six tools flagged enforced. `runToolGate` in `lib/agent/tool-gate.ts` calls Haiku with a strict YES/NO prompt. `ToolGateDecision` table logs every check. `executeTool` checks the gate before dispatch for enforced tools.

**Spec:** `docs/superpowers/specs/2026-05-28-enforced-tool-gating-design.md`

---

## File structure

**New:**
- `prisma/migrations-legacy/manual_tool_gate_decision.sql`
- `lib/agent/tool-gate.ts` — `runToolGate()`, gate prompt, decision parsing
- `lib/agent/tool-gate.test.ts` — pure-logic tests for response parsing (no Anthropic mock)

**Modified:**
- `prisma/schema.prisma` — `ToolGateDecision` model + `Agent.gateDecisions` relation
- `lib/agent/tool-catalog.ts` — add `enforcement: 'enforced'` to 6 tools
- `lib/agent/execute-tool.ts` — gate dispatch before tool execution; plumb `agentAutonomyMode` + `resolvedToolConfigs` + `messageHistory`
- `lib/ai-agent.ts` — pass the new params into `executeTool`

---

## Task 1: Schema

- [ ] Create `prisma/migrations-legacy/manual_tool_gate_decision.sql`:

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

- [ ] Add to `prisma/schema.prisma`:

```prisma
model ToolGateDecision {
  id             String   @id @default(cuid())
  agentId        String
  agent          Agent    @relation(fields: [agentId], references: [id], onDelete: Cascade)
  conversationId String?
  contactId      String?
  toolName       String
  decision       String
  reason         String?
  latencyMs      Int
  inputTokens    Int?
  outputTokens   Int?
  createdAt      DateTime @default(now())

  @@index([agentId, createdAt])
  @@index([toolName, decision])
}
```

Add relation on Agent: `gateDecisions ToolGateDecision[]`.

- [ ] `npx prisma generate`

- [ ] Commit: `schema: ToolGateDecision for enforced tool gating`

---

## Task 2: Catalog enforcement flag

Modify `lib/agent/tool-catalog.ts`. Extend the local `AgentToolDef` type:

```ts
interface AgentToolDef extends Anthropic.Tool {
  defaultUseWhen?: string
  defaultOnFailure?: 'default' | 'transfer_to_human' | 'canned_message' | 'silent_skip'
  /** When 'enforced', a Haiku gate evaluates the rule before dispatch. Default 'structured'. */
  enforcement?: 'structured' | 'enforced'
}
```

Mark these 6 tools `enforcement: 'enforced'`:
- `book_appointment`
- `mark_opportunity_won`
- `mark_opportunity_lost`
- `create_shopify_checkout`
- `create_shopify_discount`
- `send_email`

- [ ] Commit: `tool-catalog: enforcement flag on 6 high-stakes tools`

---

## Task 3: Gate implementation + tests

Create `lib/agent/tool-gate.ts`:

```ts
/**
 * Enforced-tool gate. For tools flagged `enforcement: 'enforced'` in the
 * catalog, runs a small LLM (Haiku) check before dispatch:
 *   "Given this conversation + this rule + this proposed tool input,
 *    does it satisfy the rule?"
 *
 * Returns ALLOW / BLOCK. Fail-open on timeout / error (don't block on our
 * own infrastructure failure). Every call is logged to ToolGateDecision
 * regardless of outcome.
 */

import Anthropic from '@anthropic-ai/sdk'
import { db } from '@/lib/db'

const GATE_MODEL = 'claude-haiku-4-5-20250929'
const GATE_TIMEOUT_MS = 5000
const GATE_MAX_TOKENS = 120

const gateClient = new Anthropic()

export interface GateInput {
  agentId: string
  conversationId: string | null
  contactId: string | null
  toolName: string
  useWhen: string
  toolInput: Record<string, unknown>
  recentMessages: Array<{ role: 'user' | 'assistant'; content: string }>
}

export interface GateDecision {
  allowed: boolean
  reason: string
  latencyMs: number
  inputTokens?: number
  outputTokens?: number
}

const GATE_SYSTEM = `You are a strict gating layer for a sales/support AI agent. Given a conversation and a proposed tool call, decide whether the tool's "Use when" rule is satisfied.

Rules:
- If the rule is CLEARLY satisfied → ALLOW.
- If the rule is PARTIALLY satisfied but key prerequisites are missing → BLOCK.
- If the conversation doesn't provide enough evidence → BLOCK.
- Err toward BLOCK. Wrong actions cost more than missed actions.

Respond on a single line, in EXACTLY one of these formats:
ALLOW: <one-line reason>
BLOCK: <one-line reason explaining what's missing>`

export async function runToolGate(input: GateInput): Promise<GateDecision> {
  const started = Date.now()

  const formattedHistory = input.recentMessages.slice(-10)
    .map(m => `${m.role}: ${m.content.slice(0, 400)}`)
    .join('\n')

  const userMessage = `Tool: ${input.toolName}
Rule: ${input.useWhen}
Tool input: ${JSON.stringify(input.toolInput).slice(0, 800)}

Recent conversation (last 10 turns):
${formattedHistory}

Decision?`

  let allowed = false
  let reason = ''
  let inputTokens: number | undefined
  let outputTokens: number | undefined

  try {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), GATE_TIMEOUT_MS)
    try {
      const res = await gateClient.messages.create(
        {
          model: GATE_MODEL,
          max_tokens: GATE_MAX_TOKENS,
          system: GATE_SYSTEM,
          messages: [{ role: 'user', content: userMessage }],
        },
        { signal: controller.signal as any },
      )
      inputTokens = res.usage.input_tokens
      outputTokens = res.usage.output_tokens
      const text = (res.content[0] as any)?.text ?? ''
      const parsed = parseGateResponse(text)
      allowed = parsed.allowed
      reason = parsed.reason
    } finally {
      clearTimeout(timeoutId)
    }
  } catch (err: any) {
    // FAIL-OPEN: don't block the user on our gate failing.
    console.warn(`[tool-gate] failure for ${input.toolName}, failing open:`, err?.message)
    allowed = true
    reason = `gate_failure: ${err?.message ?? 'unknown'}`
  }

  const latencyMs = Date.now() - started

  // Log decision (fire-and-forget — never let log failure block the agent)
  void db.toolGateDecision.create({
    data: {
      agentId: input.agentId,
      conversationId: input.conversationId,
      contactId: input.contactId,
      toolName: input.toolName,
      decision: allowed ? 'allowed' : 'blocked',
      reason: reason.slice(0, 500),
      latencyMs,
      inputTokens,
      outputTokens,
    },
  }).catch((err: any) => {
    console.warn(`[tool-gate] log failed:`, err?.message)
  })

  return { allowed, reason, latencyMs, inputTokens, outputTokens }
}

/**
 * Parse the Haiku response. Tolerant of leading whitespace + capitalisation
 * variants. Defaults to ALLOW with a "parse_failure" reason — fail-open on
 * unparseable responses too.
 */
export function parseGateResponse(text: string): { allowed: boolean; reason: string } {
  const trimmed = text.trim()
  const upper = trimmed.toUpperCase()
  if (upper.startsWith('BLOCK')) {
    const colonIdx = trimmed.indexOf(':')
    return {
      allowed: false,
      reason: colonIdx >= 0 ? trimmed.slice(colonIdx + 1).trim() : 'no reason given',
    }
  }
  if (upper.startsWith('ALLOW')) {
    const colonIdx = trimmed.indexOf(':')
    return {
      allowed: true,
      reason: colonIdx >= 0 ? trimmed.slice(colonIdx + 1).trim() : 'allowed',
    }
  }
  // Couldn't parse — fail open
  return { allowed: true, reason: `parse_failure: ${trimmed.slice(0, 100)}` }
}
```

Create `lib/agent/tool-gate.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { parseGateResponse } from './tool-gate'

describe('parseGateResponse', () => {
  it('parses an ALLOW response with reason', () => {
    expect(parseGateResponse('ALLOW: Contact picked the 3pm slot.')).toEqual({
      allowed: true,
      reason: 'Contact picked the 3pm slot.',
    })
  })

  it('parses a BLOCK response with reason', () => {
    expect(parseGateResponse('BLOCK: Contact has not picked a specific slot yet.')).toEqual({
      allowed: false,
      reason: 'Contact has not picked a specific slot yet.',
    })
  })

  it('handles leading whitespace and case variants', () => {
    expect(parseGateResponse('  allow: ok').allowed).toBe(true)
    expect(parseGateResponse('\nBLOCK: missing details').allowed).toBe(false)
  })

  it('fails open on unparseable response', () => {
    const r = parseGateResponse('Sure, sounds good!')
    expect(r.allowed).toBe(true)
    expect(r.reason).toMatch(/parse_failure/)
  })

  it('handles ALLOW or BLOCK with no colon', () => {
    expect(parseGateResponse('ALLOW').allowed).toBe(true)
    expect(parseGateResponse('BLOCK').allowed).toBe(false)
  })
})
```

- [ ] Run vitest: `npx vitest run lib/agent/tool-gate.test.ts` → 5 tests pass
- [ ] Commit: `tool-gate: runToolGate + parseGateResponse + 5 tests`

---

## Task 4: Runtime integration

Modify `lib/agent/execute-tool.ts`. At the top of the `executeTool` function (after sandbox short-circuit + adapter resolution), BEFORE the switch on `toolName`:

```ts
// ─── Enforced-tool gate (Phase B3) ──────────────────────────────────
// For tools flagged enforcement:'enforced' in the catalog, run a Haiku
// gate to evaluate the agent's useWhen rule before dispatching. Skips
// when:
//   - sandbox run (gate is for production safety only)
//   - agent is in autonomous mode
//   - resolved useWhen is empty (no rule = nothing to enforce)
// Failure modes: fail-open (allow + log the failure reason).
if (!sandbox && agentId) {
  try {
    const catalogEntry = (AGENT_TOOLS as any[]).find(t => t.name === toolName)
    if (catalogEntry?.enforcement === 'enforced') {
      const { resolveOneToolConfig } = await import('./tool-config')
      const cfg = await resolveOneToolConfig(agentId, toolName)
      
      // Need autonomy mode — quick load. (Could be passed in from runAgent;
      // for now an extra lookup keeps the interface stable.)
      const { db: dbClient } = await import('@/lib/db')
      const agentRow = await dbClient.agent.findUnique({
        where: { id: agentId },
        select: { toolAutonomyMode: true } as any,
      })
      const autonomyMode = (agentRow as any)?.toolAutonomyMode ?? 'guided'
      
      const shouldGate = autonomyMode === 'guided' && cfg.useWhen && cfg.useWhen.length > 0
      
      if (shouldGate) {
        const { runToolGate } = await import('./tool-gate')
        const decision = await runToolGate({
          agentId,
          conversationId: conversationId ?? null,
          contactId: contactId ?? null,
          toolName,
          useWhen: cfg.useWhen,
          toolInput: input,
          recentMessages: messageHistory ?? [],
        })
        if (!decision.allowed) {
          return JSON.stringify({
            success: false,
            blocked: true,
            reason: decision.reason,
            hint: 'The current conversation does not satisfy the rule for this tool. Continue the conversation to gather what is missing before retrying, or use a different tool that does match the situation.',
          })
        }
      }
    }
  } catch (err: any) {
    // Fail-open: gating failure shouldn't break agent runtime
    console.warn(`[executeTool] gate dispatch failed for ${toolName}, falling open:`, err?.message)
  }
}
```

For this to work, `executeTool` needs `messageHistory` plumbed in. Add a new optional param `messageHistory?: Array<{ role: 'user'|'assistant'; content: string }>` to the function signature and update the call site in `lib/ai-agent.ts` to pass the existing `messageHistory` variable.

Also import `AGENT_TOOLS` at the top of `execute-tool.ts` if not already imported (look for existing import; if missing add `import { AGENT_TOOLS } from './tool-catalog'`).

- [ ] Run vitest: existing tests still pass (gate is skipped in sandbox).
- [ ] Commit: `execute-tool: gate dispatch for enforced tools before execution`

---

## Task 5: Manual verification (Ryan)

Run the SQL block in Supabase, then the 7 verification steps from the spec.
