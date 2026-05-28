# Visual Workflow Canvas — "Advanced Mode" (Phase Adv)

**Status:** Approved design, Phase 1 implementation in progress
**Date:** 2026-05-28
**Predecessor:** Phases A / B1 / B2 / B3 — agent control rebuild
**Scope:** Full agent workflow (triggers + filters + tools + gates + stop conditions + handover + follow-ups + playbook) as an editable React Flow canvas, surfaced as a per-agent "Advanced view" toggle.

## Context

Power users configuring agents jump across five tab pages today (Identity, Knowledge, Skills, When to run, Activity) plus the nested sub-tabs under each. The mental model — "what does my agent ACTUALLY do end-to-end?" — is split across surfaces. Advanced Mode collapses the agent's full configuration into one canvas: a visual workflow showing every trigger, filter, gate, tool, and endpoint as nodes connected by edges.

The 3-phase agent control work that just shipped (Phase A connection health, B1 per-tool config, B2 presets, B3 enforced gating) gives us the structured data the canvas needs. Each surface is now queryable; the canvas is a rendering + interaction layer on top.

## Architecture decisions (locked from brainstorming)

| Decision | Choice | Why |
|---|---|---|
| Source of truth | **Canvas is a LENS over existing tables** | Existing PATCH endpoints handle every edit. Zero risk to existing tabs/runtime. |
| Toggle scope | **Per-agent** — `Agent.viewMode: 'simple' \| 'advanced'`, default `'simple'` | Simple agents stay simple; toggle isn't fighting the user. |
| Library | **React Flow** | De-facto React node-graph editor, MIT, ~50KB gzipped, gives pan/zoom/edges for free. |
| V1 scope | **V1-C — Full agent workflow** | "Advanced mode" branding demands the complete view. |
| Layout | **Auto-default + manual override** (new `AgentNodeLayout` table) | dagre handles V1, manual drag for power-user control. |
| Edit flow | **Side panel slides in from right** (~400px) | Power-user feel; reuses extracted form components from existing tab pages. |
| Live execution overlay | **Defer to V2** | Static canvas validates the basic UX first. |

## Schema changes

```prisma
model AgentNodeLayout {
  id        String   @id @default(cuid())
  agentId   String
  agent     Agent    @relation(fields: [agentId], references: [id], onDelete: Cascade)
  /// Composite node key — e.g. "tool:book_appointment",
  /// "stop_condition:abc123", "channel:SMS", "trigger:def456".
  /// One row per dragged node; nodes never dragged stay at their
  /// dagre-computed position and have no row.
  nodeKey   String
  x         Float
  y         Float
  updatedAt DateTime @updatedAt

  @@unique([agentId, nodeKey])
  @@index([agentId])
}

model Agent {
  // ...existing...
  /// 'simple' (default — tab IA) | 'advanced' (canvas IA)
  viewMode  String   @default("simple")
}
```

### Manual SQL (Supabase paste, idempotent)

Saved to `prisma/migrations-legacy/manual_agent_node_layout.sql`:

```sql
CREATE TABLE IF NOT EXISTS "AgentNodeLayout" (
  "id" TEXT NOT NULL,
  "agentId" TEXT NOT NULL,
  "nodeKey" TEXT NOT NULL,
  "x" DOUBLE PRECISION NOT NULL,
  "y" DOUBLE PRECISION NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AgentNodeLayout_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "AgentNodeLayout_agentId_nodeKey_key"
  ON "AgentNodeLayout"("agentId", "nodeKey");

CREATE INDEX IF NOT EXISTS "AgentNodeLayout_agentId_idx"
  ON "AgentNodeLayout"("agentId");

DO $$ BEGIN
  ALTER TABLE "AgentNodeLayout"
    ADD CONSTRAINT "AgentNodeLayout_agentId_fkey"
    FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE "Agent"
  ADD COLUMN IF NOT EXISTS "viewMode" TEXT NOT NULL DEFAULT 'simple';
```

