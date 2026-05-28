# Per-Tool Config Core (Phase B1)

**Status:** Approved design, ready for implementation plan
**Date:** 2026-05-28
**Author:** Ryan + Claude
**Phase:** B1 of a 3-phase agent-control redesign (B1: per-tool config core · B2: agent presets · B3: enforced LLM gating)
**Predecessor phase:** Phase A — Connection Health Checks (shipped 2026-05-28)

## Context

Phase A made agents fail loudly when their CRM references break. Phase B makes agents **deliberate** about which tools they call and when. Today every agent has the same blanket "you have these 30 tools, use them when appropriate" — the model decides. Ryan's framing from the kick-off:

> "for each tool, there should be a tickbox/switch that says 'use this tool when' and then underneath that tool, just like how we tell it what channel conditions to use and run on, we give it the plain english version of when to use the tool... have the prompt filled in with something meaningful that would work by default, but they overwrite it."

Plus an autonomy escape hatch ("give the agent full autonomy on which tools it uses should be a switch") for operators who don't want per-tool conditioning.

B1 ships the foundation: schema + UI + runtime injection + on-failure dispatch + autonomy toggle. B2 (presets) and B3 (enforced LLM gating for high-stakes tools) layer on top.

## Goals

- Every tool has a per-agent enable/disable flag and a plain-English "use when" rule
- Every tool has an `onFailure` behaviour (default / transfer-to-human / canned message / silent skip)
- Sensible defaults ship with the codebase so a fresh agent has strong guard-rails out of the box
- Operators can switch a whole agent to "autonomous mode" (bypass the rules) with one toggle
- Lazy row creation — empty AgentToolConfig row = catalog default applies; no backfill needed

## Non-goals (deferred to B2 / B3)

