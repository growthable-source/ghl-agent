# Per-Tool Config Core (B1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** Ship per-tool `enabled` + `useWhen` rule + `onFailure` config per agent, plus an autonomy mode switch. Catalog-baked defaults so fresh agents start strong.

**Architecture:** New `AgentToolConfig` table (lazy rows — empty = catalog default). New `Agent.toolAutonomyMode` column. Tool catalog gets `defaultUseWhen` + `defaultOnFailure` per tool. Runtime injects a "Tool usage rules" section into the system prompt (in `guided` mode) and dispatches `onFailure` choices on tool errors. UI rebuilds `/tools` with a per-tool editor grouped by category, mounted alongside the existing calendar/workflow/MCP sections.

**Tech Stack:** Next.js 16 App Router · Prisma 7 · vitest · existing tool-catalog / ai-agent / execute-tool.

**Spec reference:** `docs/superpowers/specs/2026-05-28-per-tool-config-core-design.md`

---

## File Structure

**New files:**
- `prisma/migrations-legacy/manual_agent_tool_config.sql` — Supabase paste-ready SQL
- `lib/agent/tool-config.ts` — `resolveAgentToolConfig`, `ResolvedToolConfig`, `defaultOnFailureFor`, etc.
- `lib/agent/tool-config.test.ts` — vitest tests for resolution + dispatch
- `lib/agent/tool-categories.ts` — hard-coded grouping `{ category: toolNames[] }`
- `app/api/workspaces/[workspaceId]/agents/[agentId]/tool-config/route.ts` — GET + PATCH
- `app/api/workspaces/[workspaceId]/agents/[agentId]/tool-config/[toolName]/route.ts` — DELETE
- `components/dashboard/AgentToolRulesEditor.tsx` — the per-tool config editor (client component)

**Modified files:**
- `prisma/schema.prisma` — `AgentToolConfig` model, `Agent.toolAutonomyMode`, relation on `Agent`
- `lib/agent/tool-catalog.ts` — add `defaultUseWhen` + `defaultOnFailure` to every entry in `AGENT_TOOLS`
- `lib/ai-agent.ts` — inject "Tool usage rules" block, plumb resolved config into the tool loop
- `lib/agent/execute-tool.ts` — `onFailure` dispatch in `reportToolFailure` + outer catch
- `app/dashboard/[workspaceId]/agents/[agentId]/tools/page.tsx` — mount the editor + keep existing sections
- `app/dashboard/[workspaceId]/agents/[agentId]/layout.tsx` — sidebar label "Reflexes" → "Tools" + NewBadge
- `lib/feature-ship-dates.ts` (or wherever NewBadge registers ship dates) — add 2026-05-29

---

## Task 1: Schema + SQL migration

**Files:**
- Create: `prisma/migrations-legacy/manual_agent_tool_config.sql`
- Modify: `prisma/schema.prisma`

- [ ] **Step 1: Write the SQL migration** (paste-ready for Supabase UI)

Create `prisma/migrations-legacy/manual_agent_tool_config.sql`:

```sql
CREATE TABLE IF NOT EXISTS "AgentToolConfig" (
  "id" TEXT NOT NULL,
  "agentId" TEXT NOT NULL,
  "toolName" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "useWhen" TEXT,
  "onFailure" TEXT NOT NULL DEFAULT 'default',
  "onFailureMessage" TEXT,
  CONSTRAINT "AgentToolConfig_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "AgentToolConfig_agentId_toolName_key"
  ON "AgentToolConfig"("agentId", "toolName");

CREATE INDEX IF NOT EXISTS "AgentToolConfig_agentId_idx"
  ON "AgentToolConfig"("agentId");

DO $$ BEGIN
  ALTER TABLE "AgentToolConfig"
    ADD CONSTRAINT "AgentToolConfig_agentId_fkey"
    FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE "Agent"
  ADD COLUMN IF NOT EXISTS "toolAutonomyMode" TEXT NOT NULL DEFAULT 'guided';
```

- [ ] **Step 2: HUMAN GATE — DO NOT run the SQL.** Ryan runs it himself in the Supabase UI. Leave the file and proceed with the schema edits.

- [ ] **Step 3: Add the Prisma model**

Append to `prisma/schema.prisma`, near the `Agent` model:

```prisma
model AgentToolConfig {
  id                String   @id @default(cuid())
  agentId           String
  agent             Agent    @relation(fields: [agentId], references: [id], onDelete: Cascade)
  toolName          String
  enabled           Boolean  @default(true)
  useWhen           String?
  onFailure         String   @default("default")
  onFailureMessage  String?

  @@unique([agentId, toolName])
  @@index([agentId])
}
```

- [ ] **Step 4: Add the relation on Agent**

Inside the `model Agent {` block, alongside other relation lines (e.g. next to `referenceHealth`):

```prisma
  toolConfigs AgentToolConfig[]
```

- [ ] **Step 5: Add the autonomy column on Agent**

Inside the `model Agent {` block, near other String columns:

```prisma
  /// 'guided' (default) — each tool obeys its 'use when' rule.
  /// 'autonomous' — the agent decides which tools to call freely.
  toolAutonomyMode String @default("guided")
```

- [ ] **Step 6: Regenerate Prisma client**

Run: `npx prisma generate`
Expected: completes without error.

- [ ] **Step 7: Commit**

```bash
git add prisma/migrations-legacy/manual_agent_tool_config.sql prisma/schema.prisma
git commit -m "schema: AgentToolConfig + Agent.toolAutonomyMode"
```

DO NOT push (controller pushes in checkpoints).

---

## Task 2: Tool catalog defaults

**Files:**
- Modify: `lib/agent/tool-catalog.ts`

Each tool in `AGENT_TOOLS` gets two new optional fields: `defaultUseWhen` (string) and `defaultOnFailure` (enum). The strings below are the canonical defaults — DO NOT improvise; copy verbatim.

- [ ] **Step 1: Extend the type**

Find the `AGENT_TOOLS` array. Above it (or in the same file), extend the tool type to include:

```ts
interface AgentToolDef {
  name: string
  description: string
  input_schema: Record<string, unknown>
  /** Default rule shown when the agent's AgentToolConfig.useWhen is null. */
  defaultUseWhen?: string
  /** Default onFailure behaviour for this tool. */
  defaultOnFailure?: 'default' | 'transfer_to_human' | 'canned_message' | 'silent_skip'
}
```