## Node taxonomy

| Node type | Shape | Colour | Source table |
|---|---|---|---|
| Channel trigger | Rounded rect, pill | Coral (brand) | `ChannelDeployment` where `isActive=true` |
| CRM event trigger | Rounded rect, pill | Coral | `AgentTrigger` rows |
| Routing rule filter | Diamond | Amber | `RoutingRule` rows |
| Working hours gate | Diamond | Amber | `AgentWorkingHours` if configured |
| Stop condition | Diamond | Purple | `StopCondition` rows |
| Tool | Rounded rect | Blue | `AGENT_TOOLS` × `AgentToolConfig` (enabled only) |
| B3 gate marker | Small inline diamond | Purple | `enforcement: 'enforced'` from catalog |
| onFailure endpoint | Rounded square, terminal | Red | One per distinct `onFailure` mode used |
| Pause endpoint | Rounded square, terminal | Red | Single, when any stop condition can pause |
| Handover endpoint | Rounded square, terminal | Red | Single, when transfer_to_human is enabled |
| Follow-up | Rounded rect, dashed border | Teal | `FollowUpSequence` rows |
| Playbook rule | Rectangle | Green | `Playbook` rows (deterministic if-then) |

Icons from `lucide-react` (already a dep). Colour-coding uses existing CSS var tokens (`--accent-coral`, `--accent-amber`, `--accent-purple`, `--accent-blue`, `--accent-red`, `--accent-emerald`).

## Node key scheme

Composite keys, stable across renders:
- `channel:SMS`, `channel:WhatsApp`, …
- `trigger:<AgentTrigger.id>`
- `routing:<RoutingRule.id>`
- `working_hours:default`
- `stop:<StopCondition.id>`
- `tool:<toolName>`
- `gate:<toolName>` (inline B3 marker)
- `failure:transfer`, `failure:canned`, `failure:silent`, `failure:default`
- `pause`, `handover`
- `followup:<FollowUpSequence.id>`
- `playbook:<Playbook.id>`

These are what `AgentNodeLayout.nodeKey` stores.

## Edge styles

- **Solid grey** (`var(--border)`): default flow
- **Dashed red**: onFailure paths
- **Double purple**: B3-gated edges (gate evaluates between source and dest)
- **Label text**: short condition summary ("tag = qualified", "9am–5pm Mon-Fri", "after slots picked")

## API

### `GET /api/workspaces/[wsId]/agents/[agentId]/flow`

Returns the complete graph for the React Flow renderer.

```ts
interface FlowResponse {
  nodes: Array<{
    id: string         // matches nodeKey
    type: NodeType     // 'channelTrigger' | 'crmTrigger' | 'routingRule' | …
    data: {
      label: string
      sourceId?: string  // FK to underlying row, when applicable
      meta?: Record<string, unknown>
      badges?: Array<{ kind: 'broken' | 'warning'; text: string }>
    }
    position: { x: number; y: number }  // dagre-computed unless overridden in AgentNodeLayout
  }>
  edges: Array<{
    id: string
    source: string  // nodeKey
    target: string  // nodeKey
    type: 'default' | 'onFailure' | 'gated'
    label?: string
    data?: { ruleId?: string }
  }>
  viewMode: 'simple' | 'advanced'
}
```

### `PATCH /api/workspaces/[wsId]/agents/[agentId]/flow/layout`

Body: `{ positions: Array<{ nodeKey, x, y }> }`. Bulk-upserts dragged positions. Debounced 500ms by the canvas.

### `POST /api/workspaces/[wsId]/agents/[agentId]/flow/reset-layout`

Deletes all `AgentNodeLayout` rows for this agent. Next GET returns pure dagre positions.

### `PATCH /api/workspaces/[wsId]/agents/[agentId]` (existing)

Extended to accept `viewMode: 'simple' | 'advanced'`.

### Side-panel saves

