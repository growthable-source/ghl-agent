# Agent Presets (B2) Implementation Plan

**Goal:** Pick a preset at agent creation (or post-hoc) → applies sensible defaults to autonomy mode + per-tool config.

**Architecture:** Hard-coded preset registry. One column `Agent.presetId`. Three presets at ship. Apply = upsert AgentToolConfig rows + set Agent.toolAutonomyMode + record Agent.presetId.

**Spec:** `docs/superpowers/specs/2026-05-28-agent-presets-design.md`

---

## File structure

**New:**
- `prisma/migrations-legacy/manual_agent_preset_id.sql`
- `lib/agent/presets.ts` — `AGENT_PRESETS` registry + `applyPreset()` helper
- `lib/agent/presets.test.ts` — preset lookup + delta merge tests
- `app/api/workspaces/[wsId]/agents/[agentId]/tool-config/apply-preset/route.ts` — POST
- `app/api/workspaces/[wsId]/agents/[agentId]/tool-config/presets/route.ts` — GET (list)

**Modified:**
- `prisma/schema.prisma` — `Agent.presetId String?`
- `app/api/workspaces/[wsId]/agents/route.ts` — accept `presetId` on create, apply preset after creation
- `components/dashboard/AgentToolRulesEditor.tsx` — add "Apply preset" button at top
- Agent creation wizard (find: `components/dashboard/CreateAgentWizard.tsx` or similar) — add preset picker

---

## Task 1: Schema

- [ ] Create `prisma/migrations-legacy/manual_agent_preset_id.sql`:

```sql
ALTER TABLE "Agent" ADD COLUMN IF NOT EXISTS "presetId" TEXT;
```

- [ ] Add to `prisma/schema.prisma` in `model Agent`:

```prisma
  presetId String?
```

- [ ] `npx prisma generate`

- [ ] Commit: `schema: Agent.presetId for preset tracking`

---

## Task 2: Preset registry + helper

Create `lib/agent/presets.ts` with the full registry. Three presets, each with a hardcoded tool-delta list.