If the array is typed as `Anthropic.Tool[]` directly, switch to `(Anthropic.Tool & { defaultUseWhen?: string; defaultOnFailure?: ... })[]` or define a local extended type. Don't break existing consumers.

- [ ] **Step 2: Add defaults to every tool**

For each tool in `AGENT_TOOLS`, append `defaultUseWhen` and (where non-default) `defaultOnFailure`. The full canonical set:

```ts
// Calendar
'get_available_slots': {
  defaultUseWhen: 'Use when the contact has asked about scheduling, availability, or booking, and you have or can infer a sensible date range (default to the next 14 days). Don\'t call this preemptively before the contact has shown booking intent.',
},
'book_appointment': {
  defaultUseWhen: 'Use ONLY after get_available_slots has returned slots AND the contact has explicitly picked one of those slots. Never book without an explicit pick.',
},
'cancel_appointment': {
  defaultUseWhen: 'Use when the contact has explicitly asked to cancel an appointment AND you have the appointmentId (call get_calendar_events first if needed).',
},
'reschedule_appointment': {
  defaultUseWhen: 'Use when the contact has asked to move an existing appointment AND has picked a new slot from get_available_slots.',
},
'get_calendar_events': {
  defaultUseWhen: 'Use when the contact asks about their upcoming appointments OR when you need to find an appointmentId to cancel / reschedule.',
},
'create_appointment_note': {
  defaultUseWhen: 'Use right after book_appointment succeeds, to log conversational context that would help whoever attends the appointment (qualifying answers, the contact\'s specific ask, anything notable).',
},

// Conversations
'send_reply': {
  defaultUseWhen: 'Use to deliver your response to the contact. Exactly once per turn — never call twice in the same run.',
},
'send_sms': {
  defaultUseWhen: 'Use only when you specifically need SMS delivery (vs the default send_reply on whatever channel the contact wrote in on).',
},
'send_email': {
  defaultUseWhen: 'Use when the contact has asked for something in writing (a quote, a summary, a confirmation) OR when the channel itself is Email.',
},
'transfer_to_human': {
  defaultUseWhen: 'Use when the contact explicitly asks for a human, when they\'re hostile or frustrated and the conversation isn\'t recoverable, or when the request is genuinely outside your scope. Don\'t use for transient tool failures — those have their own recovery.',
},
'list_contact_conversations': {
  defaultUseWhen: 'Use when you need context from prior conversations with this contact — e.g. the contact references "what we talked about last time".',
},
'cancel_scheduled_message': {
  defaultUseWhen: 'Use when the contact responds to something that would invalidate a queued follow-up (e.g. they answered the question we were going to chase).',
},

// CRM Reads
'get_contact_details': {
  defaultUseWhen: 'Use at the start of a conversation to load what we know about the contact (name, email, custom fields, tags). Skip if you already have this turn\'s context.',
},
'find_contact_by_email_or_phone': {
  defaultUseWhen: 'Use when the contact mentions a different email or phone than the one we have, and you need to check whether that\'s a separate record we should merge with.',
},
'search_contacts': {
  defaultUseWhen: 'Use when the contact references another person ("can you also book my husband?") and you need to find that other person\'s record.',
},
'get_opportunities': {
  defaultUseWhen: 'Use when you need to know whether the contact has an open deal, or where they sit in the pipeline.',
},
'list_pipelines': {
  defaultUseWhen: 'Use rarely — only when you need to pick a pipelineId for upsert_opportunity and don\'t already have one.',
},

// CRM Writes
'update_contact_tags': {
  defaultUseWhen: 'Use when you\'ve learned a new persistent fact about the contact that should be tracked (qualification status, interest area, blocker, segment). Don\'t tag transient sentiments.',
},
'remove_contact_tags': {
  defaultUseWhen: 'Use when the contact corrects or contradicts a previously-set tag (e.g. they were tagged "not-ready" but now want to book).',
},
'update_contact_field': {
  defaultUseWhen: 'Use when the contact shares a structured fact (name, email, phone, custom-field value) we should persist. Skip if a detection rule already captures the same field.',
},
'upsert_contact': {
  defaultUseWhen: 'Use only when you\'ve discovered the conversation is actually with a different person than the contact record (e.g. spouse, assistant) and need to create or update a separate record.',
},
'add_contact_note': {
  defaultUseWhen: 'Use to log something a human teammate should see when they next open the contact — qualifying context, an objection, a question we couldn\'t answer.',
},
'update_contact_memory': {
  defaultUseWhen: 'Use to record long-term context the agent itself should remember next conversation (preferences, prior commitments, things that don\'t fit into structured fields).',
},

// Workflows
'add_to_workflow': {
  defaultUseWhen: 'Use only when the contact has explicitly opted into a follow-up sequence (e.g. nurture, drip campaign) you\'ve been authorised to enrol them in.',
},
'remove_from_workflow': {
  defaultUseWhen: 'Use when the contact asks to stop receiving follow-ups OR when their state change (e.g. booked, won) makes the current workflow irrelevant.',
},

// Tasks
'create_task': {
  defaultUseWhen: 'Use when there\'s an explicit human follow-up needed that can\'t be automated — set assignee, dueDate, and clear title.',
},

// Opportunities
'move_opportunity_stage': {
  defaultUseWhen: 'Use when the conversation makes a stage change unambiguous (booked → "demo scheduled", paid → "closed-won"). Don\'t guess.',
},
'mark_opportunity_won': {
  defaultUseWhen: 'Use only when the contact has confirmed purchase / commitment AND payment/signature is captured outside this agent.',
},
'mark_opportunity_lost': {
  defaultUseWhen: 'Use when the contact has explicitly declined OR when they meet a hard-disqualification criterion (e.g. wrong geography, can\'t afford).',
},
'upsert_opportunity': {
  defaultUseWhen: 'Use when the contact mentions a deal/purchase intent we don\'t already have an opportunity record for.',
},

// Commerce (Shopify) — only present when Shopify connected
'search_shopify_products': {
  defaultUseWhen: 'Use when the contact asks about specific products, availability, or to compare options — search before you describe.',
},
'check_shopify_inventory': {
  defaultUseWhen: 'Use right before quoting availability or before create_shopify_checkout to confirm stock.',
},
'lookup_shopify_customer': {
  defaultUseWhen: 'Use at the start of a commerce conversation to load order history + lifetime value.',
},
'check_shopify_order_status': {
  defaultUseWhen: 'Use when the contact asks about an existing order ("where is my package", "did it ship").',
},
'create_shopify_checkout': {
  defaultUseWhen: 'Use when the contact has agreed to buy specific items AND you have the variantIds + quantities. Inventory should be confirmed first.',
},
'create_shopify_discount': {
  defaultUseWhen: 'Use rarely — only when the contact qualifies for a discount you\'ve been authorised to issue (recover an abandoned cart, win-back). Defaults: short expiry, capped value.',
},
'record_back_in_stock_interest': {
  defaultUseWhen: 'Use when the contact wants something out of stock AND consents to being notified when it returns.',
},
```