Use existing PATCH endpoints (`/tool-config`, `/routing-rules`, etc.). No new CRUD APIs.

## UI surfaces

### Toggle

A `<ViewModeToggle>` button sits in the agent header next to the existing Test / Pause buttons. Reads `Agent.viewMode`, writes via PATCH on click. State persists per agent.

### Canvas layout

```
┌─ Agent header ─────────────────────────────────────────┐
│ ← Agents / [Agent Name]  · Active            [Test] [Pause] [Switch to Simple] │
├────────────────────────────────────────────────────────┤
│ [Toolbar: Reset layout · Validate · Last saved 2s ago] │
├────────────────────────────────────────────────────────┤
│                                                        │
│                                                        │
│           [React Flow canvas with auto-layout]         │
│                                                        │
│                                                        │
├──────────────────────────────────── Side panel ────────┤
│                                  │ [form for selected  │
│                                  │  node, slides in]   │
└────────────────────────────────────────────────────────┘
```

In Advanced mode the existing 5-tab sub-navigation is **hidden** — canvas is the entire agent surface below the header.

### Auto-layout

`dagre` runs top-down on the trigger → terminal path:
- Triggers at left
- Filters mid-left
- Tools middle
- onFailure / pause / handover endpoints right
- Follow-ups and playbook below the main flow as auxiliary swimlanes

Rank separation: 100px. Node separation: 60px. Re-runs on every GET when no `AgentNodeLayout` rows exist; partial overrides preserved for dragged nodes only.

### Drag persistence

React Flow's `onNodeDragStop` fires per drag. Canvas batches positions client-side, debounces 500ms, PATCHes the bulk array. Optimistic update — UI snaps to new position immediately.

### Reset

A "Reset layout" toolbar button calls the POST endpoint and re-fetches. Confirm dialog: "Reset all positions to auto-layout? This can't be undone."

### Side panel

Slides in from the right (~400px wide) when a node is selected. Renders the matching form for the selected node type:

| Node type | Form |
|---|---|
| Tool | Row extracted from `AgentToolRulesEditor` |
| Filter (routing) | Channel-filter clause builder (extracted from `/trigger`) |
| Stop condition | `StopConditionEditor` |
| Working hours | Working-hours form |
| CRM trigger | `CrmEventsEditor` row |
| Channel trigger | Channel deployment toggle |
| Follow-up | Follow-up sequence form |
| Playbook | Playbook rule form |

Save calls the existing PATCH endpoint; on success, canvas refetches GET to pick up the change. Cancel discards. Esc closes the panel.

### Validation badges

Inline corner badges on affected nodes:
- **Red badge** "Reference broken" — when `AgentReferenceHealth.status='broken'` matches this node (broken calendar → calendar tool node)
- **Amber badge** "No rule" — enforced tool with empty `useWhen` (gate will always block)
- **Amber badge** "No condition" — routing rule with empty conditions

Source: existing `AgentReferenceHealth` table + existing `AgentToolConfig.useWhen` field. No new tracking — just surface what we already have.

## Implementation phases

Each phase is an independent ship. Validation between phases.

### Phase 1: Foundation (this ship)

- Schema: `AgentNodeLayout` + `Agent.viewMode`
- GET endpoint with dagre auto-layout
- Read-only React Flow canvas component
- Mount under new `/dashboard/[wsId]/agents/[agentId]/flow` route
- All node types render with correct colour/shape — no badges, no side panel, no toggle yet
- Toolbar with Reset button (works) + Last saved indicator
- npm deps: `reactflow`, `@dagrejs/dagre`

### Phase 2: View mode toggle + IA switch

- `<ViewModeToggle>` button in agent header
- `viewMode` accepted in agent PATCH endpoint
- Layout component reads `Agent.viewMode` and hides the tab sub-nav when `'advanced'`
- `/flow` route active only when `viewMode='advanced'`; simple agents see canvas as a preview link from the header (read-only)

### Phase 3: Drag + persist + reset