```ts
/**
 * Hard-coded agent presets. Applied at agent creation (via the wizard) or
 * post-hoc (via the "Apply preset" button on the /tools page). The
 * application writes Agent.toolAutonomyMode + upserts AgentToolConfig rows
 * for the deltas. Tools not listed in a preset are left at catalog defaults.
 *
 * Presets are templates, NOT live links: once applied, agent config is
 * decoupled from the preset definition. Editing this file affects future
 * applications, not existing agents.
 */

import { db } from '@/lib/db'

type OnFailureMode = 'default' | 'transfer_to_human' | 'canned_message' | 'silent_skip'

export interface PresetToolDelta {
  toolName: string
  enabled?: boolean
  useWhen?: string  // overrides catalog default
  onFailure?: OnFailureMode
  onFailureMessage?: string
}

export interface AgentPreset {
  id: string
  label: string
  description: string
  autonomyMode: 'guided' | 'autonomous'
  tools: PresetToolDelta[]
}

export const AGENT_PRESETS: AgentPreset[] = [
  {
    id: 'conversational',
    label: 'Conversational Bot',
    description: 'Answers questions, qualifies, takes notes. Does NOT book, send email, or move money. Calendar + opportunity writes + commerce tools are disabled.',
    autonomyMode: 'guided',
    tools: [
      // Calendar — all off
      { toolName: 'get_available_slots', enabled: false },
      { toolName: 'book_appointment', enabled: false },
      { toolName: 'cancel_appointment', enabled: false },
      { toolName: 'reschedule_appointment', enabled: false },
      { toolName: 'get_calendar_events', enabled: false },
      { toolName: 'create_appointment_note', enabled: false },
      // Email — off (this preset is chat-only)
      { toolName: 'send_email', enabled: false },
      // Opportunity writes — off
      { toolName: 'move_opportunity_stage', enabled: false },
      { toolName: 'mark_opportunity_won', enabled: false },
      { toolName: 'mark_opportunity_lost', enabled: false },
      { toolName: 'upsert_opportunity', enabled: false },
      // Workflows — off (workflow enrolment is too consequential for a chat-only bot)
      { toolName: 'add_to_workflow', enabled: false },
      { toolName: 'remove_from_workflow', enabled: false },
      // Commerce — off
      { toolName: 'search_shopify_products', enabled: false },
      { toolName: 'check_shopify_inventory', enabled: false },
      { toolName: 'lookup_shopify_customer', enabled: false },
      { toolName: 'check_shopify_order_status', enabled: false },
      { toolName: 'create_shopify_checkout', enabled: false },
      { toolName: 'create_shopify_discount', enabled: false },
      { toolName: 'record_back_in_stock_interest', enabled: false },
    ],
  },
  {
    id: 'booking',
    label: 'Booking Bot',
    description: 'Built around scheduling. Calendar tools on with strict defaults ("only after slots picked"). Disables commerce + opportunity writes. Use transfer_to_human when stuck.',
    autonomyMode: 'guided',
    tools: [
      // Calendar — all on, catalog defaults already strict
      // (no explicit deltas needed; tools are enabled by default)
      // Opportunity writes — off
      { toolName: 'move_opportunity_stage', enabled: false },
      { toolName: 'mark_opportunity_won', enabled: false },
      { toolName: 'mark_opportunity_lost', enabled: false },
      { toolName: 'upsert_opportunity', enabled: false },
      // Commerce — off
      { toolName: 'search_shopify_products', enabled: false },
      { toolName: 'check_shopify_inventory', enabled: false },
      { toolName: 'lookup_shopify_customer', enabled: false },
      { toolName: 'check_shopify_order_status', enabled: false },
      { toolName: 'create_shopify_checkout', enabled: false },
      { toolName: 'create_shopify_discount', enabled: false },
      { toolName: 'record_back_in_stock_interest', enabled: false },
      // Email — off by default (booking bots usually live on SMS/WA)
      { toolName: 'send_email', enabled: false },
      // Transfer escalation as a safety net for booking failures
      { toolName: 'book_appointment', onFailure: 'transfer_to_human' },
    ],
  },
  {
    id: 'custom',
    label: 'Custom',
    description: 'No defaults applied. All tools enabled with catalog rules. Start here when you want to configure everything yourself.',
    autonomyMode: 'guided',
    tools: [],
  },
]

export function getPreset(id: string): AgentPreset | null {
  return AGENT_PRESETS.find(p => p.id === id) ?? null
}

/**
 * Apply a preset to an agent. Writes Agent.toolAutonomyMode + Agent.presetId
 * and upserts AgentToolConfig rows for every delta. Tools not in the preset
 * are NOT touched — they keep whatever config they already had (catalog
 * defaults if no row exists).
 *
 * Idempotent: re-applying the same preset produces the same state.
 *
 * Returns the preset that was applied (for caller convenience) or null
 * if the presetId wasn't found.
 */
export async function applyPreset(
  agentId: string,
  presetId: string,
): Promise<AgentPreset | null> {
  const preset = getPreset(presetId)
  if (!preset) return null

  await db.agent.update({
    where: { id: agentId },
    data: {
      toolAutonomyMode: preset.autonomyMode,
      presetId: preset.id,
    } as any,
  })

  for (const delta of preset.tools) {
    const data: any = {}
    if (typeof delta.enabled === 'boolean') data.enabled = delta.enabled
    if (typeof delta.useWhen === 'string') data.useWhen = delta.useWhen
    if (delta.onFailure) data.onFailure = delta.onFailure
    if (delta.onFailureMessage !== undefined) data.onFailureMessage = delta.onFailureMessage
    if (Object.keys(data).length === 0) continue

    await db.agentToolConfig.upsert({
      where: { agentId_toolName: { agentId, toolName: delta.toolName } },
      create: { agentId, toolName: delta.toolName, ...data },
      update: data,
    })
  }

  return preset
}
```

Create `lib/agent/presets.test.ts` with tests covering:
- `getPreset` returns null for unknown id
- Each of the 3 presets exists with correct shape
- Conversational preset has commerce + calendar tools disabled
- Booking preset has commerce disabled but calendar enabled (by absence of delta)
- Custom has no deltas