If a tool name in the catalog doesn't appear in the list above, add a sensible default for it (use the pattern: one-sentence rule, starts with "Use when..."). The default may also be added later — this list is the editorial baseline.

- [ ] **Step 3: Sanity-check**

```bash
npx vitest run lib/agent/tool-catalog.test.ts 2>&1 | tail -10
```

Expected: existing tool-catalog tests still pass. Adding defaults shouldn't break any structural assertions.

- [ ] **Step 4: Commit**

```bash
git add lib/agent/tool-catalog.ts
git commit -m "tool-catalog: defaultUseWhen + defaultOnFailure per tool"
```

---

## Task 3: Resolution helper + categories + tests

**Files:**
- Create: `lib/agent/tool-config.ts`
- Create: `lib/agent/tool-config.test.ts`
- Create: `lib/agent/tool-categories.ts`

- [ ] **Step 1: Write the failing tests**

Create `lib/agent/tool-config.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest'
import { mergeToolConfig, type ResolvedToolConfig } from './tool-config'

describe('mergeToolConfig', () => {
  it('returns catalog defaults when no row exists', () => {
    const result = mergeToolConfig({
      toolName: 'book_appointment',
      row: null,
      catalogDefault: {
        useWhen: 'Use only after slots are picked',
        onFailure: 'default',
      },
    })
    expect(result.enabled).toBe(true)
    expect(result.useWhen).toBe('Use only after slots are picked')
    expect(result.onFailure).toBe('default')
    expect(result.onFailureMessage).toBeNull()
  })

  it('uses row.useWhen when set, falling back to catalog when empty', () => {
    expect(
      mergeToolConfig({
        toolName: 'x',
        row: { enabled: true, useWhen: 'custom rule', onFailure: 'default', onFailureMessage: null },
        catalogDefault: { useWhen: 'catalog rule', onFailure: 'default' },
      }).useWhen,
    ).toBe('custom rule')
  })

  it('treats empty-string useWhen as null (fall back to catalog)', () => {
    expect(
      mergeToolConfig({
        toolName: 'x',
        row: { enabled: true, useWhen: '', onFailure: 'default', onFailureMessage: null },
        catalogDefault: { useWhen: 'catalog rule', onFailure: 'default' },
      }).useWhen,
    ).toBe('catalog rule')
  })

  it('respects explicit enabled=false even when catalog default is enabled', () => {
    expect(
      mergeToolConfig({
        toolName: 'x',
        row: { enabled: false, useWhen: null, onFailure: 'default', onFailureMessage: null },
        catalogDefault: { useWhen: 'catalog', onFailure: 'default' },
      }).enabled,
    ).toBe(false)
  })

  it('uses row.onFailure when set, catalog default otherwise', () => {
    expect(
      mergeToolConfig({
        toolName: 'x',
        row: { enabled: true, useWhen: null, onFailure: 'transfer_to_human', onFailureMessage: null },
        catalogDefault: { useWhen: 'c', onFailure: 'default' },
      }).onFailure,
    ).toBe('transfer_to_human')
  })

  it('preserves onFailureMessage when onFailure is canned_message', () => {
    const r = mergeToolConfig({
      toolName: 'x',
      row: { enabled: true, useWhen: null, onFailure: 'canned_message', onFailureMessage: 'Call us at 555' },
      catalogDefault: { useWhen: 'c', onFailure: 'default' },
    })
    expect(r.onFailure).toBe('canned_message')
    expect(r.onFailureMessage).toBe('Call us at 555')
  })

  it('falls back to "default" onFailure when neither row nor catalog specifies', () => {
    expect(
      mergeToolConfig({
        toolName: 'x',
        row: null,
        catalogDefault: { useWhen: 'c' },
      }).onFailure,
    ).toBe('default')
  })

  it('returns empty useWhen string when neither row nor catalog provides one', () => {
    expect(
      mergeToolConfig({
        toolName: 'x',
        row: null,
        catalogDefault: {},
      }).useWhen,
    ).toBe('')
  })
})
```

- [ ] **Step 2: Run, verify fail**

```bash
npx vitest run lib/agent/tool-config.test.ts 2>&1 | tail -10
```

Expected: FAIL (module not found).

- [ ] **Step 3: Write the helper**

Create `lib/agent/tool-config.ts`:

```ts
/**
 * Resolution layer for AgentToolConfig.
 *
 * The DB stores per-(agent, tool) overrides. The tool catalog stores
 * sensible defaults. This file merges them into a single ResolvedToolConfig
 * the runtime and UI consume. Empty / null overrides fall through to
 * catalog defaults; explicit values win.
 *
 * `resolveAgentToolConfig(agentId)` is the integration entry point — fetches
 * rows from the DB + catalog, returns a Map keyed by tool name.
 *
 * `mergeToolConfig(...)` is the pure logic — easy to unit-test.
 */

import { db } from '@/lib/db'
import { AGENT_TOOLS } from './tool-catalog'

export type OnFailureMode =
  | 'default'
  | 'transfer_to_human'
  | 'canned_message'
  | 'silent_skip'

export interface ResolvedToolConfig {
  toolName: string
  enabled: boolean
  /** Resolved rule. Empty string if neither row nor catalog provides one. */
  useWhen: string
  onFailure: OnFailureMode
  onFailureMessage: string | null
}

interface RowShape {
  enabled: boolean
  useWhen: string | null
  onFailure: string
  onFailureMessage: string | null
}

interface CatalogDefaultShape {
  useWhen?: string
  onFailure?: OnFailureMode
}

export function mergeToolConfig(opts: {
  toolName: string
  row: RowShape | null
  catalogDefault: CatalogDefaultShape
}): ResolvedToolConfig {
  const { toolName, row, catalogDefault } = opts

  const useWhen = (row?.useWhen && row.useWhen.length > 0)
    ? row.useWhen
    : (catalogDefault.useWhen ?? '')

  const onFailureRaw = row?.onFailure ?? catalogDefault.onFailure ?? 'default'
  const onFailure = isOnFailureMode(onFailureRaw) ? onFailureRaw : 'default'

  return {
    toolName,
    enabled: row?.enabled ?? true,
    useWhen,
    onFailure,
    onFailureMessage: row?.onFailureMessage ?? null,
  }
}

function isOnFailureMode(s: string): s is OnFailureMode {
  return s === 'default' || s === 'transfer_to_human' || s === 'canned_message' || s === 'silent_skip'
}

/**
 * DB-integrated resolver. Returns a Map keyed by tool name with every
 * tool in AGENT_TOOLS resolved (defaults applied where no override).
 *
 * Tools not in AGENT_TOOLS are skipped — we don't return resolutions for
 * tools the agent can't physically call.
 */
export async function resolveAgentToolConfig(
  agentId: string,
): Promise<Map<string, ResolvedToolConfig>> {
  const rows = await db.agentToolConfig.findMany({
    where: { agentId },
    select: { toolName: true, enabled: true, useWhen: true, onFailure: true, onFailureMessage: true },
  })
  const rowByName = new Map(rows.map(r => [r.toolName, r]))

  const out = new Map<string, ResolvedToolConfig>()
  for (const tool of AGENT_TOOLS) {
    const t = tool as any
    out.set(
      tool.name,
      mergeToolConfig({
        toolName: tool.name,
        row: rowByName.get(tool.name) ?? null,
        catalogDefault: {
          useWhen: t.defaultUseWhen,
          onFailure: t.defaultOnFailure,
        },
      }),
    )
  }
  return out
}

/**
 * Read-only resolver for a single tool — used by execute-tool's onFailure
 * dispatch, which only needs the one tool that just errored.
 */
export async function resolveOneToolConfig(
  agentId: string,
  toolName: string,
): Promise<ResolvedToolConfig> {
  const row = await db.agentToolConfig.findUnique({
    where: { agentId_toolName: { agentId, toolName } },
    select: { enabled: true, useWhen: true, onFailure: true, onFailureMessage: true },
  })
  const catalogEntry = (AGENT_TOOLS as any[]).find(t => t.name === toolName)
  return mergeToolConfig({
    toolName,
    row,
    catalogDefault: {
      useWhen: catalogEntry?.defaultUseWhen,
      onFailure: catalogEntry?.defaultOnFailure,
    },
  })
}
```

- [ ] **Step 4: Run, verify pass**

```bash
npx vitest run lib/agent/tool-config.test.ts 2>&1 | tail -10
```

Expected: PASS, 8 tests.

- [ ] **Step 5: Create the categories file**

Create `lib/agent/tool-categories.ts`:

```ts
/**
 * Hard-coded grouping of tools into UI sections on the agent /tools page.
 * Tools not in any category are rendered under 'Other' at the bottom.
 *
 * Order of categories drives display order. Order of tools within a
 * category drives display order.
 */

export interface ToolCategory {
  id: string
  label: string
  toolNames: string[]
}

export const TOOL_CATEGORIES: ToolCategory[] = [
  {
    id: 'calendar', label: 'Calendar',
    toolNames: [
      'get_available_slots', 'book_appointment', 'cancel_appointment',
      'reschedule_appointment', 'get_calendar_events', 'create_appointment_note',
    ],
  },
  {
    id: 'conversations', label: 'Conversations',
    toolNames: [
      'send_reply', 'send_sms', 'send_email', 'transfer_to_human',
      'list_contact_conversations', 'cancel_scheduled_message',
    ],
  },
  {
    id: 'crm_reads', label: 'CRM Reads',
    toolNames: [
      'get_contact_details', 'find_contact_by_email_or_phone', 'search_contacts',
      'get_opportunities', 'list_pipelines',
    ],
  },
  {
    id: 'crm_writes', label: 'CRM Writes',
    toolNames: [
      'update_contact_tags', 'remove_contact_tags', 'update_contact_field',
      'upsert_contact', 'add_contact_note', 'update_contact_memory',
    ],
  },
  {
    id: 'workflows', label: 'Workflows',
    toolNames: ['add_to_workflow', 'remove_from_workflow'],
  },
  {
    id: 'tasks', label: 'Tasks',
    toolNames: ['create_task'],
  },
  {
    id: 'opportunities', label: 'Opportunities',
    toolNames: [
      'move_opportunity_stage', 'mark_opportunity_won',
      'mark_opportunity_lost', 'upsert_opportunity',
    ],
  },
  {
    id: 'commerce', label: 'Commerce',
    toolNames: [
      'search_shopify_products', 'check_shopify_inventory', 'lookup_shopify_customer',
      'check_shopify_order_status', 'create_shopify_checkout', 'create_shopify_discount',
      'record_back_in_stock_interest',
    ],
  },
]

export function categoryForTool(toolName: string): string {
  for (const cat of TOOL_CATEGORIES) {
    if (cat.toolNames.includes(toolName)) return cat.id
  }
  return 'other'
}
```

- [ ] **Step 6: Commit**

```bash
git add lib/agent/tool-config.ts lib/agent/tool-config.test.ts lib/agent/tool-categories.ts
git commit -m "tool-config: resolution helper + categories + 8 unit tests"
```

---

## Task 4: GET + PATCH + DELETE API

**Files:**
- Create: `app/api/workspaces/[workspaceId]/agents/[agentId]/tool-config/route.ts`
- Create: `app/api/workspaces/[workspaceId]/agents/[agentId]/tool-config/[toolName]/route.ts`

- [ ] **Step 1: Create the GET + PATCH route**

Create `app/api/workspaces/[workspaceId]/agents/[agentId]/tool-config/route.ts`:

```ts
/**
 * Per-tool config CRUD for one agent. Auth: workspace member.
 *
 * GET returns the merged view (catalog defaults + per-(agent, tool)
 * overrides) for every tool in AGENT_TOOLS, plus the agent's
 * toolAutonomyMode. The UI consumes this directly.
 *
 * PATCH accepts a list of tool deltas — upserts an AgentToolConfig row
 * per tool. Empty-string useWhen is normalised to null (fall back to
 * catalog). Setting onFailure to something other than 'canned_message'
 * clears onFailureMessage to avoid stale strings.
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'
import { resolveAgentToolConfig, type OnFailureMode } from '@/lib/agent/tool-config'

type Params = { params: Promise<{ workspaceId: string; agentId: string }> }

const VALID_ON_FAILURE: OnFailureMode[] = [
  'default', 'transfer_to_human', 'canned_message', 'silent_skip',
]
const VALID_AUTONOMY = ['guided', 'autonomous']

export async function GET(_req: NextRequest, { params }: Params) {
  const { workspaceId, agentId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  const agent = await db.agent.findFirst({
    where: { id: agentId, workspaceId },
    select: { id: true, toolAutonomyMode: true, enabledTools: true },
  })
  if (!agent) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  const resolved = await resolveAgentToolConfig(agentId)
  return NextResponse.json({
    autonomyMode: (agent as any).toolAutonomyMode ?? 'guided',
    enabledTools: agent.enabledTools,
    tools: Array.from(resolved.values()),
  })
}

interface ToolDelta {
  toolName: string
  enabled?: boolean
  useWhen?: string | null
  onFailure?: string
  onFailureMessage?: string | null
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const { workspaceId, agentId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  const agent = await db.agent.findFirst({
    where: { id: agentId, workspaceId },
    select: { id: true },
  })
  if (!agent) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  const body = await req.json().catch(() => ({})) as {
    autonomyMode?: string
    tools?: ToolDelta[]
  }

  // Autonomy mode
  if (typeof body.autonomyMode === 'string') {
    if (!VALID_AUTONOMY.includes(body.autonomyMode)) {
      return NextResponse.json({ error: 'invalid_autonomy_mode' }, { status: 400 })
    }
    await db.agent.update({
      where: { id: agentId },
      data: { toolAutonomyMode: body.autonomyMode } as any,
    })
  }

  // Tool deltas — upsert each row
  if (Array.isArray(body.tools)) {
    for (const delta of body.tools) {
      if (typeof delta.toolName !== 'string' || delta.toolName.length === 0) continue

      // Normalize: empty-string useWhen → null. Clear onFailureMessage when
      // onFailure is not canned_message (caller can still pass it explicitly).
      const useWhen = typeof delta.useWhen === 'string'
        ? (delta.useWhen.length === 0 ? null : delta.useWhen)
        : undefined

      const onFailure = delta.onFailure && VALID_ON_FAILURE.includes(delta.onFailure as OnFailureMode)
        ? delta.onFailure
        : undefined
      const onFailureMessage = delta.onFailureMessage === undefined
        ? undefined
        : (onFailure && onFailure !== 'canned_message' ? null : delta.onFailureMessage)

      const data: any = {}
      if (typeof delta.enabled === 'boolean') data.enabled = delta.enabled
      if (useWhen !== undefined) data.useWhen = useWhen
      if (onFailure !== undefined) data.onFailure = onFailure
      if (onFailureMessage !== undefined) data.onFailureMessage = onFailureMessage

      if (Object.keys(data).length === 0) continue

      await db.agentToolConfig.upsert({
        where: { agentId_toolName: { agentId, toolName: delta.toolName } },
        create: { agentId, toolName: delta.toolName, ...data },
        update: data,
      })
    }
  }

  const resolved = await resolveAgentToolConfig(agentId)
  const updated = await db.agent.findUnique({
    where: { id: agentId },
    select: { toolAutonomyMode: true } as any,
  })
  return NextResponse.json({
    autonomyMode: (updated as any)?.toolAutonomyMode ?? 'guided',
    tools: Array.from(resolved.values()),
  })
}
```

- [ ] **Step 2: Create the DELETE route**

Create `app/api/workspaces/[workspaceId]/agents/[agentId]/tool-config/[toolName]/route.ts`:

```ts
/**
 * Reset one tool's config back to catalog defaults. Deletes the
 * AgentToolConfig row entirely — the runtime falls back to catalog defaults
 * when no row exists.
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'
import { resolveOneToolConfig } from '@/lib/agent/tool-config'

type Params = { params: Promise<{ workspaceId: string; agentId: string; toolName: string }> }

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { workspaceId, agentId, toolName } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  const agent = await db.agent.findFirst({
    where: { id: agentId, workspaceId },
    select: { id: true },
  })
  if (!agent) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  try {
    await db.agentToolConfig.delete({
      where: { agentId_toolName: { agentId, toolName } },
    })
  } catch {
    // Row didn't exist — already at defaults. Idempotent.
  }
  const resolved = await resolveOneToolConfig(agentId, toolName)
  return NextResponse.json({ tool: resolved })
}
```

- [ ] **Step 3: Commit**

```bash
git add app/api/workspaces/
git commit -m "tool-config: GET/PATCH/DELETE API for per-tool config"
```

---

## Task 5: Runtime — system prompt injection + onFailure dispatch

**Files:**
- Modify: `lib/ai-agent.ts`
- Modify: `lib/agent/execute-tool.ts`

This is the highest-blast-radius change — runs on every inbound. Be careful.

- [ ] **Step 1: Resolve tool config + filter tools in `runAgent`**

In `lib/ai-agent.ts`, near where Phase A's reference-health gating runs (find the `// ─── Reference health gating ───` block), AFTER that block add a tool-config resolution block:

```ts
// ─── Per-tool config resolution (Phase B1) ─────────────────────────
// Load merged per-tool config (DB overrides + catalog defaults). Used
// for: (a) injecting the "Tool usage rules" section into the prompt,
// (b) dispatching onFailure when a tool errors at runtime.
let resolvedToolConfigs: Map<string, import('./agent/tool-config').ResolvedToolConfig> = new Map()
let agentAutonomyMode: 'guided' | 'autonomous' = 'guided'
if (!isSandbox && agentId) {
  try {
    const { resolveAgentToolConfig } = await import('./agent/tool-config')
    resolvedToolConfigs = await resolveAgentToolConfig(agentId)
    const agentRow = await db.agent.findUnique({
      where: { id: agentId },
      select: { toolAutonomyMode: true } as any,
    })
    const mode = (agentRow as any)?.toolAutonomyMode
    agentAutonomyMode = mode === 'autonomous' ? 'autonomous' : 'guided'
  } catch (err: any) {
    console.warn(`[Agent] tool-config resolution failed for ${agentId}: ${err?.message}`)
    // Fail-open: empty Map means no overrides, runtime behaves as pre-B1.
  }
}

// Tools explicitly disabled via AgentToolConfig — drop from the model's
// tool list. Composes with Phase A's tool-disable (toolsToHide).
if (resolvedToolConfigs.size > 0) {
  for (const cfg of resolvedToolConfigs.values()) {
    if (!cfg.enabled) toolsToHide.add(cfg.toolName)
  }
}
```