- `onNodeDragStop` → debounced PATCH
- POST reset endpoint + confirm dialog
- New-node placement heuristic: new nodes use dagre slot; layout positions for missing keys auto-purged

### Phase 4: Side panel editor

- Extract per-entity form components from existing tab pages, one type at a time:
  1. Tool form (highest traffic, smallest extraction)
  2. Routing rule clause builder
  3. Stop condition form
  4. CRM trigger form
  5. Channel deployment toggle
  6. Working hours form
  7. Follow-up sequence form
  8. Playbook rule form
- Wire each to its existing PATCH endpoint
- Side panel scaffold: slide-in, close on Esc, unsaved-changes confirm

### Phase 5: Validation badges + edge polish

- Corner badge component
- Wire `AgentReferenceHealth` query into GET endpoint
- Wire empty-useWhen / empty-conditions checks
- Edge styling: dashed onFailure, double gated
- Edge labels: shorten + truncate, hover for full
- Layout polish (rank separation tuning, edge routing)

## Files

### Phase 1 (this ship)

**New:**
- `prisma/migrations-legacy/manual_agent_node_layout.sql`
- `lib/agent/flow/build.ts` — `buildAgentFlow(agentId)` — pulls all relations, emits `FlowResponse` shape
- `lib/agent/flow/layout.ts` — dagre wrapper, returns positions
- `lib/agent/flow/types.ts` — shared `FlowNode`, `FlowEdge`, `NodeType` types
- `app/api/workspaces/[workspaceId]/agents/[agentId]/flow/route.ts` — GET
- `app/api/workspaces/[workspaceId]/agents/[agentId]/flow/reset-layout/route.ts` — POST
- `components/dashboard/AgentFlowCanvas.tsx` — React Flow renderer (client component)
- `components/dashboard/flow/node-types.tsx` — custom node components per type
- `app/dashboard/[workspaceId]/agents/[agentId]/flow/page.tsx` — page mount

**Modified:**
- `prisma/schema.prisma` — `AgentNodeLayout` model + relation + `Agent.viewMode`
- `package.json` — `reactflow` + `@dagrejs/dagre`

### Phase 2+ (later)

Tracked in follow-up plans, not this spec.

## Verification (Phase 1)

1. Run the SQL in Supabase, confirm tables exist
2. Visit `/dashboard/[wsId]/agents/[agentId]/flow` on an agent with: 2 channels, 1 routing rule, 1 stop condition, calendar tools enabled, 1 follow-up
3. Confirm all nodes render with correct colours + icons
4. Confirm edges connect trigger → filter → tool → endpoint topology
5. Confirm onFailure endpoints surface for any tool with non-default onFailure
6. Confirm B3 gate diamonds appear inline on enforced tools (book_appointment, etc.)
7. Confirm zoom / pan / fit-view work
8. Click Reset layout — confirm dagre re-positions
9. Reload the page — same layout (deterministic auto-layout for a stable agent)
10. Vitest still passes (Phase 1 ships no new business logic with tests; the canvas is rendering-only)

## Out of scope for Phase 1

- View mode toggle UI (Phase 2)
- Drag-to-save (Phase 3)
- Side-panel editing (Phase 4)
- Validation badges (Phase 5)
- Live execution overlay (V2)

## Risks

- **dagre layout quality at 50-80 nodes**: untested with realistic agent data. Phase 1 ship serves as the first probe. If it's tangled, consider elkjs upgrade in Phase 5.
- **React Flow + Tailwind interaction**: pan/zoom can fight parent overflow rules. Mitigation: `/flow` route gets a dedicated full-bleed layout.
- **Phase-4 form extraction**: existing tab forms are coupled to page state. Budget extraction time generously.

## Next phases live as separate spec/plan cycles

Each of Phase 2 → 5 ships independently with its own validation pass. Phase 1 (this ship) is foundational and standalone — it gives us the visual demo and validates the auto-layout assumption before we commit to the heavier work.
