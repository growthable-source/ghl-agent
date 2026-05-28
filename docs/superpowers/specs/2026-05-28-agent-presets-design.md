# Agent Presets (Phase B2)

**Status:** Approved (consolidated design, executing immediately per "finish all outstanding work")
**Date:** 2026-05-28
**Predecessor:** Phase B1 — Per-Tool Config Core

## Goal

Pick a preset at agent creation (or later) and have it fill in sensible defaults for `Agent.toolAutonomyMode` + every relevant `AgentToolConfig` row in one shot. Templates, not live links — once applied, the agent is decoupled from the preset.

## Decisions (locked, with justifications)

| Decision | Choice | Why |
|---|---|---|
| Storage | **Hard-coded in `lib/agent/presets.ts`** | V1 ships with 3 presets. DB-managed presets are YAGNI until ops actually wants to customize. |
| Presets at ship | **Conversational Bot**, **Booking Bot**, **Custom** (blank) | Covers the two extremes Ryan named + an escape hatch. |
| Apply time | **Creation wizard + post-hoc "Apply preset" button** on /tools page | Greenfield + retrofit covered. Post-hoc overwrite shows a confirm dialog. |
| Relationship | **Template, not link.** Applying = one-time PATCH that writes the deltas. Future preset edits don't reflow into agents that picked it earlier. | Simpler. Matches user expectation. |
| Storage of "which preset was used" | **`Agent.presetId String?`** column — purely informational | Lets the wizard remember the pick + lets us show "Originally configured as Booking Bot" in the UI |

## Preset shape

```ts
interface AgentPreset {
  id: string            // 'conversational' | 'booking' | 'custom'
  label: string         // 'Conversational Bot'
  description: string   // shown in the wizard picker
  autonomyMode: 'guided' | 'autonomous'
  // Tool-by-tool deltas. Each delta is applied as a PATCH to AgentToolConfig.
  // Tools not in `tools` are left at catalog defaults.
  tools: Array<{
    toolName: string
    enabled?: boolean
    useWhen?: string  // overrides catalog default if set
    onFailure?: 'default' | 'transfer_to_human' | 'canned_message' | 'silent_skip'
    onFailureMessage?: string
  }>
}
```

## The three V1 presets

**Conversational Bot** — answers questions, doesn't book or move money. Disables every calendar tool, every opportunity write, every commerce tool. Keeps CRM reads + tags + notes + transfer_to_human. `autonomyMode='guided'`.

**Booking Bot** — calendar is the whole purpose. Enables booking tools with the catalog defaults (already strict — "only after slots picked"). Disables commerce. CRM reads on, writes light. `autonomyMode='guided'`.

**Custom** — no deltas. `autonomyMode='guided'` with catalog defaults across the board. Empty preset; matches today's "fresh agent" experience post-B1.

(Full per-tool delta lists are in the implementation plan.)

## Schema change

One column on Agent:

```prisma
model Agent {
  // ...existing...
  presetId String?  // 'conversational' | 'booking' | 'custom' | null (created pre-B2)
}
```

SQL:
```sql
ALTER TABLE "Agent" ADD COLUMN IF NOT EXISTS "presetId" TEXT;
```

## API additions

**GET `/api/workspaces/[wsId]/agents/[agentId]/tool-config/presets`** — returns the list of available presets `{ presets: AgentPreset[], current: string | null }` for the picker UI.

**POST `/api/workspaces/[wsId]/agents/[agentId]/tool-config/apply-preset`** — body `{ presetId }`. Applies the preset's `autonomyMode` + tool deltas via the existing PATCH logic. Returns the updated config (same shape as PATCH).

Agent creation endpoint (`POST /api/workspaces/[wsId]/agents`) extended to accept optional `presetId`. After agent creation, calls `applyPreset` server-side.

## UI

**Creation wizard** — adds a "Preset" step (or step section) before the existing config:
- Three radio cards: Conversational / Booking / Custom
- Each card shows label, description, and a brief summary of what it does ("Disables booking + commerce, keeps CRM reads")
- Selection sets `presetId` on the agent at create time

**`/tools` page** — adds an "Apply preset" button at the top of the AgentToolRulesEditor:
- Clicking opens a confirm dialog listing the preset choices
- Selecting + confirming POSTs `apply-preset`
- Shows a warning about overwriting current customizations
- Refreshes the editor with the new state

## Out of scope (deferred)

- DB-managed custom presets per workspace
- Live preset linkage (changes propagate)
- Sharing presets across workspaces

## Verification

1. Create new agent with `presetId='booking'` → confirm `Agent.presetId='booking'`, calendar tools enabled with catalog defaults, commerce tools disabled, AgentToolConfig rows exist for the disabled tools
2. Create with `presetId='conversational'` → confirm calendar tools disabled, opportunity writes disabled
3. Create with `presetId='custom'` → confirm no AgentToolConfig rows created
4. Existing agent → click "Apply preset" → Booking Bot → confirm config swap
5. Re-apply same preset → no-op (idempotent)