This runs AFTER Phase A's `toolsToHide` is initialized, so we add to that same set. The existing `filteredTools = filteredTools.filter(t => !toolsToHide.has(t.name))` already handles the actual filter — no change needed there.

- [ ] **Step 2: Inject "Tool usage rules" into the system prompt**

In `lib/ai-agent.ts`, find where Phase A's broken-references prompt note is appended to `systemPrompt`. Just after that block, add the tool-rules injection:

```ts
// Inject per-tool "use when" rules — only in guided mode. The agent
// gets one line per ENABLED tool that's still in its tool list (post
// Phase A reference-health filter + Phase B1 enabled flag).
if (agentAutonomyMode === 'guided' && resolvedToolConfigs.size > 0) {
  const enabledToolNames = new Set<string>(
    (Array.isArray(filteredTools) ? filteredTools : []).map((t: any) => t?.name).filter(Boolean),
  )
  const rules: string[] = []
  for (const cfg of resolvedToolConfigs.values()) {
    if (!enabledToolNames.has(cfg.toolName)) continue
    if (!cfg.useWhen) continue
    rules.push(`- ${cfg.toolName}: ${cfg.useWhen}`)
  }
  if (rules.length > 0) {
    systemPrompt += `\n\n## Tool usage rules\n\nYou have the following tools available. Use each ONLY when its rule applies. If a contact's message doesn't match any tool's rule, respond conversationally without calling a tool.\n\n${rules.join('\n')}`
  }
}
```

(The variable names `filteredTools` and `systemPrompt` come from the existing runAgent code — confirm by reading the surrounding lines. If the actual variable for the final tool list is named differently, swap.)

- [ ] **Step 3: Dispatch onFailure in `reportToolFailure`**

In `lib/agent/execute-tool.ts`, find `reportToolFailure`. The `agentId` parameter is already present. Add a config lookup at the top of the function and switch on the resolved `onFailure`:

```ts
async function reportToolFailure(params: {
  // ...existing params...
}) {
  const { tool, message, agentId } = params
  
  // Resolve per-tool config to decide onFailure behaviour. Falls back to
  // 'default' if anything goes wrong (preserves the pre-B1 behaviour).
  let onFailure: 'default' | 'transfer_to_human' | 'canned_message' | 'silent_skip' = 'default'
  let onFailureMessage: string | null = null
  if (agentId) {
    try {
      const { resolveOneToolConfig } = await import('@/lib/agent/tool-config')
      const cfg = await resolveOneToolConfig(agentId, tool)
      onFailure = cfg.onFailure
      onFailureMessage = cfg.onFailureMessage
    } catch (err: any) {
      console.warn(`[reportToolFailure] config resolve failed for ${tool}: ${err?.message}`)
    }
  }
  
  // ...rest of existing function (the inline system note, broken-message
  // classification, pauseConversation call, notify call) WRAPPED in a
  // switch on `onFailure`:
}
```

Then wrap the rest of the function logic in:

```ts
switch (onFailure) {
  case 'silent_skip':
    // Operator opted out of error surfacing for this tool. Don't pause,
    // don't notify, don't broadcast. The catch in executeTool will still
    // return a structured response to the model.
    return
  case 'transfer_to_human': {
    // Skip the AI graceful fallback. Populate handover via the existing
    // handoverCapture-like mechanism if available, otherwise just notify
    // with `human_handover` event.
    if (!workspaceId) return
    try {
      const { notify } = await import('../notifications')
      const { resolveHandoverLink } = await import('../handover-link')
      const link = resolveHandoverLink({
        workspaceId,
        locationId: params.locationId ?? null,
        contactId: params.contactId ?? null,
        conversationId: params.conversationId ?? null,
        channel: params.channel ?? null,
      })
      await notify({
        workspaceId, event: 'human_handover', severity: 'warning',
        title: `Agent escalated — ${tool} failed`,
        body: `Per the agent's tool config, ${tool} failures escalate directly to a human. ${message.slice(0, 180)}`,
        link,
      })
      if (agentId && params.contactId) {
        const { pauseConversation } = await import('../conversation-state')
        await pauseConversation(agentId, params.contactId, `tool_error_transfer:${tool}`)
      }
    } catch (err: any) {
      console.warn('[reportToolFailure transfer_to_human] failed:', err?.message)
    }
    return
  }
  case 'canned_message': {
    // Send the configured message verbatim to the contact, then pause + notify.
    const cannedMsg = onFailureMessage?.trim()
    if (cannedMsg && cannedMsg.length > 0 && params.crm && params.contactId) {
      try {
        await params.crm.sendMessage({
          type: (params.channel || 'SMS') as any,
          contactId: params.contactId,
          conversationProviderId: undefined,
          message: cannedMsg,
        })
      } catch (err: any) {
        console.warn('[reportToolFailure canned_message] send failed:', err?.message)
      }
    }
    if (agentId && params.contactId) {
      try {
        const { pauseConversation } = await import('../conversation-state')
        await pauseConversation(agentId, params.contactId, `tool_error_canned:${tool}`)
      } catch (err: any) {
        console.warn('[reportToolFailure canned_message] pause failed:', err?.message)
      }
    }
    // Still fire the operator notification — they need to know the tool failed.
    // (Fall through to the default notify branch below.)
    // FALL THROUGH intentional: run the default notify so operator gets emailed
  }
  case 'default':
  default: {
    // EXISTING reportToolFailure body — inline system note (widget broadcastSystem),
    // non-transient pause, notify with agent_error.
    // (Move the existing function body here, unchanged.)
  }
}
```

The fall-through from `canned_message` → default lets the operator both get the canned message sent AND receive the standard `agent_error` notification. If implementing literal `switch` fall-through is awkward, refactor to call a `dispatchDefault()` helper from both branches.

- [ ] **Step 4: Plumb conversationId / locationId / channel into `reportToolFailure` params**

If `reportToolFailure` doesn't already receive these (check the existing signature), extend the type to include them. The callers in `execute-tool.ts` (the `get_available_slots` and `book_appointment` catches, plus the outer catch) already have these in scope — pass them through.

- [ ] **Step 5: Run the test suite**

```bash
npx vitest run 2>&1 | tail -10
```

Expected: All existing tests pass (the runtime change shouldn't break unit tests; B1 tests come from Task 3).

- [ ] **Step 6: Commit**

```bash
git add lib/ai-agent.ts lib/agent/execute-tool.ts
git commit -m "runtime: per-tool prompt injection + onFailure dispatch"
```

---

## Task 6: UI rebuild — Tool rules editor

**Files:**
- Create: `components/dashboard/AgentToolRulesEditor.tsx`
- Modify: `app/dashboard/[workspaceId]/agents/[agentId]/tools/page.tsx`
- Modify: `app/dashboard/[workspaceId]/agents/[agentId]/layout.tsx`

- [ ] **Step 1: Create the editor component**

Create `components/dashboard/AgentToolRulesEditor.tsx`:

```tsx
'use client'