(8 tests in the same vitest style as B1.)

- [ ] Commit: `presets: registry + applyPreset helper + 8 tests`

---

## Task 3: API endpoints

Create `app/api/workspaces/[wsId]/agents/[agentId]/tool-config/presets/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'
import { AGENT_PRESETS } from '@/lib/agent/presets'

type Params = { params: Promise<{ workspaceId: string; agentId: string }> }

export async function GET(_req: NextRequest, { params }: Params) {
  const { workspaceId, agentId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  const agent = await db.agent.findFirst({
    where: { id: agentId, workspaceId },
    select: { presetId: true } as any,
  })
  if (!agent) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  return NextResponse.json({
    presets: AGENT_PRESETS,
    current: (agent as any).presetId ?? null,
  })
}
```

Create `app/api/workspaces/[wsId]/agents/[agentId]/tool-config/apply-preset/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'
import { applyPreset } from '@/lib/agent/presets'
import { resolveAgentToolConfig } from '@/lib/agent/tool-config'

type Params = { params: Promise<{ workspaceId: string; agentId: string }> }

export async function POST(req: NextRequest, { params }: Params) {
  const { workspaceId, agentId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  const agent = await db.agent.findFirst({
    where: { id: agentId, workspaceId },
    select: { id: true },
  })
  if (!agent) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  const body = await req.json().catch(() => ({})) as { presetId?: string }
  if (typeof body.presetId !== 'string' || body.presetId.length === 0) {
    return NextResponse.json({ error: 'missing_presetId' }, { status: 400 })
  }

  const preset = await applyPreset(agentId, body.presetId)
  if (!preset) {
    return NextResponse.json({ error: 'unknown_preset' }, { status: 400 })
  }

  const resolved = await resolveAgentToolConfig(agentId)
  const updated = await db.agent.findUnique({
    where: { id: agentId },
    select: { toolAutonomyMode: true, presetId: true } as any,
  })
  return NextResponse.json({
    autonomyMode: (updated as any)?.toolAutonomyMode ?? 'guided',
    presetId: (updated as any)?.presetId ?? null,
    tools: Array.from(resolved.values()),
  })
}
```

- [ ] Commit: `tool-config: GET presets + POST apply-preset endpoints`

---

## Task 4: Agent create endpoint accepts presetId

Modify `app/api/workspaces/[workspaceId]/agents/route.ts` POST handler. Find where the new agent is created. After the create, if `body.presetId` is set, call `applyPreset(agent.id, body.presetId)` server-side.

- [ ] Commit: `agents POST: apply preset on create`

---

## Task 5: UI — Apply preset button on /tools page

Modify `components/dashboard/AgentToolRulesEditor.tsx`:
- Add state: `const [presets, setPresets] = useState<AgentPreset[]>([])`, `const [currentPreset, setCurrentPreset] = useState<string | null>(null)`, `const [showApplyDialog, setShowApplyDialog] = useState(false)`
- On mount, fetch from `/api/workspaces/${workspaceId}/agents/${agentId}/tool-config/presets`
- Add an "Apply preset" button next to the Mode section
- Clicking opens a dialog listing each preset with description + a "Confirm: this will overwrite your current customizations" warning
- Confirming POSTs `/apply-preset` then re-loads the editor

- [ ] Commit: `ui: Apply preset button on AgentToolRulesEditor`

---

## Task 6: Wizard preset picker

Find the agent creation wizard:

```bash
grep -rn "presetId\|new agent\|CreateAgent\|/agents/new" components/dashboard/ app/dashboard/[workspaceId]/agents/new/ 2>/dev/null | head -10
```

Add a preset radio-card step (before the existing CRM-pick / config). When the wizard POSTs to create the agent, include `presetId` in the body.

If the wizard already has multiple steps, add as a new step. If it's single-page, add a preset section at the top.

- [ ] Commit: `wizard: preset picker step`

---

## Task 7: Manual verification (Ryan)

Run the SQL block in Supabase, then the 5 verification steps from the spec.