- **Agent presets** ("Booking Bot" / "Conversational Bot" templates that fill the config) — B2
- **Enforced LLM gating** for high-stakes tools (pre-tool LLM check that blocks the call when the rule isn't satisfied) — B3
- **Per-tool analytics** (which conditions fire most, which fail) — future
- **Migrating away from `Agent.enabledTools String[]`** — kept; the new `AgentToolConfig.enabled` is an additional gate (both must be true for the tool to fire)

## Architecture decisions (from brainstorming)

| Decision | Choice | Why |
|---|---|---|
| Storage model | **New `AgentToolConfig` table**, one row per (agent, tool) | Consistent with Phase A's `AgentReferenceHealth` pattern. Faster + cacheable on hot path vs JSON. Analytics-ready. |
| `onFailure` options | **4 values**: `default`, `transfer_to_human`, `canned_message`, `silent_skip` | Covers the realistic operator scripts without over-specifying. `retry_with_backoff` belongs in the adapter, not user config. |
| Defaults | **Catalog-baked** — each tool ships with a `defaultUseWhen` string | Fresh agents get strong guard-rails immediately. Override-only model: empty `useWhen` on the row = falls back to catalog. |
| UI placement | **Existing `/tools` page**, tab label renamed from "Reflexes" → **"Tools"** | URL stable, parent "Skills" hub unchanged. Folds existing calendar/workflow/MCP sections in. |
| Row lifecycle | **Lazy** — DELETE on reset, INSERT/UPDATE on customize | No backfill needed. Table stays small. |
| Autonomy switch | **Per-agent** `Agent.toolAutonomyMode: 'guided' \| 'autonomous'` | One toggle bypasses rule injection. `enabled` flags still respected. |

## Schema changes

```prisma
model AgentToolConfig {
  id                String   @id @default(cuid())
  agentId           String
  agent             Agent    @relation(fields: [agentId], references: [id], onDelete: Cascade)
  toolName          String   // matches AGENT_TOOLS[].name in lib/agent/tool-catalog.ts
  enabled           Boolean  @default(true)
  useWhen           String?  // plain-English condition; null = catalog default applies
  onFailure         String   @default("default")
  onFailureMessage  String?
  
  @@unique([agentId, toolName])
  @@index([agentId])
}

model Agent {
  // ...existing...
  toolAutonomyMode  String   @default("guided")
  toolConfigs       AgentToolConfig[]
}
```

### Manual SQL (Supabase UI paste, per `feedback_migration_sql_first`)

Saved to `prisma/migrations-legacy/manual_agent_tool_config.sql`:

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

## Tool catalog defaults

`lib/agent/tool-catalog.ts` already defines `AGENT_TOOLS: Array<{ name, description, input_schema }>`. Extend each entry with two optional fields:

```ts
interface AgentToolDef {
  name: string
  description: string
  input_schema: Record<string, unknown>
  /** Default 'use when' rule injected when the agent's AgentToolConfig.useWhen is null/empty. */
  defaultUseWhen?: string
  /** Default 'onFailure' behaviour. Most tools = 'default'. */
  defaultOnFailure?: 'default' | 'transfer_to_human' | 'canned_message' | 'silent_skip'
}
```

Each tool gets a curated default. Examples (these are written by us, not auto-generated):

- `book_appointment`: *"Use ONLY after get_available_slots has returned slots AND the contact has explicitly picked one of those slots. Never book without an explicit pick."*
- `get_available_slots`: *"Use when the contact has asked about scheduling, availability, or booking, and you have or can infer a sensible date range (default to the next 14 days)."*
- `send_reply`: *"Use to deliver the agent's response to the contact. Once per turn — never call twice in the same run."*
- `update_contact_tags`: *"Use when you've learned a new persistent fact about the contact that should be tracked (qualification status, interest area, blocker). Don't tag transient sentiments."*
- `transfer_to_human`: *"Use when the contact explicitly asks for a human, when they're hostile or frustrated and the conversation isn't recoverable, or when the request is genuinely outside your scope."*
- ... etc for every tool in `AGENT_TOOLS`

The full default-string list is a one-time editorial pass during T2 of the implementation plan.

## Runtime — config resolution

New helper at `lib/agent/tool-config.ts`:

```ts
export interface ResolvedToolConfig {
  toolName: string
  enabled: boolean
  useWhen: string  // never null after resolution — falls back to catalog default
  onFailure: 'default' | 'transfer_to_human' | 'canned_message' | 'silent_skip'
  onFailureMessage: string | null
}

export async function resolveAgentToolConfig(agentId: string): Promise<Map<string, ResolvedToolConfig>>
```

Reads every `AgentToolConfig` row for the agent + merges with `AGENT_TOOLS` defaults. Returns a Map keyed by tool name. Used by:
- `runAgent` to inject the "Tool usage rules" section + dispatch `onFailure`
- The API route that powers the UI (returns the resolved view for display)

Cached per-agent for the duration of one `runAgent` call (no in-memory cache across requests — Phase A pattern).

## Runtime — system prompt injection

In `runAgent`, after Phase A's broken-reference note (if any) and before `client.messages.create`, append a "Tool usage rules" block when `toolAutonomyMode === 'guided'`:

```
## Tool usage rules

You have the following tools available. Use each only when its rule applies. If a contact's message doesn't match any tool's rule, respond conversationally without calling a tool.

- get_available_slots: <resolved useWhen>
- book_appointment: <resolved useWhen>
- send_reply: <resolved useWhen>
- [...one line per enabled tool in this agent's tool list...]
```

Tools that are dropped by Phase A's tool-disable mode are also omitted from this section (the model never sees them anyway). Tools where `AgentToolConfig.enabled === false` are likewise omitted AND removed from the Anthropic `tools` array.

When `toolAutonomyMode === 'autonomous'`, the section is omitted entirely. Tools still respect their `enabled` flag.

## Runtime — `onFailure` dispatch

When a tool errors, `reportToolFailure` (in `lib/agent/execute-tool.ts`) and the silent-exit branch in `runAgent` switch on the resolved `onFailure` value:

| `onFailure` | Behaviour |
|---|---|
| `default` | Current 2026-05-28 behaviour: graceful contact-facing fallback + pause + email |
| `transfer_to_human` | Skip the AI fallback message. Populate `handoverCapture` with `reason='tool_error:<toolName>'`. Fire `human_handover` notify (existing flow). Conversation pauses for human takeover. |
| `canned_message` | Send `onFailureMessage` to the contact as the next reply. Pause conversation. Fire `agent_error` notify. |
| `silent_skip` | Return `JSON.stringify({ success: true, skipped: true, reason: 'tool_config:silent_skip' })` to the model so it can continue without surfacing the error. No pause, no notify (operator opted into the silent behaviour). |

The choice is per-tool per-agent, resolved via `resolveAgentToolConfig`.

## API

Three endpoints (auth: workspace member via `requireWorkspaceAccess`):

**GET `/api/workspaces/[wsId]/agents/[agentId]/tool-config`**
Returns `{ autonomyMode: 'guided'|'autonomous', tools: ResolvedToolConfig[] }` — merged view (custom overrides + catalog defaults) for every tool in `AGENT_TOOLS`. Used by the UI to render the page.

**PATCH `/api/workspaces/[wsId]/agents/[agentId]/tool-config`**
Body: `{ autonomyMode?, tools?: Array<{ toolName, enabled?, useWhen?, onFailure?, onFailureMessage? }> }`. Upserts per-tool rows. `useWhen: ''` (empty string) is treated as `null` (revert to catalog default). Sets `Agent.toolAutonomyMode` if `autonomyMode` provided. Returns the updated resolved config.

**DELETE `/api/workspaces/[wsId]/agents/[agentId]/tool-config/[toolName]`**
Drops the `AgentToolConfig` row for one tool (resets to catalog default). Used by the "Reset to default" button per tool.

## UI

### `/dashboard/[wsId]/agents/[agentId]/tools` page rebuild

**Page header** — title "Tools" + `<NewBadge since="2026-05-29">` + small description: *"Define when each tool runs and what happens if it fails. Defaults are sensible — override only when you need to."*

**Autonomy mode toggle** (just below header):

```
○ Guided mode   — Each tool follows its 'use when' rule (recommended)
○ Autonomous mode — The agent decides which tools to use freely
```

When `Autonomous mode` is selected, the per-tool config below greys out (still editable, but with a note: *"Rules are bypassed in autonomous mode. Switch back to Guided to enforce them."*).

**Per-tool list, grouped by category, collapsible sections:**

Categories (derived from a hard-coded grouping in the tool catalog — not a new DB concept):
- **Calendar** — get_available_slots, book_appointment, cancel_appointment, reschedule_appointment, get_calendar_events, create_appointment_note
- **Conversations** — send_reply, send_sms, send_email, transfer_to_human, list_contact_conversations, cancel_scheduled_message
- **CRM Reads** — get_contact_details, find_contact_by_email_or_phone, search_contacts, get_opportunities, list_pipelines
- **CRM Writes** — update_contact_tags, remove_contact_tags, update_contact_field, upsert_contact, add_contact_note, update_contact_memory
- **Workflows** — add_to_workflow, remove_from_workflow
- **Tasks** — create_task
- **Opportunities** — move_opportunity_stage, mark_opportunity_won, mark_opportunity_lost, upsert_opportunity
- **Commerce (Shopify)** — search_shopify_products, check_shopify_inventory, lookup_shopify_customer, check_shopify_order_status, create_shopify_checkout, create_shopify_discount, record_back_in_stock_interest

Each tool row:
```
☑ book_appointment                                            [Reset to default]
   Use this tool when:
   [textarea — placeholder shows defaultUseWhen, value editable; empty = catalog default]
   
   On failure:
   [dropdown: Default behaviour | Transfer to human | Send canned message | Silent skip]
   
   ▸ (if canned_message selected)
   Canned message:
   [textarea]
```

**Existing sections that stay on this page** (unchanged in B1):
- Calendar config (`calendarId` picker)
- Workflow picks (which workflows are eligible)
- MCP server attachments

These sit BELOW the per-tool list since they're per-tool *parameters*, not per-tool *rules*.

**Save flow:** `useDirtyForm` + `SaveBar` (matches every other agent sub-page). Single PATCH on save batches all changes.

### Sidebar label change

In `app/dashboard/[workspaceId]/agents/[agentId]/layout.tsx`, change:

```ts
{ key: 'tools', label: 'Reflexes', path: '/tools' },
```

to:

```ts
{ key: 'tools', label: 'Tools', path: '/tools' },
```

`<NewBadge>` next to it.

## Critical files

**New:**
- `prisma/migrations-legacy/manual_agent_tool_config.sql`
- `lib/agent/tool-config.ts` — `resolveAgentToolConfig`, `ResolvedToolConfig` type
- `lib/agent/tool-categories.ts` — hard-coded grouping `{ category: toolNames[] }` for the UI
- `app/api/workspaces/[wsId]/agents/[agentId]/tool-config/route.ts` — GET + PATCH
- `app/api/workspaces/[wsId]/agents/[agentId]/tool-config/[toolName]/route.ts` — DELETE
- `app/dashboard/[workspaceId]/agents/[agentId]/tools/_tool-rules-editor.tsx` — the new editor component (client)
- `lib/agent/tool-config.test.ts` — unit tests for resolution + onFailure dispatch logic

**Modified:**
- `prisma/schema.prisma` — new model + column
- `lib/agent/tool-catalog.ts` — add `defaultUseWhen` + `defaultOnFailure` to every tool in `AGENT_TOOLS`
- `lib/ai-agent.ts` — system prompt injection in `runAgent`
- `lib/agent/execute-tool.ts` — `onFailure` dispatch in `reportToolFailure`
- `app/dashboard/[workspaceId]/agents/[agentId]/tools/page.tsx` — render the new editor + keep existing calendar/workflow/MCP sections
- `app/dashboard/[workspaceId]/agents/[agentId]/layout.tsx` — sidebar label
- `lib/feature-ship-dates.ts` (or equivalent) — register `2026-05-29` for the NEW badge

## Verification

1. **Run SQL in Supabase** (T1 human gate). Confirm `AgentToolConfig` table + `Agent.toolAutonomyMode` column exist.
2. **Fresh agent — defaults**: create a new agent. Open `/tools`. Confirm every tool's "Use when" field is empty but shows the catalog default as placeholder. All toggles ON. All `onFailure` = "Default behaviour". Autonomy mode = Guided.
3. **System prompt injection**: send an inbound to the agent. Check logs for the "Tool usage rules" section appended to the system prompt. Verify it contains one line per enabled tool with the resolved `useWhen`.
4. **Customize a rule**: edit `book_appointment.useWhen` to *"Only after the contact has shared their preferred day AND time"*. Save. Send an inbound asking "can I book?" — agent should ask for the day/time before calling the tool.
5. **Disable a tool**: toggle `update_contact_tags` OFF. Save. Send an inbound that previously would have tagged the contact — confirm no tag write, no error.
6. **Custom onFailure: canned_message**: set `book_appointment.onFailure = canned_message`, message *"Our booking system is briefly down — call us at 555-1234 for now."*. Save. Force a calendar 404 (set bad calendarId). Send a booking inbound — confirm the contact receives the canned message verbatim, conversation pauses, operator gets `agent_error` notify.
7. **Custom onFailure: transfer_to_human**: set `cancel_appointment.onFailure = transfer_to_human`. Force a failure on that tool. Confirm `human_handover` notify fires and the agent doesn't send a graceful AI fallback.
8. **Custom onFailure: silent_skip**: set `update_contact_tags.onFailure = silent_skip`. Force a failure (revoke tags scope). Send an inbound — confirm the model gets a fake-success and the conversation continues uninterrupted. No notification fires.
9. **Autonomous mode**: flip the agent to Autonomous. Send any inbound. Check logs — "Tool usage rules" section absent from the prompt. Model behaves like pre-B1.
10. **Reset to default**: click "Reset to default" on `book_appointment`. Confirm the row is DELETEd from `AgentToolConfig`. Confirm runtime falls back to the catalog default.
11. **Phase A interaction**: trigger Phase A's reference-health on the same agent (bogus calendar). Confirm calendar tools are dropped from both the Anthropic tool list AND from the "Tool usage rules" section (no orphan rules referencing missing tools).
12. **Migration**: confirm existing agents (no AgentToolConfig rows) behave identically to pre-B1 except the autonomy default is `'guided'` and prompts now include the catalog-default rules section.

## Open questions deliberately not resolved here

- Tool category grouping is hard-coded in `lib/agent/tool-categories.ts`. If the catalog grows beyond ~50 tools, this might need a richer structure. Not now.
- Per-tool analytics (which conditions fire, which `onFailure` actions fire most) — useful but B1 only ships the data substrate; querying lands in B2 / future.
- A "Test this rule" button (paste a contact message, see whether the model would call the tool) is great UX but adds an Anthropic call per click — defer.

## Sequencing into B2 / B3

- **B2 (Presets)** consumes the catalog defaults + per-tool config: a preset is `{ autonomyMode, tools: { toolName: partial config } }`. At agent creation, the chosen preset PATCHes the new agent's tool-config in one shot.
- **B3 (Enforced LLM gating)** sits BETWEEN the Anthropic tool-call event and `executeTool`. For tools flagged as high-stakes in the catalog (`enforcementMode: 'enforced'`), an extra LLM check evaluates "does the current conversation satisfy `useWhen`?" — if no, the tool call is blocked and the model receives a "rule not satisfied" tool result instead. Reuses the resolved config from B1.