import { useEffect, useState } from 'react'
import { TOOL_CATEGORIES } from '@/lib/agent/tool-categories'

type OnFailureMode = 'default' | 'transfer_to_human' | 'canned_message' | 'silent_skip'

interface ResolvedToolConfig {
  toolName: string
  enabled: boolean
  useWhen: string
  onFailure: OnFailureMode
  onFailureMessage: string | null
}

const ON_FAILURE_LABELS: Record<OnFailureMode, string> = {
  default: 'Default — graceful AI fallback + pause + email',
  transfer_to_human: 'Transfer to human (skip AI fallback)',
  canned_message: 'Send canned message + pause',
  silent_skip: 'Silent skip (pretend success, continue)',
}

/**
 * Per-tool config editor for the /tools page. Drives the agent's
 * AgentToolConfig rows + Agent.toolAutonomyMode via the
 * /tool-config endpoint.
 */
export function AgentToolRulesEditor({
  workspaceId,
  agentId,
}: {
  workspaceId: string
  agentId: string
}) {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState<number | null>(null)
  const [autonomyMode, setAutonomyMode] = useState<'guided' | 'autonomous'>('guided')
  const [tools, setTools] = useState<ResolvedToolConfig[]>([])
  const [openCats, setOpenCats] = useState<Record<string, boolean>>({})

  async function load() {
    setLoading(true)
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/agents/${agentId}/tool-config`, { cache: 'no-store' })
      if (!res.ok) return
      const data = await res.json()
      setAutonomyMode(data.autonomyMode ?? 'guided')
      setTools(data.tools ?? [])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void load() }, [workspaceId, agentId])

  function setTool(toolName: string, patch: Partial<ResolvedToolConfig>) {
    setTools(prev => prev.map(t => t.toolName === toolName ? { ...t, ...patch } : t))
  }

  async function saveAll() {
    setSaving(true)
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/agents/${agentId}/tool-config`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          autonomyMode,
          tools: tools.map(t => ({
            toolName: t.toolName,
            enabled: t.enabled,
            useWhen: t.useWhen,
            onFailure: t.onFailure,
            onFailureMessage: t.onFailureMessage,
          })),
        }),
      })
      if (res.ok) {
        setSavedAt(Date.now())
        setTimeout(() => setSavedAt(null), 2500)
      }
    } finally {
      setSaving(false)
    }
  }

  async function resetTool(toolName: string) {
    const res = await fetch(
      `/api/workspaces/${workspaceId}/agents/${agentId}/tool-config/${toolName}`,
      { method: 'DELETE' },
    )
    if (res.ok) await load()
  }

  if (loading) return <div style={{ opacity: 0.6 }}>Loading tool config…</div>

  const toolsByName = new Map(tools.map(t => [t.toolName, t]))

  return (
    <div>
      {/* Autonomy mode toggle */}
      <div style={{ padding: 16, border: '1px solid var(--border, #e5e7eb)', borderRadius: 8, marginBottom: 24 }}>
        <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>Mode</h3>
        <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginTop: 8 }}>
          <input type="radio" name="autonomyMode" value="guided"
            checked={autonomyMode === 'guided'} onChange={() => setAutonomyMode('guided')} />
          <div>
            <strong>Guided</strong> (recommended) — each tool follows its “use when” rule.
          </div>
        </label>
        <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginTop: 8 }}>
          <input type="radio" name="autonomyMode" value="autonomous"
            checked={autonomyMode === 'autonomous'} onChange={() => setAutonomyMode('autonomous')} />
          <div>
            <strong>Autonomous</strong> — the agent decides which tools to call freely. Per-tool rules below are bypassed.
          </div>
        </label>
      </div>

      {/* Per-category tool sections */}
      {TOOL_CATEGORIES.map(cat => {
        const catTools = cat.toolNames
          .map(n => toolsByName.get(n))
          .filter((t): t is ResolvedToolConfig => !!t)
        if (catTools.length === 0) return null

        const isOpen = openCats[cat.id] ?? true
        return (
          <div key={cat.id} style={{ marginBottom: 16, border: '1px solid var(--border, #e5e7eb)', borderRadius: 8 }}>
            <button
              type="button"
              onClick={() => setOpenCats(s => ({ ...s, [cat.id]: !isOpen }))}
              style={{
                width: '100%', padding: 12, textAlign: 'left',
                background: 'var(--bg-subtle, #f9fafb)', border: 'none', borderRadius: 8,
                fontWeight: 600, fontSize: 14, cursor: 'pointer',
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              }}
            >
              <span>{cat.label} <span style={{ opacity: 0.6, fontWeight: 400, fontSize: 12 }}>({catTools.length})</span></span>
              <span>{isOpen ? '▾' : '▸'}</span>
            </button>
            {isOpen && (
              <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 12 }}>
                {catTools.map(t => (
                  <div key={t.toolName} style={{ padding: 12, background: 'var(--bg, #fff)', border: '1px solid var(--border, #e5e7eb)', borderRadius: 6, opacity: autonomyMode === 'autonomous' ? 0.55 : 1 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                      <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontFamily: 'monospace', fontSize: 13 }}>
                        <input type="checkbox" checked={t.enabled}
                          onChange={e => setTool(t.toolName, { enabled: e.target.checked })} />
                        {t.toolName}
                      </label>
                      <button type="button" onClick={() => resetTool(t.toolName)}
                        style={{ fontSize: 11, padding: '2px 8px', border: '1px solid var(--border, #e5e7eb)', borderRadius: 4, background: 'transparent', cursor: 'pointer' }}>
                        Reset to default
                      </button>
                    </div>
                    <label style={{ fontSize: 12, opacity: 0.8 }}>Use this tool when:</label>
                    <textarea
                      value={t.useWhen}
                      onChange={e => setTool(t.toolName, { useWhen: e.target.value })}
                      placeholder="(catalog default applies)"
                      rows={2}
                      style={{ width: '100%', padding: 8, fontSize: 13, border: '1px solid var(--border, #e5e7eb)', borderRadius: 4, marginTop: 4, resize: 'vertical' }}
                    />
                    <label style={{ fontSize: 12, opacity: 0.8, marginTop: 8, display: 'block' }}>On failure:</label>
                    <select value={t.onFailure}
                      onChange={e => setTool(t.toolName, { onFailure: e.target.value as OnFailureMode, onFailureMessage: e.target.value === 'canned_message' ? (t.onFailureMessage ?? '') : null })}
                      style={{ padding: 6, fontSize: 13, border: '1px solid var(--border, #e5e7eb)', borderRadius: 4, marginTop: 4 }}>
                      {(['default', 'transfer_to_human', 'canned_message', 'silent_skip'] as OnFailureMode[]).map(m => (
                        <option key={m} value={m}>{ON_FAILURE_LABELS[m]}</option>
                      ))}
                    </select>
                    {t.onFailure === 'canned_message' && (
                      <>
                        <label style={{ fontSize: 12, opacity: 0.8, marginTop: 8, display: 'block' }}>Canned message:</label>
                        <textarea
                          value={t.onFailureMessage ?? ''}
                          onChange={e => setTool(t.toolName, { onFailureMessage: e.target.value })}
                          rows={2}
                          placeholder="Message sent to the contact when this tool fails."
                          style={{ width: '100%', padding: 8, fontSize: 13, border: '1px solid var(--border, #e5e7eb)', borderRadius: 4, marginTop: 4, resize: 'vertical' }}
                        />
                      </>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )
      })}

      {/* Save bar */}
      <div style={{ position: 'sticky', bottom: 0, padding: 12, background: 'var(--bg, #fff)', borderTop: '1px solid var(--border, #e5e7eb)', display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 12 }}>
        {savedAt && <span style={{ color: 'var(--accent-emerald, #047857)', fontSize: 12 }}>Saved</span>}
        <button type="button" onClick={saveAll} disabled={saving}
          style={{ padding: '8px 16px', background: 'var(--button-bg, #111827)', color: '#fff', border: 'none', borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: saving ? 'wait' : 'pointer' }}>
          {saving ? 'Saving…' : 'Save changes'}
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Mount in the Tools page**

Open `app/dashboard/[workspaceId]/agents/[agentId]/tools/page.tsx`. Add an import:

```tsx
import { AgentToolRulesEditor } from '@/components/dashboard/AgentToolRulesEditor'
```

At the top of the page body (above the existing calendar/workflow/MCP sections), render:

```tsx
<section style={{ marginBottom: 32 }}>
  <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 12 }}>
    Tool rules <span style={{ fontSize: 12, opacity: 0.6, fontWeight: 400 }}>— when each tool runs and what happens if it fails</span>
  </h2>
  <AgentToolRulesEditor workspaceId={workspaceId} agentId={agentId} />
</section>
```

(Where `workspaceId` and `agentId` are already in scope from `useParams()` or similar — match the page's existing pattern.)

The existing calendar/workflow/MCP sections stay BELOW the new section, unchanged.

- [ ] **Step 3: Update the sidebar label**

In `app/dashboard/[workspaceId]/agents/[agentId]/layout.tsx`, find:

```ts
{ key: 'tools', label: 'Reflexes', path: '/tools' },
```

Change to:

```ts
{ key: 'tools', label: 'Tools', path: '/tools' },
```

- [ ] **Step 4: NewBadge registration**

Find the NewBadge ship-dates registry. Possible locations:
```bash
grep -rn "FEATURE_SHIP_DATES\|since=" components/NewBadge.tsx lib/ 2>/dev/null | head -5
```

If a central registry exists, add `2026-05-29` for the `tools` feature. If `NewBadge` reads `since` directly (no registry), just use `<NewBadge since="2026-05-29" />` next to the Tools tab and at the top of the editor page. Match the existing convention.

- [ ] **Step 5: Commit**

```bash
git add components/dashboard/ app/dashboard/
git commit -m "ui: AgentToolRulesEditor + mount on /tools + sidebar relabel + NewBadge"
```

---

## Task 7: Manual verification (Ryan)

- [ ] **Step 1: Run the SQL in Supabase** (paste-block from Task 1 step 1 — already idempotent).

- [ ] **Step 2-12: Run the 12 verification scenarios from the spec** at `docs/superpowers/specs/2026-05-28-per-tool-config-core-design.md` § Verification.

---

## Self-Review

### Spec coverage
- Schema (table + autonomy column) → T1 ✓
- Catalog defaults → T2 ✓
- Resolution helper + categories + tests → T3 ✓
- GET/PATCH/DELETE API → T4 ✓
- Runtime: prompt injection + onFailure → T5 ✓
- UI editor + sidebar relabel + NewBadge → T6 ✓
- Verification plan → T7 ✓

### Placeholder scan
No "TBD"s. Every code block is complete. Default-useWhen strings written verbatim in T2 (not deferred).

### Type consistency
- `OnFailureMode` enum defined once in `tool-config.ts`, imported elsewhere
- `ResolvedToolConfig` exported from `tool-config.ts`, used in API + UI
- `toolAutonomyMode` field name consistent across schema, API, UI

### Risk concentration
T5 is the highest blast radius. Reviewer should pay extra attention to:
- Variable naming alignment with existing `runAgent` code (`filteredTools`, `systemPrompt`)
- The `reportToolFailure` switch — fall-through from `canned_message` to `default` is intentional but easy to break in a refactor
